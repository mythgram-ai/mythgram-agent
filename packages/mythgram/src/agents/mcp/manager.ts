import type { AppConfig } from "../../config.js";
import { createCustomAgentId } from "../../database/ids.js";
import type { AppStateRepo } from "../../database/repositories/appStateRepo.js";
import {
  normalizeMcpServerConfig,
  toPublicServer,
  type McpServerConfig,
  type McpServerPublic,
} from "./configuration.js";
import { McpClient } from "./client.js";
import { canonicalResourceUri, refreshAccessToken } from "./oauth.js";

/**
 * McpManager — the persistent store for MCP server configurations plus the
 * live connection pool.
 *
 * It reuses the application's existing persistence architecture: configs live
 * in the SQLite-backed `app_state` document keyed `mcpServers` (the very same
 * document the frontend syncs to). No new persistence system is introduced.
 * A config stores everything the backend needs to dial the server — including
 * secrets, which NEVER leave the backend (the API serves `toPublicServer`).
 *
 * Connections are pooled per server id: one connected `McpClient` is reused
 * across turns and operations, re-established transparently when it drops.
 * Local (stdio) servers additionally stay warm between calls — the child
 * process is only spawned on first use and reaped on delete/shutdown.
 */

/** Fields accepted when creating an MCP server (id/timestamps assigned here). */
export type CreateMcpServerInput = Record<string, unknown>;

/** Fields accepted when updating an MCP server (all optional). */
export type UpdateMcpServerInput = Record<string, unknown>;

interface PooledConnection {
  client: McpClient;
  /** Epoch ms of the last successful operation through this client. */
  lastOk: number;
  /** In-flight (re)connect shared by concurrent callers. */
  connecting: Promise<void> | null;
}

const CONNECT_TIMEOUT_MS = 30_000;

/** Idle time after which a pooled connection is closed (local servers die too). */
const POOL_IDLE_MS = 10 * 60_000;

export class McpManager {
  private readonly pool = new Map<string, PooledConnection>();
  private readonly oauthPending = new Map<
    string,
    {
      serverId: string;
      verifier: string;
      resource: string;
      clientId: string;
      clientSecret?: string;
      tokenEndpoint: string;
      /** The exact redirect_uri sent (reused for the code exchange). */
      redirectUri: string;
      createdAt: number;
    }
  >();
  private janitor: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly appState: AppStateRepo,
    private readonly config: AppConfig,
  ) {}

  /** All stored MCP servers, normalized and newest-first. */
  list(): McpServerConfig[] {
    const raw = this.appState.get("mcpServers");
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    const out: McpServerConfig[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const server = normalizeMcpServerConfig(item, { id: createCustomAgentId(), now });
      if (!server || seen.has(server.id)) continue;
      seen.add(server.id);
      out.push(server);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** One server by id, or null. */
  get(id: string): McpServerConfig | null {
    if (!id) return null;
    return this.list().find((s) => s.id === id) ?? null;
  }

  /** Every ENABLED server (the set a turn may use when the wire selects nothing). */
  listEnabled(): McpServerConfig[] {
    return this.list().filter((s) => s.enabled);
  }

  /** Browser-safe view of every server (secrets stripped). */
  listPublic(): McpServerPublic[] {
    return this.list().map(toPublicServer);
  }

  /** Browser-safe view of one server, or null. */
  getPublic(id: string): McpServerPublic | null {
    const server = this.get(id);
    return server ? toPublicServer(server) : null;
  }

  /**
   * Create and persist a new MCP server. Throws when the payload is unusable.
   * Secrets in the payload are stored as-is (server-side only, never served).
   */
  create(input: CreateMcpServerInput): McpServerConfig {
    const now = Date.now();
    const server = normalizeMcpServerConfig(input, { id: createCustomAgentId(), now });
    if (!server) {
      throw new Error(
        "An MCP server needs a name plus a server URL (remote) or a launch command (local JSON).",
      );
    }
    // A fresh server starts disconnected; an explicit test/connect flips it.
    server.status = "disconnected";
    server.lastError = undefined;
    server.createdAt = now;
    server.updatedAt = now;
    this.persist([server, ...this.list()]);
    return server;
  }

  /** Update an existing server. Returns the updated config, or null. */
  update(id: string, patch: UpdateMcpServerInput): McpServerConfig | null {
    const all = this.list();
    const index = all.findIndex((s) => s.id === id);
    if (index === -1) return null;
    const existing = all[index]!;
    const merged: Record<string, unknown> = {
      ...(existing as unknown as Record<string, unknown>),
      ...(patch as Record<string, unknown>),
      id: existing.id,
      createdAt: existing.createdAt,
    };
    // OAuth secrets are write-only from the browser's perspective: an absent/empty
    // secret in the patch keeps the stored one (the public view never sends
    // values back, only presence flags).
    const patchOAuth = (patch as Record<string, unknown>).oauth;
    if (patchOAuth && typeof patchOAuth === "object") {
      const o = { ...(existing.oauth ?? {}), ...(patchOAuth as Record<string, unknown>) };
      if (!((patchOAuth as Record<string, unknown>).clientSecret as string)) o.clientSecret = existing.oauth?.clientSecret;
      if (!((patchOAuth as Record<string, unknown>).accessToken as string)) o.accessToken = existing.oauth?.accessToken;
      if (!((patchOAuth as Record<string, unknown>).refreshToken as string)) o.refreshToken = existing.oauth?.refreshToken;
      merged.oauth = o;
    }
    const normalized = normalizeMcpServerConfig(merged, { id: existing.id, now: Date.now() });
    if (!normalized) return null;
    // Config changed → drop the pooled connection so the next use redials.
    // Preserve runtime status fields unless the patch sets them explicitly.
    const patchRecord = patch as Record<string, unknown>;
    if (patchRecord.status === undefined) {
      normalized.status = existing.status;
      normalized.lastError = existing.lastError;
      normalized.cachedTools = existing.cachedTools;
    }
    if (patchRecord.cachedTools === undefined) normalized.cachedTools = existing.cachedTools;
    normalized.updatedAt = Date.now();
    const next = all.slice();
    next[index] = normalized;
    this.persist(next);
    void this.dropConnection(id);
    return normalized;
  }

  /** Patch just the runtime status fields of a server (test/connect flows). */
  markStatus(
    id: string,
    status: McpServerConfig["status"],
    extra?: { lastError?: string; cachedTools?: Array<{ name: string; description: string }> },
  ): McpServerConfig | null {
    const all = this.list();
    const index = all.findIndex((s) => s.id === id);
    if (index === -1) return null;
    const updated: McpServerConfig = {
      ...all[index]!,
      status,
      lastError: extra?.lastError,
      cachedTools: extra?.cachedTools ?? all[index]!.cachedTools,
      updatedAt: Date.now(),
    };
    const next = all.slice();
    next[index] = updated;
    this.persist(next);
    return updated;
  }

  /** Store fresh OAuth tokens after a callback/refresh (never served). */
  storeTokens(
    id: string,
    tokens: { accessToken: string; refreshToken?: string; expiresAt: number; tokenType: string },
  ): McpServerConfig | null {
    const all = this.list();
    const index = all.findIndex((s) => s.id === id);
    if (index === -1) return null;
    const existing = all[index]!;
    const updated: McpServerConfig = {
      ...existing,
      oauth: {
        ...(existing.oauth ?? { scopes: [] }),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? existing.oauth?.refreshToken,
        expiresAt: tokens.expiresAt,
        tokenType: tokens.tokenType,
      },
      status: "connected",
      lastError: undefined,
      updatedAt: Date.now(),
    };
    const next = all.slice();
    next[index] = updated;
    this.persist(next);
    void this.dropConnection(id);
    return updated;
  }

  /** Forget OAuth tokens (disconnect the authorization, keep the server). */
  clearTokens(id: string): McpServerConfig | null {
    const all = this.list();
    const index = all.findIndex((s) => s.id === id);
    if (index === -1) return null;
    const existing = all[index]!;
    const oauth = existing.oauth ? { ...existing.oauth } : undefined;
    if (oauth) {
      delete oauth.accessToken;
      delete oauth.refreshToken;
      delete oauth.expiresAt;
    }
    const updated: McpServerConfig = {
      ...existing,
      ...(oauth ? { oauth } : {}),
      status: "disconnected",
      lastError: undefined,
      updatedAt: Date.now(),
    };
    const next = all.slice();
    next[index] = updated;
    this.persist(next);
    void this.dropConnection(id);
    return updated;
  }

  /**
   * Test a not-yet-saved server payload: validates the shape (including pasted
   * local JSON), connects, and lists its tools. Never persists anything and
   * never touches the connection pool — a throwaway client is always closed,
   * so a local child process is reaped. Throws `invalid_server` for an
   * unusable payload, `oauth_required` for OAuth servers (save first, then
   * Connect), or the connection error itself.
   */
  async validateDraft(
    input: Record<string, unknown>,
  ): Promise<Array<{ name: string; description: string }>> {
    const draft = normalizeMcpServerConfig(input, { id: `draft_${createCustomAgentId()}`, now: Date.now() });
    if (!draft) {
      throw codedError(
        "invalid_server",
        "An MCP server needs a name plus a server URL (remote) or a launch command (local JSON).",
      );
    }
    if (draft.authType === "oauth") {
      throw codedError(
        "oauth_required",
        "OAuth servers cannot be tested before saving: save the server first, then press Connect to authorize.",
      );
    }
    const client = McpClient.forServer(draft, {
      workspaceRoot: this.config.workspaceRoot,
      headers: this.staticHeaders(draft),
      timeoutMs: CONNECT_TIMEOUT_MS,
    });
    try {
      await client.connect();
      const tools = await client.listTools();
      return tools.map((t) => ({ name: t.name, description: t.description }));
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  /**
   * Delete a server by id. Drops its pooled connection (killing a local
   * child process) and forgets pending OAuth flows. Returns true when removed.
   */
  delete(id: string): boolean {
    const all = this.list();
    const next = all.filter((s) => s.id !== id);
    if (next.length === all.length) return false;
    this.persist(next);
    void this.dropConnection(id);
    for (const [state, pending] of this.oauthPending) {
      if (pending.serverId === id) this.oauthPending.delete(state);
    }
    return true;
  }

  // ---- Live connections ---------------------------------------------------

  /**
   * Get a connected client for a server, establishing it on first use.
   * Concurrent callers share one handshake. Throws with a human message when
   * the server cannot be reached, needs auth, or speaks no MCP.
   */
  async connection(serverId: string, signal?: AbortSignal): Promise<McpClient> {
    const server = this.get(serverId);
    if (!server) throw new Error("Unknown MCP server.");
    if (!server.enabled) throw new Error(`The MCP server "${server.name}" is disabled.`);
    this.startJanitor();

    let pooled = this.pool.get(serverId);
    if (!pooled) {
      pooled = {
        client: McpClient.forServer(server, {
          workspaceRoot: this.config.workspaceRoot,
          headers: this.staticHeaders(server),
          headerProvider: () => this.authHeaders(serverId),
          signal,
          timeoutMs: CONNECT_TIMEOUT_MS,
        }),
        lastOk: 0,
        connecting: null,
      };
      this.pool.set(serverId, pooled);
    }
    const entry = pooled;
    if (!entry.client.isConnected) {
      if (!entry.connecting) {
        entry.connecting = entry.client
          .connect()
          .then(() => {
            entry.lastOk = Date.now();
          })
          .catch((error) => {
            // A failed handshake must not poison the pool entry's client.
            void entry.client.close().catch(() => undefined);
            this.pool.delete(serverId);
            throw error;
          })
          .finally(() => {
            entry.connecting = null;
          });
      }
      await entry.connecting;
    }
    entry.lastOk = Date.now();
    return entry.client;
  }

  /** Touch a pooled connection after a successful operation (idle reaping). */
  touch(serverId: string): void {
    const pooled = this.pool.get(serverId);
    if (pooled) pooled.lastOk = Date.now();
  }

  /** Drop (and close) a pooled connection, e.g. after config change/delete. */
  async dropConnection(serverId: string): Promise<void> {
    const pooled = this.pool.get(serverId);
    if (!pooled) return;
    this.pool.delete(serverId);
    try {
      await pooled.connecting;
    } catch {
      // the handshake failed — still close below
    }
    await pooled.client.close().catch(() => undefined);
  }

  /** Close every pooled connection (shutdown path). */
  async closeAll(): Promise<void> {
    const ids = [...this.pool.keys()];
    await Promise.all(ids.map((id) => this.dropConnection(id)));
    if (this.janitor) {
      clearInterval(this.janitor);
      this.janitor = null;
    }
  }

  private startJanitor(): void {
    if (this.janitor) return;
    this.janitor = setInterval(() => {
      const now = Date.now();
      for (const [id, pooled] of this.pool) {
        if (!pooled.connecting && now - pooled.lastOk > POOL_IDLE_MS) {
          void this.dropConnection(id);
        }
      }
    }, 60_000);
    this.janitor.unref?.();
  }

  // ---- Auth headers ---------------------------------------------------------

  /**
   * Static headers for a server. Only `none` and `oauth` auth remain, neither
   * of which uses static headers — OAuth tokens are injected per-request via
   * `authHeaders()`. Kept as a single place to add future static headers.
   */
  private staticHeaders(_server: McpServerConfig): Record<string, string> {
    return {};
  }

  /**
   * Fresh auth headers for one request: OAuth bearer (refreshing an expired
   * token first). Throws `OAUTH_REQUIRED` when
   * an oauth server has no usable token so the caller can mark auth_required.
   */
  async authHeaders(serverId: string): Promise<Record<string, string>> {
    const server = this.get(serverId);
    if (!server) return {};
    if (server.authType !== "oauth" || !server.oauth) return {};

    const oauth = server.oauth;
    const expired =
      typeof oauth.expiresAt === "number" && oauth.expiresAt > 0 && oauth.expiresAt - 30_000 < Date.now();
    if (oauth.accessToken && !expired) {
      return { Authorization: `Bearer ${oauth.accessToken}` };
    }
    if (oauth.refreshToken && oauth.tokenEndpoint && oauth.clientId) {
      try {
        const tokens = await refreshAccessToken({
          tokenEndpoint: oauth.tokenEndpoint,
          refreshToken: oauth.refreshToken,
          clientId: oauth.clientId,
          clientSecret: oauth.clientSecret,
          resource: canonicalResourceUri(server.url),
          scopes: oauth.scopes,
        });
        this.storeTokens(serverId, tokens);
        return { Authorization: `Bearer ${tokens.accessToken}` };
      } catch {
        // fall through to OAUTH_REQUIRED below
      }
    }
    const error = new Error(
      `The MCP server "${server.name}" needs OAuth authorization. Connect it on the MCP page first.`,
    );
    (error as { code?: string }).code = "OAUTH_REQUIRED";
    throw error;
  }

  // ---- OAuth pending flows ----------------------------------------------------

  /** Remember an in-flight browser OAuth flow until the code is exchanged. */
  savePendingFlow(flow: {
    state: string;
    serverId: string;
    verifier: string;
    resource: string;
    clientId: string;
    clientSecret?: string;
    tokenEndpoint: string;
    redirectUri: string;
  }): void {
    this.oauthPending.set(flow.state, { ...flow, createdAt: Date.now() });
    // Expire stale flows so the map cannot grow without bound.
    const now = Date.now();
    for (const [state, pending] of this.oauthPending) {
      if (now - pending.createdAt > 15 * 60_000) this.oauthPending.delete(state);
    }
  }

  /** Consume (and remove) a pending flow when the code arrives for exchange. */
  takePendingFlow(state: string): {
    serverId: string;
    verifier: string;
    resource: string;
    clientId: string;
    clientSecret?: string;
    tokenEndpoint: string;
    redirectUri: string;
  } | null {
    const pending = this.oauthPending.get(state);
    if (!pending) return null;
    this.oauthPending.delete(state);
    if (Date.now() - pending.createdAt > 15 * 60_000) return null;
    return pending;
  }

  private persist(servers: McpServerConfig[]): void {
    this.appState.set("mcpServers", servers);
  }
}

/** Error carrying a machine-readable code for the API layer to map to HTTP status. */
function codedError(code: string, message: string): Error {
  const error = new Error(message);
  (error as { code?: string }).code = code;
  return error;
}
