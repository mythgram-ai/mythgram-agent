import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import type { McpLocalConfig } from "./configuration.js";

/**
 * stdio transport for local MCP servers (spec § stdio).
 *
 * The server is launched as a subprocess: newline-delimited JSON-RPC goes to
 * its stdin, responses stream back on stdout (stderr is captured for
 * diagnostics and never parsed as protocol). Requests multiplex over the one
 * process with per-request timeouts; a dead process fails pending calls and
 * the next call transparently relaunches it.
 */

export interface StdioRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const SPAWN_TIMEOUT_MS = 30_000;

interface PendingCall {
  resolve: (value: { result?: unknown; error?: { code: number; message: string; data?: unknown } }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanupAbort: () => void;
}

export class McpStdioTransport {
  private child: ChildProcess | null = null;
  private reader: readline.Interface | null = null;
  private nextId = 1;
  private readonly pending = new Map<string | number, PendingCall>();
  private stderrTail = "";
  private spawnPromise: Promise<void> | null = null;
  private closed = false;
  private startCount = 0;

  constructor(
    private readonly local: McpLocalConfig,
    private readonly workspaceRoot: string,
  ) {}

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.child.killed;
  }

  /** Last stderr output (shown when the server dies or a call fails). */
  get diagnostics(): string {
    return this.stderrTail.slice(-2000);
  }

  private env(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") env[k] = v;
    }
    for (const [k, v] of Object.entries(this.local.env)) env[k] = v;
    return env;
  }

  /** Launch (or re-launch) the subprocess. Concurrent callers share one spawn. */
  async ensureRunning(): Promise<void> {
    if (this.closed) throw new Error("The MCP stdio transport is closed.");
    if (this.running) return;
    if (!this.spawnPromise) {
      this.spawnPromise = this.spawn().finally(() => {
        this.spawnPromise = null;
      });
    }
    await this.spawnPromise;
  }

  private spawn(): Promise<void> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(this.local.command, this.local.args, {
          cwd: this.local.cwd ?? this.workspaceRoot,
          env: this.env(),
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
        });
      } catch (error) {
        reject(new Error(`Could not launch the MCP server "${this.local.command}": ${messageOf(error)}`));
        return;
      }
      this.child = child;
      this.startCount += 1;

      const timer = setTimeout(() => {
        if (!this.running) {
          reject(
            new Error(
              `The MCP server "${this.local.command}" did not start within ${SPAWN_TIMEOUT_MS / 1000}s.` +
                (this.stderrTail ? ` stderr: ${this.stderrTail.slice(-500)}` : ""),
            ),
          );
        }
      }, SPAWN_TIMEOUT_MS);
      timer.unref?.();

      child.on("error", (error) => {
        clearTimeout(timer);
        this.failAllPending(new Error(`The MCP server process failed to start: ${messageOf(error)}`));
        this.child = null;
        reject(new Error(`Could not launch the MCP server "${this.local.command}": ${messageOf(error)}`));
      });

      child.on("spawn", () => {
        clearTimeout(timer);
        if (!child.stdout || !child.stdin) {
          reject(new Error("The MCP server process has no usable stdio pipes."));
          return;
        }
        this.reader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
        this.reader.on("line", (line) => this.onLine(line));
        resolve();
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        this.stderrTail += chunk.toString("utf8");
        if (this.stderrTail.length > 8000) this.stderrTail = this.stderrTail.slice(-8000);
      });

      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        this.reader?.close();
        this.reader = null;
        this.child = null;
        this.failAllPending(
          new Error(
            `The MCP server "${this.local.command}" exited (code ${code ?? "?"}, signal ${signal ?? "?"}).` +
              (this.stderrTail ? ` stderr: ${this.stderrTail.slice(-500)}` : ""),
          ),
        );
      });
    });
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: { id?: string | number; result?: unknown; error?: { code: number; message: string; data?: unknown } };
    try {
      parsed = JSON.parse(trimmed) as typeof parsed;
    } catch {
      return; // not protocol (a stray log line on stdout) — ignore
    }
    if (parsed.id === undefined || parsed.id === null) return; // notification — nothing waits on these
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    clearTimeout(pending.timer);
    pending.cleanupAbort();
    pending.resolve({ result: parsed.result, error: parsed.error });
  }

  private failAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.cleanupAbort();
      pending.reject(error);
    }
    this.pending.clear();
  }

  /**
   * Send one JSON-RPC request and resolve its result (or throw its error).
   * A crashed server fails the call; the NEXT call relaunches it.
   */
  async request(
    method: string,
    params?: Record<string, unknown>,
    opts?: StdioRequestOptions,
  ): Promise<unknown> {
    await this.ensureRunning();
    const child = this.child;
    if (!child || !child.stdin || !this.running) {
      throw new Error(`The MCP server "${this.local.command}" is not running.${this.diagnostics ? ` ${this.diagnostics.slice(-300)}` : ""}`);
    }
    const id = this.nextId++;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        opts?.signal?.removeEventListener("abort", onAbort);
        reject(new Error(`The MCP server did not answer "${method}" within ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      timer.unref?.();
      const onAbort = (): void => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error("The MCP request was aborted."));
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: ({ result, error }) => {
          if (error) reject(new Error(`MCP error ${error.code}: ${error.message}`));
          else resolve(result);
        },
        reject,
        timer,
        cleanupAbort: () => opts?.signal?.removeEventListener("abort", onAbort),
      });
      child.stdin!.write(`${payload}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          opts?.signal?.removeEventListener("abort", onAbort);
          reject(new Error(`Could not write to the MCP server: ${messageOf(error)}`));
        }
      });
    });
  }

  /** Fire-and-forget notification (e.g. notifications/initialized). */
  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    await this.ensureRunning();
    const child = this.child;
    if (!child || !child.stdin || !this.running) return;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) });
    child.stdin.write(`${payload}\n`);
  }

  /** How many times the process has been (re)started (observability). */
  get restarts(): number {
    return this.startCount;
  }

  /** Terminate the subprocess and fail anything in flight. */
  async close(): Promise<void> {
    this.closed = true;
    this.failAllPending(new Error("The MCP stdio transport was closed."));
    this.reader?.close();
    this.reader = null;
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
    const exited = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      timer.unref?.();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    child.kill("SIGTERM");
    await exited;
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
