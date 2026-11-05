import path from "node:path";
import type { MythgramDatabase } from "../database/index.js";
import type { AcpClientRow, AcpSessionRow } from "../database/index.js";
import {
  ACP_PROTOCOL_VERSION,
  type AcpAuthMethod,
  type AcpClientInput,
  type AcpClientPublic,
  type AcpClientStatus,
  type AcpElicitationRequest,
  type AcpElicitationResponse,
  type AcpImplementation,
  type AcpPermissionOption,
  type AcpPermissionOutcome,
  type AcpPermissionRequest,
  type AcpSessionConfigOption,
  type AcpSessionDetail,
  type AcpSessionMeta,
  type AcpSessionPublic,
  type AcpSessionUpdate,
  type AcpStoredSessionEvent,
  type AcpValidateResult,
} from "./types.js";
import { AcpClient } from "./client.js";
import { createPendingRequestId, createUniqueAcpId, isAcpNumericId } from "./ids.js";

/**
 * Application-level ACP client manager.
 *
 * Owns:
 *  - connection configs (SQLite) with our own 20-digit numeric ids;
 *  - live agent processes (one per connected config, spawned on demand);
 *  - application-owned sessions (our 20-digit ids; the agent's id stays private);
 *  - ordered per-session event history (persisted and replayable);
 *  - prompt serialization, cancellation, permission/elicitation round-trips;
 *  - SSE fan-out to the currently attached browser panel.
 */

export class AcpClientError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "acp_client_error",
  ) {
    super(message);
    this.name = "AcpClientError";
  }
}

type Emit = (event: string, data: unknown) => void;

interface PendingPermission {
  kind: "permission";
  requestId: string;
  sessionId: string;
  options: AcpPermissionOption[];
  resolve: (outcome: AcpPermissionOutcome) => void;
  timer: NodeJS.Timeout | null;
}

interface PendingElicitation {
  kind: "elicitation";
  requestId: string;
  sessionId: string;
  resolve: (response: AcpElicitationResponse) => void;
  timer: NodeJS.Timeout | null;
}

interface SessionRuntime {
  record: AcpSessionRow;
  agentSessionId: string;
  status: string;
  running: boolean;
  abort: AbortController | null;
  meta: AcpSessionMeta;
  events: AcpStoredSessionEvent[];
  emit: Emit | null;
  pending: Map<string, PendingPermission | PendingElicitation>;
  flushTimer: NodeJS.Timeout | null;
  cancelTimer: NodeJS.Timeout | null;
  restartNotice: { title: string; description: string; severity: string } | null;
}

interface ConnectionRuntime {
  clientId: string;
  client: AcpClient;
  status: AcpClientStatus;
  error: string | null;
  agent: AcpImplementation | null;
  authMethods: AcpAuthMethod[];
  capabilities: AcpClient["info"]["capabilities"] | null;
  protocolVersion: number | null;
  stderr: string[];
  starting: Promise<void> | null;
  stopping: boolean;
  config: AcpClientRow;
}

interface AcpPromptParams {
  clientId: string;
  sessionId: string;
  text: string;
  emit: Emit;
  signal?: AbortSignal;
}

const MAX_EVENT_HISTORY = 4000;
const PERMISSION_TIMEOUT_MS = 15 * 60 * 1000;
const CANCEL_FORCE_MS = 15_000;
const PERSIST_FLUSH_MS = 1200;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function publicSession(record: AcpSessionRow, runtime?: SessionRuntime): AcpSessionPublic {
  const current = runtime?.record ?? record;
  const status = runtime?.status ?? (current.status === "running" ? "active" : current.status);
  return {
    id: current.id,
    clientId: current.clientId,
    title: current.title,
    status,
    running: runtime?.running ?? false,
    meta: (runtime?.meta ?? current.meta) as AcpSessionMeta,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  };
}

function normalizeEnv(raw: unknown): Record<string, string> {
  const rec = asRecord(raw);
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(rec)) {
    if (count >= 100) break;
    const name = key.trim();
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    if (typeof value !== "string") continue;
    out[name] = value;
    count += 1;
  }
  return out;
}

function normalizeArgs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 100);
}

export class AcpClientManager {
  private readonly runtimes = new Map<string, ConnectionRuntime>();
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly pendingRequests = new Map<string, PendingPermission | PendingElicitation>();

  constructor(
    private readonly db: MythgramDatabase,
    private readonly workspaceRoot: string,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Connections                                                         */
  /* ------------------------------------------------------------------ */

  listClients(): AcpClientPublic[] {
    return this.db.acpClients.listClients().map((row) => this.publicClient(row));
  }

  getClient(id: string): AcpClientPublic {
    const row = this.requireClientRow(id);
    return this.publicClient(row);
  }

  createClient(raw: unknown): AcpClientPublic {
    const input = this.normalizeInput(raw);
    const id = createUniqueAcpId((candidate) => Boolean(this.db.acpClients.getClient(candidate)));
    const now = Date.now();
    const row: AcpClientRow = { id, ...input, createdAt: now, updatedAt: now };
    this.db.acpClients.saveClient(row);
    return this.publicClient(row);
  }

  updateClient(id: string, raw: unknown): AcpClientPublic {
    const existing = this.requireClientRow(id);
    const input = this.normalizeInput(raw);
    const row: AcpClientRow = {
      ...existing,
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    // A changed launch config invalidates the running process; stop it and let the
    // user reconnect with the new command.
    if (this.runtimes.has(id)) this.disconnect(id).catch(() => undefined);
    this.db.acpClients.saveClient(row);
    return this.publicClient(row);
  }

  async deleteClient(id: string): Promise<void> {
    this.requireClientRow(id);
    await this.disconnect(id).catch(() => undefined);
    for (const [sessionId, runtime] of this.sessions) {
      if (runtime.record.clientId === id) {
        this.disposeSessionRuntime(runtime);
        this.sessions.delete(sessionId);
      }
    }
    this.db.acpClients.deleteClient(id);
  }

  async connect(id: string): Promise<AcpClientPublic> {
    const row = this.requireClientRow(id);
    if (!row.enabled) {
      throw new AcpClientError("This ACP agent is disabled. Enable it before connecting.", 400, "acp_disabled");
    }
    const existing = this.runtimes.get(id);
    if (existing) {
      if (existing.starting) await existing.starting;
      if (existing.status === "connected" && existing.client.isRunning) {
        return this.publicClient(row);
      }
      if (existing.status === "connecting") return this.publicClient(row);
      // Failed/stopped runtime: tear it down and start fresh.
      this.disposeRuntime(existing);
      this.runtimes.delete(id);
    }

    const runtime = this.createRuntime(row);
    this.runtimes.set(id, runtime);
    runtime.starting = (async () => {
      try {
        await runtime.client.start();
        runtime.status = "connected";
        runtime.error = null;
        const info = runtime.client.info;
        runtime.agent = info.agent;
        runtime.authMethods = info.authMethods;
        runtime.capabilities = info.capabilities;
        runtime.protocolVersion = info.protocolVersion;
        runtime.stderr = info.stderr;
      } catch (error) {
        runtime.status = "error";
        runtime.error = error instanceof Error ? error.message : String(error);
        runtime.stderr = runtime.client.info.stderr;
        runtime.stopping = true;
        runtime.client.stop();
        throw new AcpClientError(runtime.error, 502, "acp_connect_failed");
      } finally {
        runtime.starting = null;
      }
    })();

    try {
      await runtime.starting;
      return this.publicClient(row);
    } catch (error) {
      throw error instanceof AcpClientError
        ? error
        : new AcpClientError(error instanceof Error ? error.message : String(error), 502, "acp_connect_failed");
    }
  }

  async disconnect(id: string): Promise<AcpClientPublic> {
    const row = this.requireClientRow(id);
    const runtime = this.runtimes.get(id);
    if (runtime) {
      runtime.stopping = true;
      runtime.status = "disconnected";
      runtime.client.stop();
      this.disposeRuntime(runtime);
      this.runtimes.delete(id);
      for (const session of this.sessions.values()) {
        if (session.record.clientId !== id) continue;
        session.abort?.abort();
        this.resolvePendingForSession(session, "cancelled");
      }
    }
    return this.publicClient(row);
  }

  async validate(raw: unknown): Promise<AcpValidateResult> {
    const input = this.normalizeInput(raw);
    const client = new AcpClient({
      command: input.command,
      args: input.args,
      env: input.env,
      cwd: input.cwd,
      workspaceRoot: this.workspaceRoot,
      onSessionUpdate: () => undefined,
      onPermissionRequest: async () => ({ outcome: "cancelled" }),
      onLog: () => undefined,
      onExit: () => undefined,
    });
    try {
      await client.start();
      const info = client.info;
      return {
        ok: true,
        agent: info.agent,
        protocolVersion: info.protocolVersion,
        authMethods: info.authMethods,
        capabilities: info.capabilities,
      };
    } catch (error) {
      throw new AcpClientError(
        error instanceof Error ? error.message : String(error),
        502,
        "acp_validate_failed",
      );
    } finally {
      client.stop();
    }
  }

  async authenticate(id: string, methodId: string): Promise<AcpClientPublic> {
    const runtime = await this.ensureRuntime(id);
    const method = runtime.authMethods.find((entry) => entry.id === methodId);
    if (!method) throw new AcpClientError("Unknown authentication method.", 400);
    if (method.type === "terminal") {
      throw new AcpClientError(
        `This agent uses terminal authentication. Run "${runtime.config.command} ${[
          ...runtime.config.args,
          ...(method.args ?? []),
        ].join(" ")}" in an interactive terminal, then reconnect.`,
        400,
        "acp_terminal_auth_required",
      );
    }
    try {
      await runtime.client.authenticate(methodId);
      return this.publicClient(runtime.config);
    } catch (error) {
      throw new AcpClientError(
        error instanceof Error ? error.message : String(error),
        502,
        "acp_authenticate_failed",
      );
    }
  }

  async logout(id: string): Promise<AcpClientPublic> {
    const runtime = await this.ensureRuntime(id);
    try {
      await runtime.client.logout();
      return this.publicClient(runtime.config);
    } catch (error) {
      throw new AcpClientError(
        error instanceof Error ? error.message : String(error),
        502,
        "acp_logout_failed",
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sessions                                                            */
  /* ------------------------------------------------------------------ */

  listSessions(clientId: string): AcpSessionPublic[] {
    this.requireClientRow(clientId);
    return this.db.acpClients
      .listSessions(clientId)
      .map((record) => publicSession(record, this.sessions.get(record.id)));
  }

  async createSession(clientId: string, raw?: unknown): Promise<AcpSessionPublic> {
    const row = this.requireClientRow(clientId);
    const runtime = await this.ensureRuntime(clientId);
    const body = asRecord(raw);
    const title = str(body.title).trim().slice(0, 200);

    try {
      const result = await runtime.client.newSession({ cwd: row.cwd || this.workspaceRoot });
      const id = createUniqueAcpId((candidate) => Boolean(this.db.acpClients.getSession(candidate)));
      const now = Date.now();
      const meta: AcpSessionMeta = {
        modes: result.modes ?? null,
        configOptions: result.configOptions ?? null,
        agent: runtime.agent,
        protocolVersion: runtime.protocolVersion ?? ACP_PROTOCOL_VERSION,
      };
      const record: AcpSessionRow = {
        id,
        clientId,
        agentSessionId: result.sessionId,
        title: title || "New session",
        status: "active",
        meta,
        createdAt: now,
        updatedAt: now,
      };
      this.db.acpClients.saveSession(record);
      const session = this.createSessionRuntime(record);
      session.agentSessionId = result.sessionId;
      session.meta = meta;
      this.sessions.set(id, session);
      return publicSession(record, session);
    } catch (error) {
      throw this.sessionError(error);
    }
  }

  getSession(clientId: string, sessionId: string): AcpSessionDetail {
    this.requireClientRow(clientId);
    const record = this.requireSessionRow(clientId, sessionId);
    const runtime = this.sessions.get(sessionId);
    const events = runtime && runtime.events.length > 0
      ? runtime.events
      : this.db.acpClients.listEvents(sessionId);
    return {
      ...publicSession(record, runtime),
      events,
    };
  }

  async deleteSession(clientId: string, sessionId: string): Promise<void> {
    this.requireClientRow(clientId);
    const record = this.requireSessionRow(clientId, sessionId);
    const runtime = this.sessions.get(sessionId);
    if (runtime) {
      if (runtime.running) await this.cancel(clientId, sessionId);
      const conn = this.runtimes.get(clientId);
      if (conn?.status === "connected") {
        await conn.client.closeSession(runtime.agentSessionId).catch(() => undefined);
      }
      this.disposeSessionRuntime(runtime);
      this.sessions.delete(sessionId);
    }
    this.db.acpClients.deleteSession(record.id);
  }

  isSessionRunning(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.running ?? false;
  }

  async setSessionMode(clientId: string, sessionId: string, modeId: string): Promise<AcpSessionPublic> {
    const record = this.requireSessionRow(clientId, sessionId);
    const runtime = await this.ensureRuntime(clientId);
    const session = await this.ensureSessionOnAgent(runtime, record);
    if (!modeId.trim()) throw new AcpClientError("A mode id is required.", 400);
    try {
      await runtime.client.setMode(session.agentSessionId, modeId.trim());
      const modes = session.meta.modes;
      if (modes) {
        session.meta = { ...session.meta, modes: { ...modes, currentModeId: modeId.trim() } };
      }
      this.touchSession(session);
      return publicSession(session.record, session);
    } catch (error) {
      throw this.sessionError(error);
    }
  }

  async setSessionConfig(
    clientId: string,
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<AcpSessionPublic> {
    const record = this.requireSessionRow(clientId, sessionId);
    const runtime = await this.ensureRuntime(clientId);
    const session = await this.ensureSessionOnAgent(runtime, record);
    if (!configId.trim()) throw new AcpClientError("A config option id is required.", 400);
    try {
      const configOptions: AcpSessionConfigOption[] = await runtime.client.setConfigOption(
        session.agentSessionId,
        configId.trim(),
        value,
      );
      session.meta = { ...session.meta, configOptions };
      this.touchSession(session);
      return publicSession(session.record, session);
    } catch (error) {
      throw this.sessionError(error);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Prompt turn                                                         */
  /* ------------------------------------------------------------------ */

  async prompt(params: AcpPromptParams): Promise<void> {
    const { clientId, sessionId, emit } = params;
    this.requireClientRow(clientId);
    const record = this.requireSessionRow(clientId, sessionId);
    const text = params.text.trim();
    if (!text) throw new AcpClientError("A message is required.", 400);
    if (text.length > 200_000) throw new AcpClientError("The message is too large.", 413);

    const runtime = await this.ensureRuntime(clientId);
    const session = await this.ensureSessionOnAgent(runtime, record);
    if (session.running) throw new AcpClientError("A prompt is already running in this session.", 409);

    const controller = new AbortController();
    session.running = true;
    session.status = "running";
    session.emit = emit;
    session.abort = controller;
    if (session.restartNotice) {
      const notice = session.restartNotice;
      session.restartNotice = null;
      this.pushEvent(
        session,
        {
          seq: 0,
          event: "notice",
          data: { sessionId, ...notice },
          createdAt: Date.now(),
        },
        true,
      );
    }
    this.touchSession(session);

    const userEvent: AcpStoredSessionEvent = {
      seq: session.events.length,
      event: "user",
      data: { sessionId, text, createdAt: Date.now() },
      createdAt: Date.now(),
    };
    this.pushEvent(session, userEvent, true);
    this.send(session, "status", { sessionId, status: "running" });

    let stopReason = "end_turn";
    let failed: string | null = null;
    try {
      const result = await runtime.client.prompt(
        session.agentSessionId,
        [{ type: "text", text }],
        controller.signal,
      );
      stopReason = result.stopReason;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (controller.signal.aborted || code === -32800) {
        stopReason = "cancelled";
      } else {
        failed = error instanceof Error ? error.message : String(error);
        stopReason = "error";
        this.pushEvent(
          session,
          {
            seq: 0,
            event: "error",
            data: { sessionId, message: failed },
            createdAt: Date.now(),
          },
          true,
        );
      }
    } finally {
      session.running = false;
      if (session.abort === controller) session.abort = null;
      if (session.cancelTimer) {
        clearTimeout(session.cancelTimer);
        session.cancelTimer = null;
      }
      this.resolvePendingForSession(session, "cancelled");
      session.status = failed ? "error" : "active";
      const doneEvent: AcpStoredSessionEvent = {
        seq: 0,
        event: "done",
        data: { sessionId, stopReason },
        createdAt: Date.now(),
      };
      // Emit `done` on the still-attached stream before releasing it.
      this.pushEvent(session, doneEvent, true);
      this.send(session, "status", { sessionId, status: session.status });
      session.emit = null;
      this.persistSession(session);
    }
  }

  async cancel(clientId: string, sessionId: string): Promise<void> {
    this.requireClientRow(clientId);
    const record = this.requireSessionRow(clientId, sessionId);
    const session = this.sessions.get(sessionId);
    if (!session || !session.running) return;

    this.resolvePendingForSession(session, "cancelled");
    if (session.abort) {
      // AcpClient.prompt listens for this and sends `session/cancel`.
      session.abort.abort();
    } else {
      const runtime = this.runtimes.get(clientId);
      if (runtime?.status === "connected") {
        await runtime.client.cancel(session.agentSessionId).catch(() => undefined);
      }
    }
    if (!session.cancelTimer) {
      session.cancelTimer = setTimeout(() => {
        session.cancelTimer = null;
        if (!session.running) return;
        // An agent that ignores session/cancel must not leave the UI stuck.
        const conn = this.runtimes.get(clientId);
        if (conn) {
          conn.stopping = true;
          conn.client.stop();
        }
        session.abort?.abort();
      }, CANCEL_FORCE_MS);
      session.cancelTimer.unref?.();
    }
    void record;
  }

  /* ------------------------------------------------------------------ */
  /* Permission / elicitation responses                                  */
  /* ------------------------------------------------------------------ */

  resolvePermission(
    clientId: string,
    sessionId: string,
    requestId: string,
    optionId: string | null,
  ): void {
    this.requireClientRow(clientId);
    this.requireSessionRow(clientId, sessionId);
    const key = this.pendingKey(sessionId, requestId);
    const pending = this.pendingRequests.get(key);
    if (!pending || pending.kind !== "permission") {
      throw new AcpClientError("That permission request is no longer pending.", 404, "acp_request_not_found");
    }
    if (optionId !== null && !pending.options.some((option) => option.optionId === optionId)) {
      throw new AcpClientError("Unknown permission option.", 400, "acp_invalid_option");
    }
    this.pendingRequests.delete(key);
    if (pending.timer) clearTimeout(pending.timer);
    pending.resolve(optionId === null ? { outcome: "cancelled" } : { outcome: "selected", optionId });
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pending.delete(requestId);
      this.pushEvent(
        session,
        {
          seq: 0,
          event: "permission_resolved",
          data: { sessionId, requestId },
          createdAt: Date.now(),
        },
        true,
      );
    }
  }

  resolveElicitation(
    clientId: string,
    sessionId: string,
    requestId: string,
    response: AcpElicitationResponse,
  ): void {
    this.requireClientRow(clientId);
    this.requireSessionRow(clientId, sessionId);
    const key = this.pendingKey(sessionId, requestId);
    const pending = this.pendingRequests.get(key);
    if (!pending || pending.kind !== "elicitation") {
      throw new AcpClientError("That elicitation request is no longer pending.", 404, "acp_request_not_found");
    }
    this.pendingRequests.delete(key);
    if (pending.timer) clearTimeout(pending.timer);
    pending.resolve(response);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pending.delete(requestId);
      this.pushEvent(
        session,
        {
          seq: 0,
          event: "elicitation_resolved",
          data: { sessionId, requestId },
          createdAt: Date.now(),
        },
        true,
      );
    }
  }

  /** Stop every agent process (server shutdown). */
  closeAll(): void {
    for (const runtime of this.runtimes.values()) {
      runtime.stopping = true;
      runtime.client.stop();
    }
    for (const session of this.sessions.values()) {
      session.abort?.abort();
      this.disposeSessionRuntime(session);
    }
    this.runtimes.clear();
    this.sessions.clear();
    this.pendingRequests.clear();
  }

  /* ------------------------------------------------------------------ */
  /* Internal                                                            */
  /* ------------------------------------------------------------------ */

  private normalizeInput(raw: unknown): AcpClientInput {
    const body = asRecord(raw);
    const command = str(body.command).trim();
    if (!command) throw new AcpClientError("An ACP agent command is required.", 400);
    if (command.length > 1024) throw new AcpClientError("The command is too long.", 400);
    const name = str(body.name).trim().slice(0, 120) || command.split(/\s+/)[0] || "ACP agent";
    const cwdRaw = str(body.cwd).trim();
    const cwd = cwdRaw
      ? path.isAbsolute(cwdRaw)
        ? path.normalize(cwdRaw)
        : path.resolve(this.workspaceRoot, cwdRaw)
      : this.workspaceRoot;
    return {
      name,
      command,
      args: normalizeArgs(body.args),
      env: normalizeEnv(body.env),
      cwd,
      enabled: body.enabled === false ? false : true,
    };
  }

  private requireClientRow(id: string): AcpClientRow {
    if (!isAcpNumericId(id)) throw new AcpClientError("Invalid ACP agent id.", 400, "acp_invalid_id");
    const row = this.db.acpClients.getClient(id);
    if (!row) throw new AcpClientError("ACP agent not found.", 404, "acp_agent_not_found");
    return row;
  }

  private requireSessionRow(clientId: string, sessionId: string): AcpSessionRow {
    if (!isAcpNumericId(sessionId)) throw new AcpClientError("Invalid session id.", 400, "acp_invalid_id");
    const row = this.db.acpClients.getSession(sessionId);
    if (!row || row.clientId !== clientId) {
      throw new AcpClientError("Session not found.", 404, "acp_session_not_found");
    }
    return row;
  }

  private publicClient(row: AcpClientRow): AcpClientPublic {
    const runtime = this.runtimes.get(row.id);
    let status: AcpClientStatus = runtime?.status ?? "disconnected";
    if (status === "connected" && runtime && !runtime.client.isRunning) status = "disconnected";
    return {
      ...row,
      status,
      error: runtime?.error ?? null,
      agent: runtime?.agent ?? null,
      protocolVersion: runtime?.protocolVersion ?? null,
      authMethods: runtime?.authMethods ?? [],
      capabilities: runtime?.capabilities ?? null,
      sessions: this.db.acpClients.listSessions(row.id).length,
      stderr: (runtime?.stderr ?? []).slice(-40),
    };
  }

  private createRuntime(row: AcpClientRow): ConnectionRuntime {
    const runtime: ConnectionRuntime = {
      clientId: row.id,
      client: null as unknown as AcpClient,
      status: "connecting",
      error: null,
      agent: null,
      authMethods: [],
      capabilities: null,
      protocolVersion: null,
      stderr: [],
      starting: null,
      stopping: false,
      config: row,
    };
    runtime.client = new AcpClient({
      command: row.command,
      args: row.args,
      env: row.env,
      cwd: row.cwd || this.workspaceRoot,
      workspaceRoot: this.workspaceRoot,
      onSessionUpdate: (agentSessionId, update) => this.onSessionUpdate(runtime, agentSessionId, update),
      onPermissionRequest: (agentSessionId, request) =>
        this.onPermissionRequest(runtime, agentSessionId, request),
      onElicitationRequest: (agentSessionId, request) =>
        this.onElicitationRequest(runtime, agentSessionId, request),
      onLog: (line) => {
        runtime.stderr.push(line.length > 2000 ? `${line.slice(0, 2000)}…` : line);
        if (runtime.stderr.length > 200) runtime.stderr.splice(0, runtime.stderr.length - 200);
      },
      onExit: (info) => this.onRuntimeExit(runtime, info),
    });
    return runtime;
  }

  private onRuntimeExit(
    runtime: ConnectionRuntime,
    info: { code: number | null; signal: NodeJS.Signals | null; error: Error | null },
  ): void {
    if (runtime.stopping) return;
    const detail =
      info.error?.message ??
      `ACP agent exited (code=${info.code ?? "null"}, signal=${info.signal ?? "null"}).`;
    runtime.status = "error";
    runtime.error = detail;
    runtime.stderr.push(`[exit] ${detail}`);
    for (const session of this.sessions.values()) {
      if (session.record.clientId !== runtime.clientId) continue;
      if (!session.running) continue;
      this.pushEvent(
        session,
        {
          seq: 0,
          event: "error",
          data: { sessionId: session.record.id, message: detail },
          createdAt: Date.now(),
        },
        true,
      );
      session.abort?.abort();
    }
  }

  private disposeRuntime(runtime: ConnectionRuntime): void {
    runtime.stopping = true;
    runtime.client.stop();
  }

  private async ensureRuntime(clientId: string): Promise<ConnectionRuntime> {
    const row = this.requireClientRow(clientId);
    if (!row.enabled) throw new AcpClientError("This ACP agent is disabled.", 400, "acp_disabled");
    const existing = this.runtimes.get(clientId);
    if (existing?.starting) await existing.starting;
    if (existing && existing.status === "connected" && existing.client.isRunning) return existing;
    await this.connect(clientId);
    const connected = this.runtimes.get(clientId);
    if (!connected || connected.status !== "connected") {
      throw new AcpClientError(connected?.error ?? "Could not connect to the ACP agent.", 502, "acp_connect_failed");
    }
    return connected;
  }

  private createSessionRuntime(record: AcpSessionRow): SessionRuntime {
    return {
      record,
      agentSessionId: record.agentSessionId,
      status: record.status === "running" ? "active" : record.status,
      running: false,
      abort: null,
      meta: (record.meta ?? {}) as AcpSessionMeta,
      events: this.db.acpClients.listEvents(record.id),
      emit: null,
      pending: new Map(),
      flushTimer: null,
      cancelTimer: null,
      restartNotice: null,
    };
  }

  private async ensureSessionOnAgent(
    runtime: ConnectionRuntime,
    record: AcpSessionRow,
  ): Promise<SessionRuntime> {
    let session = this.sessions.get(record.id);
    if (!session) {
      session = this.createSessionRuntime(record);
      this.sessions.set(record.id, session);
    }

    // Already registered on this live process.
    if (session.agentSessionId && runtime.client.hasSession(session.agentSessionId)) {
      return session;
    }

    // Reconnect to a previously created agent-side session when it can be resumed
    // without replay. Otherwise create a fresh agent session (the app keeps the
    // full chat history, but the agent-side context starts over).
    if (record.agentSessionId) {
      try {
        if (runtime.client.info.capabilities.sessionCapabilities?.resume) {
          const resumed = await runtime.client.resumeSession(record.agentSessionId, {
            cwd: record.clientId ? this.requireClientRow(record.clientId).cwd : this.workspaceRoot,
          });
          session.agentSessionId = record.agentSessionId;
          session.meta = {
            ...session.meta,
            ...(resumed.modes ? { modes: resumed.modes } : {}),
            ...(resumed.configOptions ? { configOptions: resumed.configOptions } : {}),
          };
          return session;
        }
      } catch {
        // fall through to a new agent session
      }
    }

    const created = await runtime.client.newSession({
      cwd: this.requireClientRow(record.clientId).cwd || this.workspaceRoot,
    });
    session.agentSessionId = created.sessionId;
    session.record = {
      ...session.record,
      agentSessionId: created.sessionId,
      meta: {
        ...session.meta,
        ...(created.modes ? { modes: created.modes } : {}),
        ...(created.configOptions ? { configOptions: created.configOptions } : {}),
      },
      updatedAt: Date.now(),
    };
    session.meta = session.record.meta as AcpSessionMeta;
    this.db.acpClients.saveSession(session.record);
    if (record.agentSessionId) {
      session.restartNotice = {
        title: "Agent process restarted",
        description:
          "The agent-side session was recreated. Previous messages are still shown here, but the agent no longer has that conversation context.",
        severity: "warning",
      };
    }
    return session;
  }

  private onSessionUpdate(
    runtime: ConnectionRuntime,
    agentSessionId: string,
    update: AcpSessionUpdate,
  ): void {
    const session = this.findSessionByAgentId(runtime.clientId, agentSessionId);
    if (!session) return;
    this.reduceSessionMeta(session, update);
    this.pushEvent(
      session,
      {
        seq: 0,
        event: "update",
        data: { sessionId: session.record.id, update },
        createdAt: Date.now(),
      },
      true,
    );
  }

  private async onPermissionRequest(
    runtime: ConnectionRuntime,
    agentSessionId: string,
    request: AcpPermissionRequest,
  ): Promise<AcpPermissionOutcome> {
    const session = this.findSessionByAgentId(runtime.clientId, agentSessionId);
    if (!session || !session.emit) {
      // No UI is attached: deny safely instead of hanging the agent.
      const reject = request.options.find((option) => option.kind === "reject_once") ??
        request.options.find((option) => option.kind === "reject_always");
      return reject ? { outcome: "selected", optionId: reject.optionId } : { outcome: "cancelled" };
    }
    const requestId = createPendingRequestId();
    return new Promise<AcpPermissionOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(this.pendingKey(session.record.id, requestId));
        session.pending.delete(requestId);
        const reject = request.options.find((option) => option.kind === "reject_once") ??
          request.options.find((option) => option.kind === "reject_always");
        resolve(reject ? { outcome: "selected", optionId: reject.optionId } : { outcome: "cancelled" });
        this.pushEvent(
          session,
          {
            seq: 0,
            event: "permission_resolved",
            data: { sessionId: session.record.id, requestId },
            createdAt: Date.now(),
          },
          true,
        );
      }, PERMISSION_TIMEOUT_MS);
      timer.unref?.();
      const pending: PendingPermission = {
        kind: "permission",
        requestId,
        sessionId: session.record.id,
        options: request.options,
        resolve: (outcome) => {
          if (timer) clearTimeout(timer);
          resolve(outcome);
        },
        timer,
      };
      this.pendingRequests.set(this.pendingKey(session.record.id, requestId), pending);
      session.pending.set(requestId, pending);
      this.pushEvent(
        session,
        {
          seq: 0,
          event: "permission_request",
          data: {
            sessionId: session.record.id,
            requestId,
            toolCall: request.toolCall,
            options: request.options,
          },
          createdAt: Date.now(),
        },
        true,
      );
    });
  }

  private async onElicitationRequest(
    runtime: ConnectionRuntime,
    agentSessionId: string,
    request: AcpElicitationRequest,
  ): Promise<AcpElicitationResponse> {
    const session = this.findSessionByAgentId(runtime.clientId, agentSessionId);
    if (!session || !session.emit) return { action: "decline" };
    const requestId = createPendingRequestId();
    return new Promise<AcpElicitationResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(this.pendingKey(session.record.id, requestId));
        session.pending.delete(requestId);
        resolve({ action: "cancel" });
        this.pushEvent(
          session,
          {
            seq: 0,
            event: "elicitation_resolved",
            data: { sessionId: session.record.id, requestId },
            createdAt: Date.now(),
          },
          true,
        );
      }, PERMISSION_TIMEOUT_MS);
      timer.unref?.();
      const pending: PendingElicitation = {
        kind: "elicitation",
        requestId,
        sessionId: session.record.id,
        resolve: (response) => {
          if (timer) clearTimeout(timer);
          resolve(response);
        },
        timer,
      };
      this.pendingRequests.set(this.pendingKey(session.record.id, requestId), pending);
      session.pending.set(requestId, pending);
      this.pushEvent(
        session,
        {
          seq: 0,
          event: "elicitation_request",
          data: { sessionId: session.record.id, requestId, request },
          createdAt: Date.now(),
        },
        true,
      );
    });
  }

  private findSessionByAgentId(clientId: string, agentSessionId: string): SessionRuntime | null {
    for (const session of this.sessions.values()) {
      if (session.record.clientId === clientId && session.agentSessionId === agentSessionId) {
        return session;
      }
    }
    // The session may not be in memory yet (e.g. an update right after connect).
    for (const record of this.db.acpClients.listSessions(clientId)) {
      if (record.agentSessionId !== agentSessionId) continue;
      const created = this.createSessionRuntime(record);
      this.sessions.set(record.id, created);
      return created;
    }
    return null;
  }

  private reduceSessionMeta(session: SessionRuntime, update: AcpSessionUpdate): void {
    switch (update.sessionUpdate) {
      case "current_mode_update": {
        const currentModeId = str(update.currentModeId);
        if (currentModeId && session.meta.modes) {
          session.meta = {
            ...session.meta,
            modes: { ...session.meta.modes, currentModeId },
          };
        }
        return;
      }
      case "config_option_update":
        if (Array.isArray(update.configOptions)) {
          session.meta = { ...session.meta, configOptions: update.configOptions };
        }
        return;
      case "available_commands_update":
        if (Array.isArray(update.availableCommands)) {
          session.meta = { ...session.meta, commands: update.availableCommands };
        }
        return;
      case "usage_update":
        if (typeof update.used === "number" && typeof update.size === "number") {
          session.meta = {
            ...session.meta,
            usage: {
              used: update.used,
              size: update.size,
              ...(update.cost && typeof update.cost === "object" ? { cost: update.cost } : {}),
            },
          };
        }
        return;
      case "session_info_update": {
        const title = str(update.title) || str(update.titleUpdate) || str(update.title_update);
        if (title) {
          session.record = { ...session.record, title: title.slice(0, 200), updatedAt: Date.now() };
        }
        return;
      }
      default:
        return;
    }
  }

  private pushEvent(session: SessionRuntime, event: AcpStoredSessionEvent, emit: boolean): void {
    const entry: AcpStoredSessionEvent = {
      ...event,
      seq: session.events.length,
    };
    session.events.push(entry);
    if (session.events.length > MAX_EVENT_HISTORY) {
      session.events.splice(0, session.events.length - MAX_EVENT_HISTORY);
      session.events = session.events.map((item, index) => ({ ...item, seq: index }));
    }
    if (emit) this.send(session, entry.event, entry.data);
    this.schedulePersist(session);
  }

  private send(session: SessionRuntime, event: string, data: unknown): void {
    if (!session.emit) return;
    try {
      session.emit(event, data);
    } catch {
      // The client disconnected mid-write; prompt cancellation is handled by the route.
    }
  }

  private schedulePersist(session: SessionRuntime): void {
    if (session.flushTimer) return;
    session.flushTimer = setTimeout(() => {
      session.flushTimer = null;
      this.persistSession(session);
    }, PERSIST_FLUSH_MS);
    session.flushTimer.unref?.();
  }

  private persistSession(session: SessionRuntime): void {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
    try {
      const now = Date.now();
      const record: AcpSessionRow = {
        ...session.record,
        agentSessionId: session.agentSessionId,
        status: session.running ? "running" : session.status,
        meta: session.meta,
        updatedAt: now,
      };
      session.record = record;
      this.db.acpClients.saveSession(record);
      this.db.acpClients.replaceEvents(
        record.id,
        session.events.map((event) => ({ event: event.event, data: event.data, createdAt: event.createdAt })),
      );
    } catch {
      // Persistence must never break a live turn.
    }
  }

  private touchSession(session: SessionRuntime): void {
    session.record = { ...session.record, updatedAt: Date.now() };
    this.persistSession(session);
  }

  private disposeSessionRuntime(session: SessionRuntime): void {
    if (session.flushTimer) clearTimeout(session.flushTimer);
    if (session.cancelTimer) clearTimeout(session.cancelTimer);
    session.flushTimer = null;
    session.cancelTimer = null;
    this.resolvePendingForSession(session, "cancelled");
    session.emit = null;
  }

  private resolvePendingForSession(session: SessionRuntime, reason: "cancelled"): void {
    for (const [requestId, pending] of [...session.pending]) {
      session.pending.delete(requestId);
      this.pendingRequests.delete(this.pendingKey(session.record.id, requestId));
      if (pending.timer) clearTimeout(pending.timer);
      if (pending.kind === "permission") {
        pending.resolve({ outcome: reason });
        this.pushEvent(
          session,
          {
            seq: 0,
            event: "permission_resolved",
            data: { sessionId: session.record.id, requestId },
            createdAt: Date.now(),
          },
          true,
        );
      } else {
        pending.resolve({ action: "cancel" });
        this.pushEvent(
          session,
          {
            seq: 0,
            event: "elicitation_resolved",
            data: { sessionId: session.record.id, requestId },
            createdAt: Date.now(),
          },
          true,
        );
      }
    }
  }

  private pendingKey(sessionId: string, requestId: string): string {
    return `${sessionId}:${requestId}`;
  }

  private sessionError(error: unknown): AcpClientError {
    if (error instanceof AcpClientError) return error;
    const code = (error as { code?: unknown }).code;
    if (code === -32000) {
      return new AcpClientError(
        "Authentication required. Connect the agent and complete one of its advertised auth methods first.",
        401,
        "acp_auth_required",
      );
    }
    return new AcpClientError(
      error instanceof Error ? error.message : String(error),
      502,
      "acp_session_failed",
    );
  }
}