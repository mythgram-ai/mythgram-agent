/**
 * MCP servers — configuration shapes for Model Context Protocol integrations.
 *
 * Two kinds of servers are supported (mirroring how Claude Desktop / VS Code do it):
 *
 *   - "remote": a Streamable HTTP MCP endpoint, e.g.
 *     `https://example-server.modelcontextprotocol.io/mcp`. The backend speaks
 *     JSON-RPC over HTTP POST (Accept: application/json, text/event-stream),
 *     negotiates the protocol version, keeps the `Mcp-Session-Id` when the
 *     server issues one, and falls back to the legacy HTTP+SSE transport when
 *     the server only speaks that.
 *   - "local": a command the backend spawns over stdio (newline-delimited
 *     JSON-RPC), configured with the same JSON shape every MCP client uses:
 *     `{ "command": "npx", "args": [...], "env": {...} }`.
 *
 * Once a server is connected, every tool it exposes becomes a NATIVE function
 * tool for ALL agent surfaces (main, custom, sub-agents, teams, CEO) — the same
 * treatment connected Composio apps get. There is intentionally no allowlist and
 * no cap: the full `tools/list` catalog is advertised. Per-tool control lives in
 * `disabledTools` so the user can switch individual tools off from the MCP page.
 *
 * This file owns the persistent CONFIGURATION shape + defensive normalization.
 * Secrets (OAuth tokens) live server-side in the
 * SQLite `app_state` document keyed `mcpServers` — the browser never needs them
 * to run a turn; it only sends server-id selections.
 */

/** Where the MCP server runs. */
export type McpServerKind = "remote" | "local";

/**
 * How the backend authenticates to a remote MCP server.
 * Only two methods remain: public servers (`none`) and OAuth-protected servers (`oauth`).
 */
export type McpAuthType = "none" | "oauth";

/** Lifecycle status of one MCP server connection. */
export type McpServerStatus = "connected" | "disconnected" | "connecting" | "error" | "auth_required";

/** Local (stdio) server launch parameters — the standard MCP JSON shape. */
export interface McpLocalConfig {
  /** Executable, e.g. "npx", "node", "python3", "/usr/bin/docker". */
  command: string;
  /** Arguments, e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]. */
  args: string[];
  /** Extra environment variables for the child process (merged over process.env). */
  env: Record<string, string>;
  /** Working directory for the child (defaults to the agent workspace). */
  cwd?: string;
}

/** OAuth state for a remote MCP server (RFC9728 discovery + OAuth 2.1 w/ PKCE). */
export interface McpOAuthConfig {
  /**
   * Authorization server issuer discovered from the protected-resource
   * metadata (or entered manually). Empty until discovery runs.
   */
  authorizationServer?: string;
  /** Scopes requested (advertised `scopes_supported` when discovered). */
  scopes: string[];
  /** Pre-registered OAuth client id (when the AS has no dynamic registration). */
  clientId?: string;
  /** Pre-registered OAuth client secret (confidential clients only). */
  clientSecret?: string;
  /** Manual authorization endpoint override (skips AS metadata discovery). */
  authorizationEndpoint?: string;
  /** Manual token endpoint override (skips AS metadata discovery). */
  tokenEndpoint?: string;
  /** Manual registration endpoint override (skips AS metadata discovery). */
  registrationEndpoint?: string;
  /** Access token from the last completed OAuth flow (never sent to the browser). */
  accessToken?: string;
  /** Refresh token for silent renewal (never sent to the browser). */
  refreshToken?: string;
  /** Epoch ms when the access token expires (0/undefined = unknown). */
  expiresAt?: number;
  /** Token type as issued (almost always "Bearer"). */
  tokenType?: string;
}

/**
 * One MCP server, persisted in the SQLite `app_state` document keyed
 * `mcpServers` (the same document the frontend syncs to).
 */
export interface McpServerConfig {
  /** Stable unique id (16-character alphanumeric). */
  id: string;
  /** Human-readable server name (required). */
  name: string;
  /** Short description of what the server provides. */
  description: string;
  kind: McpServerKind;
  /** Remote MCP endpoint URL (remote only). */
  url: string;
  /** Local launch parameters (local only). */
  local?: McpLocalConfig;
  /** Auth strategy for remote servers (`none` or `oauth`). */
  authType: McpAuthType;
  /** OAuth configuration + tokens (authType oauth). */
  oauth?: McpOAuthConfig;
  /**
   * Where the browser lands after a remote OAuth flow finishes. Defaults to
   * the auto-detected frontend origin when empty.
   */
  frontendUrl?: string;
  /** Master switch: a disabled server contributes no tools and is never dialed. */
  enabled: boolean;
  /** Tool names (as the MCP server reports them) switched OFF by the user. */
  disabledTools: string[];
  /** Last known connection status (refreshed by test/connect flows). */
  status: McpServerStatus;
  /** Last connection/test error, when status is error/auth_required. */
  lastError?: string;
  /** Cached tool catalog from the last successful tools/list (name+description). */
  cachedTools: Array<{ name: string; description: string }>;
  createdAt: number;
  updatedAt: number;
}

/** Untrusted over-the-wire / stored shape of a server. Accepts both spellings. */
export interface McpServerWire {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  kind?: unknown;
  type?: unknown;
  url?: unknown;
  server_url?: unknown;
  serverUrl?: unknown;
  local?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  auth_type?: unknown;
  authType?: unknown;
  authentication?: unknown;
  oauth?: unknown;
  frontend_url?: unknown;
  frontendUrl?: unknown;
  redirect_url?: unknown;
  redirectUrl?: unknown;
  enabled?: unknown;
  disabled_tools?: unknown;
  disabledTools?: unknown;
  enabled_tools?: unknown;
  enabledTools?: unknown;
  status?: unknown;
  last_error?: unknown;
  lastError?: unknown;
  cached_tools?: unknown;
  cachedTools?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
  /** Local-server JSON pasted by the user (object or JSON string). */
  json?: unknown;
  mcp_json?: unknown;
}

/** Per-turn selection of MCP servers, sent by the frontend (ids only — secrets
 * stay server-side). Undefined = every enabled server. */
export interface McpServerSelection {
  id: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "yes" || value === "on" || value === 1) return true;
  if (value === false || value === "no" || value === "off" || value === 0) return false;
  return fallback;
}

function kindOf(value: unknown): McpServerKind {
  const s = str(value).trim().toLowerCase();
  if (s === "local" || s === "stdio") return "local";
  return "remote";
}

function authTypeOf(value: unknown): McpAuthType {
  const s = str(value).trim().toLowerCase().replace(/[-_\s]+/g, "");
  if (s === "oauth" || s === "oauth2" || s === "oauth21") return "oauth";
  // Legacy auth methods (apiKey, bearer, customHeaders) were removed —
  // old stored configs carrying them fall back to public (`none`).
  return "none";
}

function statusOf(value: unknown): McpServerStatus {
  const s = str(value).trim().toLowerCase();
  if (s === "connected" || s === "active") return "connected";
  if (s === "connecting" || s === "pending") return "connecting";
  if (s === "auth_required" || s === "authrequired") return "auth_required";
  if (s === "error" || s === "failed") return "error";
  return "disconnected";
}

/** Normalize a string array (tool names, scopes, args). */
function strArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function normalizeLocal(raw: unknown): McpLocalConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const command = str(r.command).trim();
  if (!command) return undefined;
  const args = Array.isArray(r.args)
    ? r.args.filter((a): a is string => typeof a === "string")
    : [];
  const env: Record<string, string> = {};
  if (r.env && typeof r.env === "object" && !Array.isArray(r.env)) {
    for (const [k, v] of Object.entries(r.env as Record<string, unknown>)) {
      if (typeof v === "string") env[k] = v;
    }
  }
  const cwd = str(r.cwd ?? r.workdir ?? r.working_directory).trim();
  return { command, args, env, ...(cwd ? { cwd } : {}) };
}

/**
 * Parse a user-pasted local-server JSON blob into launch parameters. Accepts:
 *   - `{ "command": "npx", "args": [...], "env": {...} }`
 *   - Claude-style `{ "mcpServers": { "<name>": { "command": ... } } }`
 *     (the first entry is used)
 *   - a JSON string of either shape.
 * Returns null with an explanatory message when unusable.
 */
export function parseLocalServerJson(raw: unknown): { local?: McpLocalConfig; error?: string } {
  let value = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { error: "The MCP JSON is empty. Paste the server's JSON configuration." };
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch (error) {
      return {
        error: `That is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "The MCP JSON must be an object with a \"command\" field." };
  }
  const r = value as Record<string, unknown>;
  const servers = r.mcpServers;
  if (servers && typeof servers === "object" && !Array.isArray(servers)) {
    const entries = Object.values(servers as Record<string, unknown>);
    if (entries.length === 0) {
      return { error: "The \"mcpServers\" object is empty — add at least one server entry." };
    }
    const local = normalizeLocal(entries[0]);
    if (!local) return { error: "The first \"mcpServers\" entry has no usable \"command\"." };
    return { local };
  }
  const local = normalizeLocal(value);
  if (!local) {
    return {
      error: "The JSON needs a \"command\" (e.g. { \"command\": \"npx\", \"args\": [\"-y\", \"<server-package>\"] }).",
    };
  }
  return { local };
}

function normalizeOAuth(raw: unknown): McpOAuthConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const scopes = strArray(r.scopes ?? r.scope);
  return {
    authorizationServer: str(r.authorizationServer ?? r.authorization_server ?? r.issuer).trim() || undefined,
    scopes,
    clientId: str(r.clientId ?? r.client_id).trim() || undefined,
    clientSecret: str(r.clientSecret ?? r.client_secret).trim() || undefined,
    authorizationEndpoint:
      str(r.authorizationEndpoint ?? r.authorization_endpoint).trim() || undefined,
    tokenEndpoint: str(r.tokenEndpoint ?? r.token_endpoint).trim() || undefined,
    registrationEndpoint:
      str(r.registrationEndpoint ?? r.registration_endpoint).trim() || undefined,
    accessToken: str(r.accessToken ?? r.access_token).trim() || undefined,
    refreshToken: str(r.refreshToken ?? r.refresh_token).trim() || undefined,
    expiresAt: num(r.expiresAt ?? r.expires_at, 0) || undefined,
    tokenType: str(r.tokenType ?? r.token_type).trim() || undefined,
  };
}

function normalizeCachedTools(raw: unknown): Array<{ name: string; description: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; description: string }> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, description: str(r.description) });
  }
  return out;
}

/**
 * Defensively normalize an untrusted MCP server payload (wire or stored) into a
 * well-formed McpServerConfig, or `null` when unusable (no name, or a remote
 * server without a URL, or a local server without launch params).
 */
export function normalizeMcpServerConfig(
  raw: unknown,
  defaults: { id: string; now: number },
): McpServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as McpServerWire;

  const name = str(r.name).trim().slice(0, 70);
  if (!name) return null;

  const kind = kindOf(r.kind ?? r.type);
  const authType = authTypeOf(r.auth_type ?? r.authType ?? r.authentication);

  let url = str(r.url ?? r.server_url ?? r.serverUrl).trim();
  if (url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    // Tolerate a bare host/path by assuming https (local http stays explicit).
    url = `https://${url}`;
  }

  // A pasted local-server JSON blob overrides the structured local fields.
  let local = normalizeLocal(r.local);
  const pasted = r.json ?? r.mcp_json;
  if (pasted !== undefined && (typeof pasted === "string" ? pasted.trim().length > 0 : true)) {
    const parsed = parseLocalServerJson(pasted);
    if (parsed.local) local = parsed.local;
  }
  // Flat command/args/env spellings are also accepted for local servers.
  if (!local && (r.command !== undefined || r.args !== undefined || r.env !== undefined)) {
    local = normalizeLocal({ command: r.command, args: r.args, env: r.env });
  }

  if (kind === "remote") {
    if (!url) return null;
  } else if (!local) {
    return null;
  }

  // enabledTools (allow-list spelling) is converted to disabledTools by diffing
  // against the cached catalog when available; otherwise it is ignored.
  const cachedTools = normalizeCachedTools(r.cached_tools ?? r.cachedTools);
  const cachedNames = new Set(cachedTools.map((t) => t.name));
  let disabledTools = strArray(r.disabled_tools ?? r.disabledTools);
  const enabledTools = strArray(r.enabled_tools ?? r.enabledTools);
  if (enabledTools.length > 0 && cachedNames.size > 0) {
    const keep = new Set(enabledTools);
    disabledTools = [...cachedNames].filter((n) => !keep.has(n));
  }

  const oauth = authType === "oauth" ? normalizeOAuth(r.oauth) : undefined;

  return {
    id: str(r.id).trim() || defaults.id,
    name,
    description: str(r.description).trim().slice(0, 300),
    kind,
    url: kind === "remote" ? url : "",
    ...(local ? { local } : {}),
    // Local servers never use auth; remote servers use `none` or `oauth` only.
    authType: kind === "local" ? "none" : authType,
    ...(oauth ? { oauth } : {}),
    frontendUrl:
      str(r.frontend_url ?? r.frontendUrl ?? r.redirect_url ?? r.redirectUrl).trim() || undefined,
    enabled: bool(r.enabled, true),
    disabledTools,
    status: statusOf(r.status),
    lastError: str(r.last_error ?? r.lastError).trim() || undefined,
    cachedTools,
    createdAt: num(r.created_at ?? r.createdAt, defaults.now),
    updatedAt: num(r.updated_at ?? r.updatedAt, defaults.now),
  };
}

/** Defensively coerce a client-provided per-turn server selection. */
export function normalizeMcpSelection(raw: unknown): McpServerSelection | null {
  if (typeof raw === "string") {
    const id = raw.trim();
    return id ? { id } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id ?? r.serverId ?? r.server_id).trim();
  return id ? { id } : null;
}

/**
 * The wire shape of an MCP server safe to send to the browser: everything
 * EXCEPT secrets (OAuth tokens/client secrets). Values are replaced with
 * presence flags so the UI can show "configured" without ever seeing the secret.
 */
export interface McpServerPublic {
  id: string;
  name: string;
  description: string;
  kind: McpServerKind;
  url: string;
  local?: { command: string; args: string[]; envKeys: string[]; cwd?: string };
  authType: McpAuthType;
  /** Which secret slots are filled (never the values). */
  secrets: { clientSecret: boolean; accessToken: boolean };
  oauth?: {
    authorizationServer?: string;
    scopes: string[];
    hasClientId: boolean;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    registrationEndpoint?: string;
    connected: boolean;
    expiresAt?: number;
  };
  frontendUrl?: string;
  enabled: boolean;
  disabledTools: string[];
  status: McpServerStatus;
  lastError?: string;
  cachedTools: Array<{ name: string; description: string }>;
  createdAt: number;
  updatedAt: number;
}

/** Strip secrets from a stored config before sending it to the browser. */
export function toPublicServer(config: McpServerConfig): McpServerPublic {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    kind: config.kind,
    url: config.url,
    ...(config.local
      ? {
          local: {
            command: config.local.command,
            args: config.local.args,
            envKeys: Object.keys(config.local.env),
            ...(config.local.cwd ? { cwd: config.local.cwd } : {}),
          },
        }
      : {}),
    authType: config.authType,
    secrets: {
      clientSecret: Boolean(config.oauth?.clientSecret),
      accessToken: Boolean(config.oauth?.accessToken),
    },
    ...(config.oauth
      ? {
          oauth: {
            ...(config.oauth.authorizationServer
              ? { authorizationServer: config.oauth.authorizationServer }
              : {}),
            scopes: config.oauth.scopes,
            hasClientId: Boolean(config.oauth.clientId),
            ...(config.oauth.authorizationEndpoint
              ? { authorizationEndpoint: config.oauth.authorizationEndpoint }
              : {}),
            ...(config.oauth.tokenEndpoint ? { tokenEndpoint: config.oauth.tokenEndpoint } : {}),
            ...(config.oauth.registrationEndpoint
              ? { registrationEndpoint: config.oauth.registrationEndpoint }
              : {}),
            connected: Boolean(config.oauth.accessToken),
            ...(config.oauth.expiresAt ? { expiresAt: config.oauth.expiresAt } : {}),
          },
        }
      : {}),
    ...(config.frontendUrl ? { frontendUrl: config.frontendUrl } : {}),
    enabled: config.enabled,
    disabledTools: config.disabledTools,
    status: config.status,
    ...(config.lastError ? { lastError: config.lastError } : {}),
    cachedTools: config.cachedTools,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}
