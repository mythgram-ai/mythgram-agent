import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";
import { shellSessionStore, type ShellSessionSnapshot } from "./shellSessions.js";

const schema = z.object({
  session_names: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(10)
    .describe(
      "Session names of background commands to inspect. These are the session_name values " +
        "you passed to shall_tool with wait_for_output=false.",
    ),
});

const DESCRIPTION = `Views the buffered output (stdout + stderr) of background commands started with shall_tool(wait_for_output=false), keyed by the session_name they were started with.

The output is a snapshot of everything the command has written so far — whether the command is still running, has finished, or failed. It does not block: the command keeps running while you inspect it.

Usage:
- Start a long-running command with shall_tool(command=..., session_name=..., wait_for_output=false). It returns immediately with the PID and the session name.
- Call shell_view(session_names=[...]) to read the live output. Poll it repeatedly with the same session_name until the status becomes "completed" or "errored".

Returns one entry per requested session_name with:
- session_name: the name you requested
- status: "running" (still executing) | "completed" (exit code 0) | "errored" (non-zero exit or spawn failure) | "session not found" | "not a background session"
- output: the full buffered stdout + stderr so far
- stdout, stderr, command, pid, exit_code, signal, started_at, finished_at, truncated

Only works with background commands (wait_for_output=false). If any requested session does not exist or was not started in the background, the tool returns an error listing exactly which session names are unavailable.`;

export const shellViewTool = defineTool({
  name: "shell_view",
  description: DESCRIPTION,
  schema,
  label: (args) => `Sessions: ${args.session_names.join(", ")}`,
  async execute(args): Promise<ToolResult> {
    const sessions: Array<
      ShellSessionSnapshot | { session_name: string; status: string; output: string }
    > = args.session_names.map((session_name) => {
      const snapshot = shellSessionStore.snapshot(session_name);
      if (!snapshot) {
        return { session_name, status: "session not found", output: "" };
      }
      return snapshot;
    });

    const unavailable = sessions.filter(
      (session) =>
        session.status === "session not found" || session.status === "not a background session",
    );

    if (unavailable.length === 0) {
      return { ok: true, data: { sessions } };
    }

    const detail = unavailable
      .map((session) => `"${session.session_name}" (${session.status})`)
      .join(", ");

    return {
      ok: false,
      error: {
        code: "shell_view_error",
        message:
          `Cannot view output for ${detail}. shell_view only inspects background commands ` +
          `started with shall_tool(wait_for_output=false) — check the session_name you used.`,
        sessions,
      },
    };
  },
});