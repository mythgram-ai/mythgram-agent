import type { ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";

/** Maximum characters of stdout and of stderr buffered per session (each). */
export const MAX_SESSION_BUFFER_CHARS = 1_000_000;

export type ShellSessionStatus = "running" | "completed" | "errored";

/**
 * Immutable view of a session handed to shell_view. `status` is one of the process
 * statuses for background sessions; for sessions that were never started in the
 * background it is "not a background session".
 */
export interface ShellSessionSnapshot {
  session_name: string;
  /** Whether the command was started with wait_for_output=false. */
  background: boolean;
  status: ShellSessionStatus | "not a background session";
  /** stdout + stderr concatenated — everything the command has written so far. */
  output: string;
  stdout: string;
  stderr: string;
  command: string;
  pid: number | null;
  exit_code: number | null;
  signal: string | null;
  started_at: number;
  finished_at: number | null;
  /** True if the buffered output was capped at MAX_SESSION_BUFFER_CHARS. */
  truncated: boolean;
}

/**
 * Result of a writeToProcess attempt. `ok` mirrors the tool result contract so the
 * caller can translate each failure code into a clear tool error without re-probing.
 */
export type ProcessWriteResult =
  | { ok: true; session_name: string; bytes_written: number }
  | { ok: false; code: "session_not_found" }
  | { ok: false; code: "not_writable_session" }
  | {
      ok: false;
      code: "process_exited";
      status: ShellSessionStatus;
      exit_code: number | null;
      signal: string | null;
    }
  | { ok: false; code: "stdin_unavailable" }
  | { ok: false; code: "write_failed"; message: string };

interface InternalShellSession {
  session_name: string;
  kind: "background" | "foreground";
  command: string;
  pid: number | null;
  status: ShellSessionStatus;
  exit_code: number | null;
  signal: string | null;
  started_at: number;
  finished_at: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  /** The live process (background sessions only). Kept after exit so snapshot keeps pid/exit_code. */
  child: ChildProcess | null;
  /** Serializes concurrent stdin writes to this session: each write awaits its predecessor. */
  writeChain: Promise<void>;
}

function createEntry(
  session_name: string,
  command: string,
  kind: InternalShellSession["kind"],
): InternalShellSession {
  return {
    session_name,
    kind,
    command,
    pid: null,
    status: "running",
    exit_code: null,
    signal: null,
    started_at: Date.now(),
    finished_at: null,
    stdout: "",
    stderr: "",
    truncated: false,
    child: null,
    writeChain: Promise.resolve(),
  };
}

function appendTo(
  entry: InternalShellSession,
  stream: "stdout" | "stderr",
  chunk: string,
): void {
  const current = entry[stream];
  if (current.length >= MAX_SESSION_BUFFER_CHARS) {
    entry.truncated = true;
    return;
  }
  const slice = chunk.slice(0, MAX_SESSION_BUFFER_CHARS - current.length);
  entry[stream] = current + slice;
  if (slice.length < chunk.length) entry.truncated = true;
}

/**
 * Process-lifetime mapping of `session_name -> background process`, storing each
 * background command's live status and buffered stdout/stderr so the shell_view tool
 * can take a snapshot of the logs at any moment — whether the command is still running,
 * has finished, or failed. Foreground (wait_for_output=true) session names are also
 * recorded so shell_view can report them as "not a background session".
 */
export class ShellSessionStore {
  private readonly sessions = new Map<string, InternalShellSession>();

  /** Remove all tracked sessions (used by tests; harmless for the running server). */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Record that a foreground (wait_for_output=true) command claimed this session name.
   * Kept minimal: shell_view must reject it instead of pretending the name is unknown.
   */
  markForeground(session_name: string): void {
    const existing = this.sessions.get(session_name);
    if (existing?.kind === "foreground") return;
    this.sessions.set(session_name, createEntry(session_name, "", "foreground"));
  }

  /**
   * Start tracking a background process. Attaches data/error/close listeners so the
   * session buffer accumulates stdout+stderr and the status transitions to
   * "completed" (exit 0) or "errored" (non-zero exit, signal, or spawn failure).
   */
  attach(session_name: string, child: ChildProcess, command: string): void {
    const entry = createEntry(session_name, command, "background");
    entry.pid = child.pid ?? null;
    entry.child = child;
    this.sessions.set(session_name, entry);

    const onStdout = (chunk: Buffer) => appendTo(entry, "stdout", chunk.toString("utf8"));
    const onStderr = (chunk: Buffer) => appendTo(entry, "stderr", chunk.toString("utf8"));
    // Permanent stdin error listener: writes against a closed pipe (e.g. the process
    // exited or closed its stdin) surface as an 'error' event on child.stdin. Without a
    // listener this would crash the server; writeToProcess still reports the failure to
    // the caller through the write callback. The note is also visible via shell_view.
    child.stdin?.on("error", (error: Error) => {
      appendTo(entry, "stderr", `[stdin error] ${error.message}\n`);
    });
    const onError = (error: Error) => {
      if (entry.status !== "running") return;
      entry.status = "errored";
      entry.finished_at = Date.now();
      appendTo(entry, "stderr", `[spawn error] ${error.message}\n`);
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      if (entry.status !== "running") return;
      entry.status = code === 0 ? "completed" : "errored";
      entry.exit_code = code;
      entry.signal = signal ?? null;
      entry.finished_at = Date.now();
    };

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);
  }

  /** Current snapshot of a session, or null when the session name is unknown. */
  snapshot(session_name: string): ShellSessionSnapshot | null {
    const entry = this.sessions.get(session_name);
    if (!entry) return null;

    const base = {
      session_name: entry.session_name,
      background: entry.kind === "background",
      command: entry.command,
      pid: entry.pid,
      exit_code: entry.exit_code,
      signal: entry.signal,
      started_at: entry.started_at,
      finished_at: entry.finished_at,
      truncated: entry.truncated,
    };

    if (entry.kind === "foreground") {
      return { ...base, status: "not a background session", output: "", stdout: "", stderr: "" };
    }

    return {
      ...base,
      status: entry.status,
      output: entry.stdout + entry.stderr,
      stdout: entry.stdout,
      stderr: entry.stderr,
    };
  }

  /**
   * Write raw bytes to the stdin of the process running in a background session.
   * Never starts a new command and never terminates the process: the data goes
   * directly to the already-running process's stdin, exactly as provided.
   *
   * Concurrent calls targeting the same session are serialized through the entry's
   * writeChain so their bytes can never interleave; ordering matches call order.
   */
  async writeToProcess(session_name: string, data: string): Promise<ProcessWriteResult> {
    const entry = this.sessions.get(session_name);
    if (!entry) return { ok: false, code: "session_not_found" };
    if (entry.kind !== "background") return { ok: false, code: "not_writable_session" };
    if (entry.status !== "running") {
      return {
        ok: false,
        code: "process_exited",
        status: entry.status,
        exit_code: entry.exit_code,
        signal: entry.signal,
      };
    }

    const stdin = entry.child?.stdin;
    if (!entry.child || !stdin || !isWritable(stdin)) {
      return { ok: false, code: "stdin_unavailable" };
    }

    // Queue behind any in-flight write so concurrent calls write in call order.
    const prior = entry.writeChain;
    let release!: () => void;
    entry.writeChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior.catch(() => undefined);

    try {
      // Re-check after the queue drains: the process may have exited meanwhile.
      if (entry.status !== "running") {
        return {
          ok: false,
          code: "process_exited",
          status: entry.status,
          exit_code: entry.exit_code,
          signal: entry.signal,
        };
      }
      if (!isWritable(stdin)) return { ok: false, code: "stdin_unavailable" };

      try {
        await writeToStream(stdin, data);
        return { ok: true, session_name, bytes_written: Buffer.byteLength(data, "utf8") };
      } catch (error) {
        return {
          ok: false,
          code: "write_failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    } finally {
      release();
    }
  }
}

function isWritable(stream: Writable): boolean {
  return !stream.destroyed && !stream.writableEnded && stream.writable;
}

/**
 * Write a single chunk to a stream, resolving once the chunk is flushed and rejecting
 * on any write failure (e.g. EPIPE when the process exited or closed its stdin). The
 * stream-level 'error' event is already handled by the permanent listener attached in
 * attach(); this promise only observes the per-write callback and sync-throw paths.
 */
function writeToStream(stream: Writable, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      stream.write(chunk, (error) => {
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Process-lifetime singleton used by shall_tool and shell_view. */
export const shellSessionStore = new ShellSessionStore();