import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";
import { shellSessionStore } from "./shellSessions.js";

const schema = z.object({
  session_name: z
    .string()
    .min(1)
    .max(128)
    .describe(
      "The name of an existing background shell session. This is the session_name you " +
        "passed to shall_tool with wait_for_output=false.",
    ),
  input: z
    .string()
    .describe(
      "Text to write to the process's stdin. Sent exactly as provided; combined with " +
        "press_enter=true it is submitted like pressing Enter.",
    ),
  press_enter: z
    .boolean()
    .default(true)
    .describe(
      "If true (default) a newline is appended after the input so it is submitted like " +
        "pressing Enter. If false the input is sent exactly as provided without a newline.",
    ),
});

const DESCRIPTION = `Writes input to the stdin of the process currently running in a background shell session.

Use it to interact with running processes: prompts waiting for user input, interactive CLI programs, development servers, and REPLs.

Usage:
- Start the process with shall_tool(command=..., session_name=..., wait_for_output=false). It keeps running in the background under that session name.
- Call bash_write_to_process(session_name=..., input=..., press_enter=...) to write to the running process's stdin.
  - press_enter=true (default): input is sent followed by a newline, like typing text and pressing Enter.
  - press_enter=false: input is sent byte-for-byte with no trailing newline.
- Inspect the process output afterwards with shell_view(session_names=[...]) using the same session name.
- The tool NEVER executes the input as a new shell command: it writes to the stdin of the already-running process, and never terminates it.

Errors (returned as failed tool results): missing/empty session_name, unknown session, a session that was not started in the background, a process that has already exited, stdin unavailable or closed, or an underlying write failure.`;

export const bashWriteToProcessTool = defineTool({
  name: "bash_write_to_process",
  description: DESCRIPTION,
  schema,
  label: (args) => `Write to ${args.session_name}: ${args.input}`,
  async execute(args): Promise<ToolResult> {
    const sessionName = args.session_name.trim();
    if (!sessionName) {
      return {
        ok: false,
        error: { code: "missing_session_name", message: "No session name provided." },
      };
    }
    if (args.input === "" && !args.press_enter) {
      return {
        ok: false,
        error: { code: "missing_input", message: "No input provided to write." },
      };
    }

    const data = args.press_enter ? args.input + "\n" : args.input;
    const result = await shellSessionStore.writeToProcess(sessionName, data);

    if (!result.ok) {
      const messages: Record<string, string> = {
        session_not_found:
          `No shell session named "${sessionName}" exists. Start one first with ` +
          `shall_tool(command=..., session_name="${sessionName}", wait_for_output=false).`,
        not_writable_session:
          `Session "${sessionName}" is not a writable background session. ` +
          `bash_write_to_process only writes to processes started with shall_tool(wait_for_output=false).`,
        process_exited: `The process in session "${sessionName}" has already exited.`,
        stdin_unavailable:
          `The stdin of the process in session "${sessionName}" is unavailable or closed.`,
        write_failed: `Failed to write to the process in session "${sessionName}".`,
      };
      return {
        ok: false,
        error: {
          code: result.code,
          message: messages[result.code] ?? "Could not write to the process.",
          session_name: sessionName,
          ...(result.code === "process_exited"
            ? { status: result.status, exit_code: result.exit_code, signal: result.signal }
            : {}),
          ...(result.code === "write_failed" ? { detail: result.message } : {}),
        },
      };
    }

    return {
      ok: true,
      data: {
        session_name: result.session_name,
        input: args.input,
        press_enter: args.press_enter,
        written: data,
        bytes_written: result.bytes_written,
      },
    };
  },
});