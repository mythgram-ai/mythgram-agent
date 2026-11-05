import path from "node:path";
import {
  ACP_CLIENT_INFO,
  ACP_ERRORS,
  ACP_PROTOCOL_VERSION,
  type AcpAgentCapabilities,
  type AcpAuthMethod,
  type AcpContentBlock,
  type AcpElicitationRequest,
  type AcpElicitationResponse,
  type AcpImplementation,
  type AcpInitializeResult,
  type AcpNewSessionResult,
  type AcpPermissionOutcome,
  type AcpPermissionRequest,
  type AcpPromptResult,
  type AcpSessionConfigOption,
  type AcpSessionModeState,
  type AcpSessionUpdate,
  type JsonRpcId,
} from "./types.js";
import { JsonRpcError, JsonRpcPeer } from "./jsonrpc.js";
import { spawnAcpAgent, type SpawnedAcpAgent } from "./process.js";
import { AcpFileSystem } from "./filesystem.js";
import { AcpTerminalManager } from "./terminals.js";

/**
 * Low-level ACP client for one connected agent process.
 *
 * Responsibilities:
 *  - spawn/stop the agent process and own its JSON-RPC peer;
 *  - negotiate protocol version + capabilities (`initialize`);
 *  - create/resume/close sessions (`session/new`, `session/resume`, ...);
 *  - run prompt turns (`session/prompt`) and surface every `session/update`;
 *  - serve the client side of the protocol: permission requests, filesystem
 *    methods, terminal methods and elicitation.
 *
 * Higher-level app concerns (persistence, app-owned session ids, SSE fan-out,
 * per-session serialization) live in `manager.ts`.
 */

export interface AcpClientHandlers {
  onSessionUpdate(agentSessionId: string, update: AcpSessionUpdate): void;
  onPermissionRequest(
    agentSessionId: string,
    request: AcpPermissionRequest,
  ): Promise<AcpPermissionOutcome>;
  onElicitationRequest?(
    agentSessionId: string,
    request: AcpElicitationRequest,
  ): Promise<AcpElicitationResponse>;
  onLog(line: string): void;
  onExit(info: { code: number | null; signal: NodeJS.Signals | null; error: Error | null }): void;
}

export interface AcpClientOptions extends AcpClientHandlers {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  workspaceRoot: string;
}

interface RegisteredSession {
  agentSessionId: string;
  cwd: string;
  roots: string[];
}

const INITIALIZE_TIMEOUT_MS = 30_000;
const SESSION_TIMEOUT_MS = 120_000;

export class AcpClient {
  private readonly fileSystem: AcpFileSystem;
  private readonly terminals = new AcpTerminalManager();
  private spawned: SpawnedAcpAgent | null = null;
  private peer: JsonRpcPeer | null = null;
  private readonly sessions = new Map<string, RegisteredSession>();
  private stopped = false;

  private protocolVersion = ACP_PROTOCOL_VERSION;
  private capabilities: AcpAgentCapabilities = {};
  private authMethods: AcpAuthMethod[] = [];
  private agentInfo: AcpImplementation | null = null;

  constructor(private readonly options: AcpClientOptions) {
    this.fileSystem = new AcpFileSystem(options.workspaceRoot);
  }

  get info(): {
    protocolVersion: number;
    capabilities: AcpAgentCapabilities;
    authMethods: AcpAuthMethod[];
    agent: AcpImplementation | null;
    stderr: string[];
  } {
    return {
      protocolVersion: this.protocolVersion,
      capabilities: this.capabilities,
      authMethods: this.authMethods,
      agent: this.agentInfo,
      stderr: this.spawned?.stderr ?? [],
    };
  }

  get isRunning(): boolean {
    return !this.stopped && this.peer != null && !this.peer.isClosed;
  }

  /** Whether this live process currently knows the given agent-side session. */
  hasSession(agentSessionId: string): boolean {
    return this.sessions.has(agentSessionId);
  }

  /** Spawn the agent and negotiate ACP capabilities. */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.stopped = false;
    const spawned = spawnAcpAgent({
      command: this.options.command,
      args: this.options.args,
      env: this.options.env,
      cwd: this.options.cwd,
      onNotification: (method, params) => this.handleNotification(method, params),
      onRequest: (method, params) => this.handleRequest(method, params),
      onExit: (info) => {
        this.sessions.clear();
        this.terminals.closeAll();
        this.options.onExit(info);
      },
      onLog: (line) => this.options.onLog(line),
    });
    this.spawned = spawned;
    this.peer = spawned.peer;

    try {
      const result = await this.peer.request<AcpInitializeResult>(
        "initialize",
        {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
            auth: { terminal: false },
            session: {
              configOptions: { boolean: {} },
              notices: {},
            },
            elicitation: { form: {}, url: {} },
          },
          clientInfo: ACP_CLIENT_INFO,
        },
        INITIALIZE_TIMEOUT_MS,
      );

      if (!result || typeof result.protocolVersion !== "number") {
        throw new Error("The ACP agent returned an invalid initialize response.");
      }
      if (result.protocolVersion !== ACP_PROTOCOL_VERSION) {
        throw new Error(
          `This ACP agent negotiated protocol version ${result.protocolVersion}, but this client supports version ${ACP_PROTOCOL_VERSION}. ` +
            "Use a v1-compatible agent build (most agents support v1).",
        );
      }
      this.protocolVersion = result.protocolVersion;
      this.capabilities = result.agentCapabilities ?? {};
      this.authMethods = Array.isArray(result.authMethods) ? result.authMethods : [];
      this.agentInfo = result.agentInfo ?? null;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  /** Stop the agent process and release everything it owns. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.sessions.clear();
    this.terminals.closeAll();
    const peer = this.peer;
    this.peer = null;
    peer?.close(new Error("ACP client stopped."));
    this.spawned?.kill();
    this.spawned = null;
  }

  /** Create a session on the agent (its id stays private to this client). */
  async newSession(opts: {
    cwd: string;
    mcpServers?: unknown[];
    additionalDirectories?: string[];
  }): Promise<AcpNewSessionResult> {
    const cwd = path.resolve(opts.cwd);
    const result = await this.requirePeer().request<AcpNewSessionResult>(
      "session/new",
      {
        cwd,
        mcpServers: opts.mcpServers ?? [],
        ...(opts.additionalDirectories?.length
          ? { additionalDirectories: opts.additionalDirectories.map((p) => path.resolve(p)) }
          : {}),
      },
      SESSION_TIMEOUT_MS,
    );
    if (!result || typeof result.sessionId !== "string" || result.sessionId.length === 0) {
      throw new Error("The ACP agent did not return a session id.");
    }
    this.registerSession(result.sessionId, cwd, opts.additionalDirectories);
    return result;
  }

  /** Resume a previously-created agent session without replaying history. */
  async resumeSession(
    agentSessionId: string,
    opts: { cwd: string; mcpServers?: unknown[]; additionalDirectories?: string[] },
  ): Promise<{ modes?: AcpSessionModeState | null; configOptions?: AcpSessionConfigOption[] | null }> {
    if (!this.capabilities.sessionCapabilities?.resume) {
      throw new Error("This ACP agent does not support session/resume.");
    }
    const cwd = path.resolve(opts.cwd);
    const result = await this.requirePeer().request<{
      modes?: AcpSessionModeState | null;
      configOptions?: AcpSessionConfigOption[] | null;
    }>(
      "session/resume",
      {
        sessionId: agentSessionId,
        cwd,
        mcpServers: opts.mcpServers ?? [],
        ...(opts.additionalDirectories?.length
          ? { additionalDirectories: opts.additionalDirectories.map((p) => path.resolve(p)) }
          : {}),
      },
      SESSION_TIMEOUT_MS,
    );
    this.registerSession(agentSessionId, cwd, opts.additionalDirectories);
    return result ?? {};
  }

  /** Load an existing agent session, replaying history through `session/update`. */
  async loadSession(
    agentSessionId: string,
    opts: { cwd: string; mcpServers?: unknown[]; additionalDirectories?: string[] },
  ): Promise<{ modes?: AcpSessionModeState | null; configOptions?: AcpSessionConfigOption[] | null }> {
    if (!this.capabilities.loadSession) {
      throw new Error("This ACP agent does not support session/load.");
    }
    const cwd = path.resolve(opts.cwd);
    const result = await this.requirePeer().request<{
      modes?: AcpSessionModeState | null;
      configOptions?: AcpSessionConfigOption[] | null;
    }>(
      "session/load",
      {
        sessionId: agentSessionId,
        cwd,
        mcpServers: opts.mcpServers ?? [],
        ...(opts.additionalDirectories?.length
          ? { additionalDirectories: opts.additionalDirectories.map((p) => path.resolve(p)) }
          : {}),
      },
      SESSION_TIMEOUT_MS,
    );
    this.registerSession(agentSessionId, cwd, opts.additionalDirectories);
    return result ?? {};
  }

  /** Send a prompt turn and resolve when the agent reports its stop reason. */
  async prompt(
    agentSessionId: string,
    blocks: AcpContentBlock[],
    signal?: AbortSignal,
  ): Promise<AcpPromptResult> {
    this.requireSession(agentSessionId);
    const peer = this.requirePeer();
    const cancel = () => {
      void this.cancel(agentSessionId);
    };
    if (signal) {
      if (signal.aborted) {
        cancel();
      } else {
        signal.addEventListener("abort", cancel, { once: true });
      }
    }
    try {
      const result = await peer.request<AcpPromptResult>("session/prompt", {
        sessionId: agentSessionId,
        prompt: blocks,
      });
      if (!result || typeof result.stopReason !== "string") {
        throw new Error("The ACP agent returned an invalid prompt response.");
      }
      return result;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }

  /** Ask the agent to cancel the currently running turn (notification). */
  async cancel(agentSessionId: string): Promise<void> {
    try {
      await this.peer?.notify("session/cancel", { sessionId: agentSessionId });
    } catch {
      // best effort
    }
  }

  /** Authenticate using an agent-advertised method. */
  async authenticate(methodId: string): Promise<void> {
    await this.requirePeer().request(
      "authenticate",
      { methodId },
      SESSION_TIMEOUT_MS,
    );
  }

  async logout(): Promise<void> {
    if (!this.capabilities.auth?.logout) {
      throw new Error("This ACP agent does not support logout.");
    }
    await this.requirePeer().request("logout", {}, SESSION_TIMEOUT_MS);
  }

  /** Switch the agent's session mode (older modes API). */
  async setMode(agentSessionId: string, modeId: string): Promise<void> {
    this.requireSession(agentSessionId);
    await this.requirePeer().request("session/set_mode", {
      sessionId: agentSessionId,
      modeId,
    });
  }

  /** Change a session config option (preferred modern API). */
  async setConfigOption(
    agentSessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<AcpSessionConfigOption[]> {
    this.requireSession(agentSessionId);
    const params: Record<string, unknown> = {
      sessionId: agentSessionId,
      configId,
      value,
    };
    if (typeof value === "boolean") params.type = "boolean";
    const result = await this.requirePeer().request<{ configOptions?: AcpSessionConfigOption[] }>(
      "session/set_config_option",
      params,
      SESSION_TIMEOUT_MS,
    );
    return Array.isArray(result?.configOptions) ? result.configOptions : [];
  }

  /** Close one session on the agent when supported (idempotent by spec). */
  async closeSession(agentSessionId: string): Promise<void> {
    try {
      if (this.capabilities.sessionCapabilities?.close) {
        await this.peer?.request("session/close", { sessionId: agentSessionId }, 15_000);
      } else {
        await this.cancel(agentSessionId);
      }
    } catch {
      // closing is best effort; the session may already be gone
    } finally {
      this.sessions.delete(agentSessionId);
    }
  }

  private registerSession(agentSessionId: string, cwd: string, additionalDirectories?: string[]): void {
    const roots = [
      path.resolve(cwd),
      ...(additionalDirectories ?? []).map((p) => path.resolve(p)),
    ];
    this.sessions.set(agentSessionId, { agentSessionId, cwd, roots });
  }

  private requirePeer(): JsonRpcPeer {
    if (!this.peer || this.peer.isClosed) {
      throw new Error("The ACP agent is not connected.");
    }
    return this.peer;
  }

  private requireSession(agentSessionId: string): RegisteredSession {
    const session = this.sessions.get(agentSessionId);
    if (!session) {
      throw new JsonRpcError(ACP_ERRORS.resourceNotFound, `Unknown session "${agentSessionId}".`, {
        sessionId: agentSessionId,
      });
    }
    return session;
  }

  private handleNotification(method: string, params: unknown): void {
    if (method !== "session/update") return;
    const rec = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    const sessionId = typeof rec.sessionId === "string" ? rec.sessionId : "";
    const update = rec.update && typeof rec.update === "object"
      ? (rec.update as AcpSessionUpdate)
      : null;
    if (!sessionId || !update || typeof update.sessionUpdate !== "string") return;
    this.options.onSessionUpdate(sessionId, update);
  }

  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    const rec = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    switch (method) {
      case "session/request_permission":
        return this.handlePermission(rec);
      case "fs/read_text_file": {
        const session = this.requireSession(typeof rec.sessionId === "string" ? rec.sessionId : "");
        return this.fileSystem.readTextFile(rec, session.roots);
      }
      case "fs/write_text_file": {
        const session = this.requireSession(typeof rec.sessionId === "string" ? rec.sessionId : "");
        return this.fileSystem.writeTextFile(rec, session.roots);
      }
      case "terminal/create": {
        const session = this.requireSession(typeof rec.sessionId === "string" ? rec.sessionId : "");
        const cwd =
          typeof rec.cwd === "string" && rec.cwd.length > 0
            ? this.fileSystem.assertAllowed(rec.cwd, session.roots)
            : session.cwd;
        return this.terminals.create(rec, cwd);
      }
      case "terminal/output":
        this.requireSession(typeof rec.sessionId === "string" ? rec.sessionId : "");
        return this.terminals.output(typeof rec.terminalId === "string" ? rec.terminalId : "");
      case "terminal/wait_for_exit":
        this.requireSession(typeof rec.sessionId === "string" ? rec.sessionId : "");
        return this.terminals.waitForExit(typeof rec.terminalId === "string" ? rec.terminalId : "");
      case "terminal/kill":
        this.requireSession(typeof rec.sessionId === "string" ? rec.sessionId : "");
        return this.terminals.kill(typeof rec.terminalId === "string" ? rec.terminalId : "");
      case "terminal/release":
        this.requireSession(typeof rec.sessionId === "string" ? rec.sessionId : "");
        return this.terminals.release(typeof rec.terminalId === "string" ? rec.terminalId : "");
      case "elicitation/create":
        return this.handleElicitation(rec);
      default:
        throw new JsonRpcError(ACP_ERRORS.methodNotFound, `Method not found: ${method}`, { method });
    }
  }

  private async handlePermission(rec: Record<string, unknown>): Promise<{ outcome: AcpPermissionOutcome }> {
    const sessionId = typeof rec.sessionId === "string" ? rec.sessionId : "";
    const toolCall = rec.toolCall && typeof rec.toolCall === "object"
      ? (rec.toolCall as AcpPermissionRequest["toolCall"])
      : null;
    const options = Array.isArray(rec.options)
      ? (rec.options as AcpPermissionRequest["options"])
      : [];
    if (!sessionId || !toolCall) {
      throw new JsonRpcError(ACP_ERRORS.invalidParams, "Invalid session/request_permission params.");
    }
    const outcome = await this.options.onPermissionRequest(sessionId, {
      sessionId,
      toolCall,
      options,
    });
    return { outcome };
  }

  private async handleElicitation(rec: Record<string, unknown>): Promise<AcpElicitationResponse> {
    const request = rec as unknown as AcpElicitationRequest;
    if (typeof request.mode !== "string" || typeof request.message !== "string") {
      throw new JsonRpcError(ACP_ERRORS.invalidParams, "Invalid elicitation/create params.");
    }
    if (!this.options.onElicitationRequest) {
      return { action: "decline" };
    }
    const sessionId = typeof request.sessionId === "string" ? request.sessionId : "";
    return this.options.onElicitationRequest(sessionId, request);
  }
}

/** Convenience type for request ids used by the manager's pending maps. */
export type AcpRequestId = JsonRpcId;