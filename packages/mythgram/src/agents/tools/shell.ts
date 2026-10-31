import { spawn } from "node:child_process";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { shellSessionStore } from "./shellSessions.js";

/** Default timeout (seconds) applied when the model does not specify one. */
export const DEFAULT_TIMEOUT = 60;
/** Hard upper bound (seconds) for a model-requested command timeout. */
export const MAX_TIMEOUT = 180;
/** Maximum number of characters of command output returned to the model. */
export const MAX_LLM_CONTENT_CHARS = 20_000;

const TIMEOUT_ERROR_SUFFIX = "retry with longer time out";

const schema = z.object({
  command: z
    .string()
    .describe("The shell command to run, e.g. 'npm install', 'ls -la', 'node script.js'."),
  session_name: z
    .string()
    .default("default")
    .describe(
      "Logical session/label for grouping related commands. For background commands " +
        "(wait_for_output=false) this is the key used by shell_view to inspect the live output.",
    ),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(MAX_TIMEOUT)
    .default(DEFAULT_TIMEOUT)
    .describe(`The timeout for the command in seconds. Maximum is ${MAX_TIMEOUT} seconds.`),
  wait_for_output: z
    .boolean()
    .default(true)
    .describe(
      "If true (default) wait for the command to finish and return stdout/stderr/exit_code. " +
        "If false, start the command in the background and return immediately with the PID.",
    ),
});

const DESCRIPTION = `Executes a bash command in a persistent shell session

Usage notes:
- To run multiple commands, join them with ';' or '&&'. Do not use newlines
- For long-running tasks (e.g., deployments), set \`wait_for_output\` to False and monitor progress with the \`shell_view\` tool using the same session_name
- You can specify an optional timeout in seconds (up to ${MAX_TIMEOUT} seconds). If not specified, commands will timeout after ${DEFAULT_TIMEOUT} seconds`;

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_LLM_CONTENT_CHARS) return { text, truncated: false };
  return {
    text:
      text.slice(0, MAX_LLM_CONTENT_CHARS) +
      `\n... [truncated ${text.length - MAX_LLM_CONTENT_CHARS} chars]`,
    truncated: true,
  };
}

function runForeground(
  command: string,
  sessionName: string,
  timeoutSeconds: number,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Record the session name as a foreground session so shell_view rejects it
  // with a clear "not a background session" error instead of "session not found".
  shellSessionStore.markForeground(sessionName);

  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: ctx.workspaceRoot,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    // The server-side hard cap (ctx.shellTimeoutMs) is a safety net over the
    // model-requested timeout: the command never outlives the smaller of the two.
    const fallbackMs = Number.isFinite(ctx.shellTimeoutMs) && ctx.shellTimeoutMs > 0
      ? ctx.shellTimeoutMs
      : timeoutSeconds * 1000;
    const effectiveTimeoutMs = Math.min(timeoutSeconds * 1000, fallbackMs);

    const onAbort = () => {
      if (settled) return;
      child.kill("SIGKILL");
    };
    ctx.signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
      child.kill("SIGKILL");
      const out = truncate(stdout);
      const err = truncate(stderr);
      resolve({
        ok: false,
        error: {
          code: "shell_timeout",
          message: `Command timed out after ${Math.round(effectiveTimeoutMs / 1000)}s. ${TIMEOUT_ERROR_SUFFIX}`,
          command,
          timeout_seconds: Math.round(effectiveTimeoutMs / 1000),
          stdout: out.text,
          stderr: err.text,
          truncated: out.truncated || err.truncated,
        },
      });
    }, effectiveTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
      resolve({
        ok: false,
        error: { code: "command_spawn_failed", message: error.message, command },
      });
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
      const out = truncate(stdout);
      const err = truncate(stderr);
      const timedOut = signal === "SIGKILL" && !ctx.signal?.aborted;
      resolve({
        ok: code === 0,
        data: {
          command,
          exit_code: code,
          signal,
          stdout: out.text,
          stderr: err.text,
          truncated: out.truncated || err.truncated,
          timed_out: timedOut,
        },
      });
    });
  });
}

function runBackground(command: string, sessionName: string, ctx: ToolContext): ToolResult {
  try {
    const child = spawn("bash", ["-lc", command], {
      cwd: ctx.workspaceRoot,
      env: process.env,
      detached: true,
      // stdin stays open as a pipe so bash_write_to_process can feed the running
      // process input (prompts, interactive CLIs, REPLs, dev servers).
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Track the process under its session name: the shell_view tool reads the
    // buffered stdout/stderr and status from this session at any moment.
    shellSessionStore.attach(sessionName, child, command);
    child.unref();
    return {
      ok: true,
      data: {
        command,
        session_name: sessionName,
        pid: child.pid,
        background: true,
        message: `Started command in background with PID ${child.pid}. Inspect its live output with the shell_view tool using session name "${sessionName}".`,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "command_spawn_failed",
        message: error instanceof Error ? error.message : String(error),
        command,
      },
    };
  }
}

export const shellTool = defineTool({
  name: "shall_tool",
  description: DESCRIPTION,
  schema,
  label: (args) => `Terminal: ${args.command}`,
  async execute(args, ctx): Promise<ToolResult> {
    if (!args.command || !args.command.trim()) {
      return { ok: false, error: { code: "missing_command", message: "No command provided." } };
    }
    if (args.wait_for_output) {
      return runForeground(args.command, args.session_name, args.timeout, ctx);
    }
    return runBackground(args.command, args.session_name, ctx);
  },
});