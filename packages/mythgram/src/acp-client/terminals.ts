import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import { JsonRpcError } from "./jsonrpc.js";
import { ACP_ERRORS } from "./types.js";

/**
 * Client-side terminal implementation for the ACP `terminal/*` methods.
 *
 * Agents use these methods to run build commands, tests, scripts and other shell
 * work. Commands are spawned WITHOUT a shell on Unix (args are passed as separate
 * argv entries); Windows uses the platform shell so `.cmd` shims (npx, pnpm, ...)
 * resolve correctly. Output is captured with a byte cap and truncated at a
 * character boundary.
 */

const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;
const MAX_OUTPUT_LIMIT = 8 * 1024 * 1024;

interface TerminalExit {
  exitCode: number | null;
  signal: string | null;
}

interface TerminalRecord {
  id: string;
  child: ChildProcessWithoutNullStreams;
  output: string;
  outputByteLimit: number;
  truncated: boolean;
  exit: TerminalExit | null;
  waiters: Array<(exit: TerminalExit) => void>;
}

function truncateToBytes(value: string, limit: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= limit) return { text: value, truncated: false };
  // Keep the most recent output. Move forward off any UTF-8 continuation byte so
  // the retained suffix starts at a complete character boundary.
  let start = Math.max(0, bytes.length - limit);
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
  return { text: bytes.subarray(start).toString("utf8"), truncated: true };
}

export class AcpTerminalManager {
  private readonly terminals = new Map<string, TerminalRecord>();

  /** Create a terminal and return its id immediately (command runs in background). */
  create(params: {
    command?: unknown;
    args?: unknown;
    env?: unknown;
    cwd?: unknown;
    outputByteLimit?: unknown;
  }, sessionCwd: string): { terminalId: string } {
    const command = typeof params.command === "string" ? params.command.trim() : "";
    if (!command) {
      throw new JsonRpcError(ACP_ERRORS.invalidParams, "terminal/create requires a command.");
    }
    const args = Array.isArray(params.args)
      ? params.args.filter((v): v is string => typeof v === "string")
      : [];
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (Array.isArray(params.env)) {
      for (const entry of params.env) {
        if (!entry || typeof entry !== "object") continue;
        const rec = entry as { name?: unknown; value?: unknown };
        if (typeof rec.name === "string" && typeof rec.value === "string") env[rec.name] = rec.value;
      }
    }
    const cwd = typeof params.cwd === "string" && params.cwd.length > 0 ? params.cwd : sessionCwd;
    const requestedLimit =
      typeof params.outputByteLimit === "number" && Number.isFinite(params.outputByteLimit)
        ? Math.max(0, Math.floor(params.outputByteLimit))
        : DEFAULT_OUTPUT_LIMIT;
    const outputByteLimit = Math.min(MAX_OUTPUT_LIMIT, requestedLimit);

    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    const id = `term_${crypto.randomBytes(8).toString("hex")}`;
    const record: TerminalRecord = {
      id,
      child,
      output: "",
      outputByteLimit,
      truncated: false,
      exit: null,
      waiters: [],
    };
    this.terminals.set(id, record);

    const append = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (!text) return;
      const combined = record.output + text;
      if (record.outputByteLimit > 0 && Buffer.byteLength(combined, "utf8") > record.outputByteLimit) {
        const trimmed = truncateToBytes(combined, record.outputByteLimit);
        record.output = trimmed.text;
        record.truncated = true;
      } else {
        record.output = combined;
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      append(`\n${error.message}\n`);
      this.finish(record, { exitCode: null, signal: null });
    });
    child.on("close", (code, signal) => {
      this.finish(record, {
        exitCode: typeof code === "number" ? code : null,
        signal: typeof signal === "string" ? signal : null,
      });
    });

    return { terminalId: id };
  }

  output(terminalId: string): {
    output: string;
    truncated: boolean;
    exitStatus: TerminalExit | null;
  } {
    const record = this.get(terminalId);
    return {
      output: record.output,
      truncated: record.truncated,
      exitStatus: record.exit,
    };
  }

  async waitForExit(terminalId: string): Promise<TerminalExit> {
    const record = this.get(terminalId);
    if (record.exit) return record.exit;
    return new Promise<TerminalExit>((resolve) => {
      record.waiters.push(resolve);
    });
  }

  kill(terminalId: string): Record<string, never> {
    const record = this.get(terminalId);
    if (!record.exit) {
      try {
        record.child.kill("SIGTERM");
      } catch {
        // best effort
      }
    }
    return {};
  }

  release(terminalId: string): Record<string, never> {
    const record = this.get(terminalId);
    if (!record.exit) {
      try {
        record.child.kill("SIGTERM");
      } catch {
        // best effort
      }
    }
    this.finish(record, { exitCode: null, signal: null });
    this.terminals.delete(terminalId);
    return {};
  }

  closeAll(): void {
    for (const record of this.terminals.values()) {
      if (!record.exit) {
        try {
          record.child.kill("SIGTERM");
        } catch {
          // best effort
        }
      }
    }
    this.terminals.clear();
  }

  private get(terminalId: string): TerminalRecord {
    if (typeof terminalId !== "string" || !terminalId) {
      throw new JsonRpcError(ACP_ERRORS.invalidParams, "A terminal id is required.");
    }
    const record = this.terminals.get(terminalId);
    if (!record) {
      throw new JsonRpcError(ACP_ERRORS.resourceNotFound, `Unknown terminal "${terminalId}".`, {
        terminalId,
      });
    }
    return record;
  }

  private finish(record: TerminalRecord, exit: TerminalExit): void {
    if (record.exit) return;
    record.exit = exit;
    for (const resolve of record.waiters.splice(0)) resolve(exit);
  }
}