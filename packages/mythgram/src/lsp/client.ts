import { spawn, type ChildProcess } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LspError, messageOf, toLspError } from "./errors.js";
import { encodeMessage, MessageBuffer, type JsonRpcMessage } from "./protocol.js";
import type { LspServerCandidate, LspServerDefinition } from "./types.js";

/** Signature of Node's `spawn`, injected in tests to observe/replace processes. */
export type SpawnFunction = typeof spawn;

export interface LspClientOptions {
  definition: LspServerDefinition;
  candidate: LspServerCandidate;
  /** Project root used as the server's cwd and workspace folder. */
  root: string;
  workspaceRoot: string;
  requestTimeoutMs: number;
  initializeTimeoutMs: number;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: SpawnFunction;
  clientName?: string;
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
}

interface OpenDocument {
  version: number;
  text: string;
  languageId: string;
}

const MAX_STDERR_CHARS = 8_000;

/**
 * A single long-lived language-server process speaking LSP over stdio.
 *
 * Responsibilities:
 *  - spawn + initialize the server (with `initialized` handshake),
 *  - keep open documents in sync by re-reading them before each operation,
 *  - match request ids to responses, enforce timeouts, and cancel on timeout,
 *  - answer server-initiated requests so the server never blocks,
 *  - reject in-flight requests and clean up when the process dies.
 */
export class LspClient {
  private readonly definition: LspServerDefinition;
  private readonly candidate: LspServerCandidate;
  private readonly root: string;
  private readonly requestTimeoutMs: number;
  private readonly initializeTimeoutMs: number;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly spawnImpl: SpawnFunction;
  private readonly clientName: string;

  private proc: ChildProcess | null = null;
  private readonly reader = new MessageBuffer();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly documents = new Map<string, OpenDocument>();
  private nextId = 1;
  private state: "idle" | "starting" | "ready" | "closed" = "idle";
  private stderr = "";
  private capabilities: Record<string, unknown> = {};
  private exitHandler?: () => void;
  private operationChain: Promise<unknown> = Promise.resolve();

  constructor(options: LspClientOptions) {
    this.definition = options.definition;
    this.candidate = options.candidate;
    this.root = options.root;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.initializeTimeoutMs = options.initializeTimeoutMs;
    this.env = options.env;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.clientName = options.clientName ?? "mythgram";
  }

  get serverName(): string {
    return this.definition.name;
  }

  get closed(): boolean {
    return this.state === "closed";
  }

  /** Spawn and initialize the language server. Safe to call once. */
  async start(): Promise<void> {
    if (this.state === "ready") return;
    if (this.state === "starting") {
      throw new LspError("lsp_already_starting", `${this.definition.name} is already starting.`);
    }
    if (this.state === "closed") {
      throw new LspError("lsp_server_closed", `${this.definition.name} has been closed.`);
    }

    this.state = "starting";

    let proc: ChildProcess;
    try {
      proc = this.spawnImpl(this.candidate.command, [...this.candidate.args], {
        cwd: this.root,
        env: this.env ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      this.state = "closed";
      throw new LspError(
        "lsp_server_start_failed",
        `Could not start ${this.definition.name} (${this.candidate.command}): ${messageOf(error)}`,
      );
    }

    this.proc = proc;
    proc.on("error", (error) => {
      this.fail(
        new LspError(
          "lsp_server_error",
          `Language server ${this.definition.name} failed: ${messageOf(error)}`,
          { stderr: this.stderrTail() },
        ),
      );
    });
    proc.on("exit", (code, signal) => {
      if (this.state === "closed") return;
      const status =
        code !== null
          ? `exited with code ${code}`
          : signal
            ? `was terminated by signal ${signal}`
            : "exited";
      this.fail(
        new LspError("lsp_server_exited", `Language server ${this.definition.name} ${status}.`, {
          stderr: this.stderrTail(),
        }),
      );
    });

    proc.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => this.appendStderr(chunk));

    this.exitHandler = () => this.kill();
    process.once("exit", this.exitHandler);

    try {
      const result = await this.request("initialize", this.initializeParams(), this.initializeTimeoutMs);
      const capabilities =
        result && typeof result === "object"
          ? (result as Record<string, unknown>).capabilities
          : undefined;
      this.capabilities =
        capabilities && typeof capabilities === "object"
          ? (capabilities as Record<string, unknown>)
          : {};
      this.notify("initialized", {});
      this.state = "ready";
    } catch (error) {
      const failure = toLspError(
        error,
        "lsp_initialize_failed",
      );
      const wrapped =
        failure.code === "lsp_request_timeout"
          ? new LspError(
              "lsp_initialize_timeout",
              `${this.definition.name} did not finish initializing within ${this.initializeTimeoutMs}ms.`,
              { command: this.candidate.command, stderr: this.stderrTail() },
            )
          : failure;
      void this.dispose();
      throw wrapped;
    }
  }

  /** Server capabilities returned by `initialize` (may be empty). */
  get serverCapabilities(): Record<string, unknown> {
    return this.capabilities;
  }

  /**
   * Serialize operations on this server. LSP document sync is stateful, so two
   * concurrent tool calls must not interleave `didChange` + requests.
   */
  runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.operationChain.then(task, task);
    this.operationChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Ensure the server has the current on-disk contents for `filePath`. Opens the
   * document the first time and sends a full-text `didChange` when the file has
   * changed since the last operation. Returns the text that was synced.
   */
  async syncDocument(filePath: string, languageId: string): Promise<string> {
    const text = await fsp.readFile(filePath, "utf8");
    const uri = pathToFileURL(filePath).href;
    const existing = this.documents.get(uri);

    if (!existing) {
      this.documents.set(uri, { version: 1, text, languageId });
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
      return text;
    }

    if (existing.text !== text) {
      const version = existing.version + 1;
      this.documents.set(uri, { version, text, languageId });
      this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
      return text;
    }

    return text;
  }

  /** Send a request and resolve with its result. */
  request<T = unknown>(method: string, params: unknown, timeoutMs = this.requestTimeoutMs): Promise<T> {
    if (this.state === "closed") {
      return Promise.reject(
        new LspError("lsp_server_closed", `${this.definition.name} is not running.`),
      );
    }

    const id = this.nextId++;
    const key = String(id);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        try {
          this.notify("$/cancelRequest", { id });
        } catch {
          // best effort — the process may already be gone
        }
        reject(
          new LspError(
            "lsp_request_timeout",
            `${this.definition.name} did not respond to ${method} within ${timeoutMs}ms.`,
            { method, timeout_ms: timeoutMs },
          ),
        );
      }, timeoutMs);
      timer.unref();

      this.pending.set(key, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(error);
      }
    });
  }

  /** Send a notification (fire-and-forget). */
  notify(method: string, params: unknown): void {
    if (this.state === "closed") return;
    this.write({ jsonrpc: "2.0", method, params });
  }

  /** Gracefully shut the server down, then force-kill it if it lingers. */
  async dispose(): Promise<void> {
    if (this.state === "closed") {
      this.kill();
      return;
    }

    try {
      await Promise.race([
        this.request("shutdown", null, 1_000),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 1_000);
          timer.unref();
        }),
      ]);
    } catch {
      // ignore — we are shutting down regardless
    }

    try {
      this.notify("exit", null);
    } catch {
      // ignore
    }

    this.state = "closed";
    this.rejectAll(new LspError("lsp_server_closed", `${this.definition.name} has been closed.`));
    if (this.exitHandler) {
      process.removeListener("exit", this.exitHandler);
      this.exitHandler = undefined;
    }
    this.kill();
  }

  /** Last chunk of the server's stderr, useful in error payloads. */
  stderrTail(): string {
    return this.stderr.trim();
  }

  private initializeParams(): Record<string, unknown> {
    const rootUri = pathToFileURL(this.root).href;
    return {
      processId: process.pid,
      clientInfo: { name: this.clientName, version: "1.0.0" },
      locale: "en",
      rootPath: this.root,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) || this.root }],
      capabilities: {
        workspace: {
          workspaceFolders: true,
          configuration: true,
          symbol: {},
        },
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: false,
          },
          definition: { linkSupport: true },
          references: {},
          hover: { contentFormat: ["markdown", "plaintext"] },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          implementation: {},
          callHierarchy: {},
        },
        window: { workDoneProgress: false },
      },
      initializationOptions: this.definition.initializationOptions ?? null,
      trace: "off",
    };
  }

  private write(message: unknown): void {
    const proc = this.proc;
    if (!proc || !proc.stdin || proc.stdin.destroyed || this.state === "closed") {
      throw new LspError("lsp_server_closed", `${this.definition.name} is not accepting messages.`);
    }
    proc.stdin.write(encodeMessage(message), (error) => {
      if (error) {
        this.fail(
          new LspError(
            "lsp_write_failed",
            `Could not write to ${this.definition.name}: ${messageOf(error)}`,
          ),
        );
      }
    });
  }

  private onData(chunk: Buffer): void {
    let messages: JsonRpcMessage[];
    try {
      messages = this.reader.push(chunk);
    } catch (error) {
      this.fail(new LspError("lsp_protocol_error", messageOf(error), { stderr: this.stderrTail() }));
      return;
    }
    for (const message of messages) this.handleMessage(message);
  }

  private handleMessage(message: JsonRpcMessage): void {
    const hasId = message.id !== undefined && message.id !== null;
    const hasMethod = typeof message.method === "string";

    if (hasId && hasMethod) {
      this.handleServerRequest(message.id as number | string, message.method as string, message.params);
      return;
    }

    if (hasId) {
      this.handleResponse(message);
      return;
    }

    // Notifications from the server (diagnostics, logs, progress) need no reply.
    // `window/showMessage` / `*/logMessage` are intentionally ignored.
  }

  private handleResponse(message: JsonRpcMessage): void {
    const key = String(message.id);
    const pending = this.pending.get(key);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(key);

    if (message.error) {
      const code = typeof message.error.code === "number" ? message.error.code : undefined;
      const detail = message.error.data;
      const errorCode =
        code === -32601 ? "lsp_method_not_supported" : "lsp_request_failed";
      pending.reject(
        new LspError(
          errorCode,
          `${this.definition.name} rejected ${pending.method}: ${
            typeof message.error.message === "string" ? message.error.message : "unknown error"
          }`,
          {
            method: pending.method,
            server_code: code,
            data: detail,
          },
        ),
      );
      return;
    }

    pending.resolve(message.result);
  }

  private handleServerRequest(
    id: number | string,
    method: string,
    params: unknown,
  ): void {
    try {
      const result = this.serverRequestResult(method, params);
      this.write({ jsonrpc: "2.0", id, result });
    } catch (error) {
      try {
        this.write({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: messageOf(error) },
        });
      } catch {
        // the server is already gone
      }
    }
  }

  private serverRequestResult(method: string, params: unknown): unknown {
    switch (method) {
      case "workspace/configuration": {
        const items =
          params && typeof params === "object"
            ? (params as { items?: unknown }).items
            : undefined;
        const settings = this.definition.settings ?? null;
        if (!Array.isArray(items)) return [settings];
        return items.map(() => settings);
      }
      case "workspace/workspaceFolders":
        return [
          {
            uri: pathToFileURL(this.root).href,
            name: path.basename(this.root) || this.root,
          },
        ];
      case "workspace/applyEdit":
        return { applied: false, failureReason: "Workspace edits are not supported by Mythgram." };
      case "window/showMessageRequest":
      case "window/workDoneProgress/create":
      case "client/registerCapability":
      case "client/unregisterCapability":
        return null;
      default:
        return null;
    }
  }

  private appendStderr(chunk: Buffer): void {
    this.stderr += chunk.toString("utf8");
    if (this.stderr.length > MAX_STDERR_CHARS) {
      this.stderr = this.stderr.slice(-MAX_STDERR_CHARS);
    }
  }

  private rejectAll(error: LspError): void {
    for (const [key, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(key);
      pending.reject(error);
    }
  }

  private fail(error: LspError): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.rejectAll(error);
    if (this.exitHandler) {
      process.removeListener("exit", this.exitHandler);
      this.exitHandler = undefined;
    }
    this.kill();
  }

  private kill(): void {
    const proc = this.proc;
    if (!proc) return;
    try {
      proc.stdin?.end();
    } catch {
      // ignore
    }
    try {
      if (!proc.killed) proc.kill("SIGTERM");
    } catch {
      // ignore
    }
    const timer = setTimeout(() => {
      try {
        if (!proc.killed) proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 1_000);
    timer.unref();
  }
}