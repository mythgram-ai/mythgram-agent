import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LOCAL_TTS_DEFAULT_BASE_URL } from "./providers/localtts.js";
import type { TtsManager } from "./manager.js";

/**
 * One-click local-tts installer.
 *
 * Runs a fixed, whitelisted command sequence for the chosen install method on
 * the backend host (pip/PyPI, pip/GitHub Release wheel, or Docker), starts the
 * server, waits until its HTTP API answers, and points the stored `localtts`
 * provider base URL at it. It never accepts arbitrary commands from the client.
 */

export const LOCAL_TTS_INSTALL_METHODS = ["pypi", "release", "docker"] as const;

export type LocalTtsInstallMethod = (typeof LOCAL_TTS_INSTALL_METHODS)[number];

export function isLocalTtsInstallMethod(value: unknown): value is LocalTtsInstallMethod {
  return (
    typeof value === "string" &&
    (LOCAL_TTS_INSTALL_METHODS as readonly string[]).includes(value.trim().toLowerCase())
  );
}

const METHOD_LABELS: Record<LocalTtsInstallMethod, string> = {
  pypi: "pip (PyPI)",
  release: "pip (GitHub Release)",
  docker: "Docker",
};

/** Package specs for the two pip methods (fixed sources — never user input). */
const PYPI_PACKAGE = "local-tts-studio";
const RELEASE_WHEEL =
  "https://github.com/mythgram-ai/mythgram-agent/releases/download/v1.0.0/local_tts_studio-1.0.0-py3-none-any.whl";
const DOCKER_IMAGE = "ghcr.io/mythgram-ai/local-tts:main";

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const START_TIMEOUT_MS = 90 * 1000;
const PROBE_TIMEOUT_MS = 1_500;
const MAX_LOG_CHARS = 20_000;

export type LocalTtsInstallState = "idle" | "installing" | "starting" | "running" | "failed";

export interface LocalTtsInstallStatus {
  state: LocalTtsInstallState;
  method: LocalTtsInstallMethod | "";
  message: string;
  log: string;
  reachable: boolean;
  baseUrl: string;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

export class LocalTtsInstallError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalTtsInstallError";
    this.code = code;
  }
}

export interface LocalTtsInstallerDeps {
  manager: TtsManager;
  /** Directory for the server log (usually `<workspace>/.mythgram`). */
  dataDir: string;
  /** Base URL the auto-installed server is expected to serve (default local-tts). */
  baseUrl?: string;
  /** Python executable override (`LOCAL_TTS_PYTHON`). */
  python?: string;
  /** Injectable fetch for reachability probes (tests). */
  fetchFn?: typeof fetch;
}

interface RunStepOptions {
  timeoutMs?: number;
  /** Resolve even on a non-zero exit (used for best-effort cleanup). */
  allowFailure?: boolean;
}

export class LocalTtsInstaller {
  private state: LocalTtsInstallState = "idle";
  private method: LocalTtsInstallMethod | "" = "";
  private message = "Not installed yet. Pick a method and install it in one click.";
  private log = "";
  private error: string | null = null;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;

  private readonly baseUrl: string;
  private readonly dataDir: string;
  private readonly python: string;

  constructor(private readonly deps: LocalTtsInstallerDeps) {
    this.baseUrl = (deps.baseUrl || LOCAL_TTS_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
    this.dataDir = deps.dataDir;
    this.python = deps.python?.trim() || (process.platform === "win32" ? "python" : "python3");
  }

  /** Current status, including a live reachability probe of the local-tts API. */
  async status(): Promise<LocalTtsInstallStatus> {
    // Avoid an extra probe while pip/docker is still running.
    const reachable = this.state === "installing" ? false : await this.ping();
    return this.snapshot(reachable);
  }

  /**
   * Start an install + start operation. Returns immediately with the initial
   * "installing" status; poll `status()` for progress. Throws when a method is
   * invalid or another operation is already in flight.
   */
  start(methodRaw: unknown): LocalTtsInstallStatus {
    if (!isLocalTtsInstallMethod(methodRaw)) {
      throw new LocalTtsInstallError(
        "invalid_method",
        "Choose one of: pypi, release, or docker.",
      );
    }
    if (this.state === "installing" || this.state === "starting") {
      throw new LocalTtsInstallError(
        "install_in_progress",
        "A local-tts install is already running. Wait for it to finish.",
      );
    }

    const method = methodRaw.trim().toLowerCase() as LocalTtsInstallMethod;
    this.method = method;
    this.state = "installing";
    this.message = `Installing local-tts via ${METHOD_LABELS[method]}...`;
    this.log = "";
    this.error = null;
    this.startedAt = Date.now();
    this.finishedAt = null;

    // `run` catches its own failures and updates state; no unhandled rejection.
    void this.run(method);
    return this.snapshot(false);
  }

  private async run(method: LocalTtsInstallMethod): Promise<void> {
    try {
      if (await this.ping()) {
        this.appendLog("local-tts is already responding — skipping install.\n");
        this.configure();
        this.succeed("local-tts is already running.");
        return;
      }

      if (method === "docker") {
        await this.installDocker();
      } else {
        await this.installPython(method);
      }

      this.state = "starting";
      this.message = "Waiting for local-tts to start...";
      this.appendLog("\nWaiting for the local-tts API to respond...\n");

      if (!(await this.waitForReachable(START_TIMEOUT_MS))) {
        throw new LocalTtsInstallError(
          "start_timeout",
          "local-tts was installed but did not start within 90 seconds. Check the log below.",
        );
      }

      this.configure();
      this.succeed(`local-tts is installed and running at ${this.baseUrl}.`);
    } catch (error) {
      this.fail(error);
    }
  }

  private async installPython(method: Exclude<LocalTtsInstallMethod, "docker">): Promise<void> {
    const spec = method === "pypi" ? PYPI_PACKAGE : RELEASE_WHEEL;
    this.message = `Installing ${spec}...`;
    await this.runStep(this.python, ["-m", "pip", "install", "--upgrade", spec], {
      timeoutMs: INSTALL_TIMEOUT_MS,
    });

    this.state = "starting";
    this.message = "Starting local-tts...";
    await this.startPythonServer();
  }

  private async installDocker(): Promise<void> {
    this.message = "Pulling the local-tts Docker image...";
    await this.runStep("docker", ["pull", DOCKER_IMAGE], { timeoutMs: INSTALL_TIMEOUT_MS });

    // Replace a previous container so re-running the installer is idempotent.
    await this.runStep("docker", ["rm", "-f", "local-tts"], {
      timeoutMs: INSTALL_TIMEOUT_MS,
      allowFailure: true,
    });

    this.message = "Starting the local-tts container...";
    await this.runStep(
      "docker",
      [
        "run",
        "-d",
        "--name",
        "local-tts",
        "-p",
        "7878:7878",
        "-v",
        "local-tts-data:/data",
        DOCKER_IMAGE,
      ],
      { timeoutMs: INSTALL_TIMEOUT_MS },
    );
    this.state = "starting";
  }

  /** Launch the pip-installed server detached, logging to `.mythgram/local-tts/server.log`. */
  private async startPythonServer(): Promise<void> {
    const dir = path.join(this.dataDir, "local-tts");
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, "server.log");
    this.appendLog(`\nServer log: ${logPath}\n`);
    const fd = fs.openSync(logPath, "a");
    try {
      const child = spawn(
        this.python,
        ["-m", "local_tts.cli", "--host", "127.0.0.1", "--port", "7878"],
        { detached: true, stdio: ["ignore", fd, fd], env: process.env },
      );
      child.unref();
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          child.off("spawn", onSpawn);
          reject(
            new Error(
              `Could not start local-tts (${error.message}). ` +
                "Make sure Python 3 and its pip are available on the backend host.",
            ),
          );
        };
        const onSpawn = () => {
          child.off("error", onError);
          resolve();
        };
        child.once("error", onError);
        child.once("spawn", onSpawn);
      });
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Run one command, streaming its output into the shared install log. */
  private runStep(command: string, args: string[], options: RunStepOptions = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? INSTALL_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      this.appendLog(`$ ${command} ${args.join(" ")}\n`);
      let settled = false;
      const child = spawn(command, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new LocalTtsInstallError("install_timeout", `${command} timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => this.appendLog(chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => this.appendLog(chunk.toString("utf8")));
      child.on("error", (error: NodeJS.ErrnoException) => {
        const message =
          error.code === "ENOENT"
            ? `${command} was not found. Install it and try again.`
            : `${command} failed: ${error.message}`;
        finish(new LocalTtsInstallError("command_not_found", message));
      });
      child.on("close", (code) => {
        if (code === 0 || options.allowFailure) finish();
        else finish(new LocalTtsInstallError("command_failed", `${command} exited with code ${code}.`));
      });
    });
  }

  private async waitForReachable(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.ping()) return true;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    return false;
  }

  private async ping(): Promise<boolean> {
    let probeUrl: string;
    try {
      probeUrl = `${new URL(this.baseUrl).origin}/api/health`;
    } catch {
      return false;
    }
    try {
      const fetchFn = this.deps.fetchFn ?? fetch;
      const response = await fetchFn(probeUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Persist the local-tts base URL into the provider config so the panel uses it. */
  private configure(): void {
    const updated = this.deps.manager.update("localtts", {
      baseUrl: this.baseUrl,
      enabled: true,
    });
    if (!updated) {
      throw new LocalTtsInstallError(
        "provider_missing",
        "The Local TTS provider record is missing; reload the app and try again.",
      );
    }
  }

  private succeed(message: string): void {
    this.state = "running";
    this.message = message;
    this.error = null;
    this.finishedAt = Date.now();
    this.appendLog(`\n${message}\n`);
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.state = "failed";
    this.message = message;
    this.error = message;
    this.finishedAt = Date.now();
    this.appendLog(`\nError: ${message}\n`);
  }

  private appendLog(chunk: string): void {
    const next = this.log + chunk;
    this.log = next.length > MAX_LOG_CHARS ? `…\n${next.slice(-MAX_LOG_CHARS)}` : next;
  }

  private snapshot(reachable: boolean): LocalTtsInstallStatus {
    let state = this.state;
    if (reachable && state !== "installing" && state !== "starting") state = "running";
    else if (!reachable && state === "running") state = "idle";

    let message = this.message;
    if (state === "running" && this.state !== "running") {
      message = `local-tts is running at ${this.baseUrl}.`;
    }

    return {
      state,
      method: this.method,
      message,
      log: this.log,
      reachable,
      baseUrl: this.baseUrl,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      error: this.error,
    };
  }
}