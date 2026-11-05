import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import { JsonRpcPeer } from "./jsonrpc.js";

/**
 * Spawn an ACP agent as a child process and attach a JSON-RPC peer to its stdio.
 *
 * Compatibility notes:
 *  - The command is spawned directly with args as separate argv entries (no shell
 *    on Unix), so quoted arguments and paths with spaces work exactly as entered.
 *  - Windows uses the platform shell so `npx`, `pnpm`, `.cmd` shims and `.bat`
 *    launchers resolve; this mirrors how ACP clients launch agents there.
 *  - stderr and incidental stdout log lines are captured into a bounded ring so
 *    the panel can show why an agent failed to start or initialize.
 */

export interface SpawnAcpAgentOptions {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  onNotification: (method: string, params: unknown) => void;
  onRequest: (method: string, params: unknown) => Promise<unknown>;
  onExit: (info: { code: number | null; signal: NodeJS.Signals | null; error: Error | null }) => void;
  onLog: (line: string) => void;
}

export interface SpawnedAcpAgent {
  child: ChildProcess;
  peer: JsonRpcPeer;
  stderr: string[];
  kill: () => void;
}

const MAX_LOG_LINES = 200;

function trimRing(lines: string[], line: string): void {
  if (!line.trim()) return;
  lines.push(line.length > 2000 ? `${line.slice(0, 2000)}…` : line);
  if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
}

export function spawnAcpAgent(options: SpawnAcpAgentOptions): SpawnedAcpAgent {
  const command = options.command.trim();
  if (!command) throw new Error("An ACP agent command is required.");

  const child = spawn(command, options.args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32",
    // A dedicated process group lets us terminate the agent and its children together.
    detached: process.platform !== "win32",
  });

  const stderr: string[] = [];
  let exitNotified = false;
  const notifyExit = (info: { code: number | null; signal: NodeJS.Signals | null; error: Error | null }) => {
    if (exitNotified) return;
    exitNotified = true;
    options.onExit(info);
  };

  const stderrReader = readline.createInterface({ input: child.stderr!, crlfDelay: Infinity });
  stderrReader.on("line", (line) => {
    trimRing(stderr, line);
    options.onLog(line);
  });

  const peer = new JsonRpcPeer(child.stdout!, child.stdin!, {
    onNotification: options.onNotification,
    onRequest: options.onRequest,
    onLog: (line) => {
      trimRing(stderr, line);
      options.onLog(line);
    },
    onClose: (error) => {
      // The 'close' event handles the normal case; this covers stream failures.
      if (error) {
        trimRing(stderr, `[transport] ${error.message}`);
        notifyExit({ code: null, signal: null, error });
      }
    },
  });

  child.on("error", (error) => {
    trimRing(stderr, `[spawn] ${error.message}`);
    peer.close(error);
    notifyExit({ code: null, signal: null, error });
  });

  child.on("close", (code, signal) => {
    peer.close(new Error(`ACP agent exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`));
    notifyExit({ code: code ?? null, signal: signal ?? null, error: null });
  });

  const kill = () => {
    try {
      if (process.platform !== "win32" && typeof child.pid === "number" && child.pid > 0) {
        process.kill(-child.pid, "SIGTERM");
        return;
      }
    } catch {
      // fall back to killing the direct child
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  };

  return { child, peer, stderr, kill };
}