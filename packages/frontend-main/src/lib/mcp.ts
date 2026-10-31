import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";
import type {
  McpAuthType,
  McpServer,
  McpServerStatus,
} from "@/types";

/**
 * MCP client — Model Context Protocol servers (remote Streamable HTTP + local
 * stdio) with OAuth 2.1 authorization for protected servers.
 *
 * Secrets (OAuth tokens) are write-only: the backend stores
 * them in SQLite and serves presence flags, so this client sends values on
 * create/update but never receives them back.
 */

/** Static metadata for the auth-type picker (mirrors the backend catalog). */
export interface McpAuthMeta {
  id: McpAuthType;
  name: string;
  description: string;
}

export const MCP_AUTH_TYPES: readonly McpAuthMeta[] = [
  { id: "none", name: "No authentication", description: "Public server — no credentials sent." },
  { id: "oauth", name: "OAuth", description: "Browser authorization flow — no API key needed." },
];

function statusOf(value: unknown): McpServerStatus {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === "connected" || s === "active") return "connected";
  if (s === "connecting" || s === "pending") return "connecting";
  if (s === "auth_required" || s === "authrequired") return "auth_required";
  if (s === "error" || s === "failed") return "error";
  return "disconnected";
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Defensive normalize of one stored/loaded server into a well-formed value. */
export function normalizeMcpServer(raw: unknown): McpServer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const name = str(r.name).trim();
  if (!id || !name) return null;
  const kind = str(r.kind).trim().toLowerCase() === "local" ? "local" : "remote";
  const authRaw = str(r.authType ?? r.auth_type).trim().toLowerCase().replace(/[-_\s]+/g, "");
  // Only `oauth` is a gated auth method — legacy apiKey/bearer/customHeaders
  // configs fall back to public (`none`).
  const authType: McpAuthType = authRaw === "oauth" ? "oauth" : "none";
  const oauthRaw = (r.oauth ?? null) as Record<string, unknown> | null;
  const cachedRaw = Array.isArray(r.cachedTools ?? r.cached_tools)
    ? ((r.cachedTools ?? r.cached_tools) as unknown[])
    : [];
  const cachedTools: Array<{ name: string; description: string }> = [];
  for (const t of cachedRaw) {
    if (!t || typeof t !== "object") continue;
    const rec = t as Record<string, unknown>;
    const toolName = str(rec.name).trim();
    if (!toolName) continue;
    cachedTools.push({ name: toolName, description: str(rec.description) });
  }
  const localRaw = (r.local ?? null) as Record<string, unknown> | null;
  return {
    id,
    name,
    description: str(r.description),
    kind,
    url: str(r.url),
    ...(localRaw
      ? {
          local: {
            command: str(localRaw.command),
            args: Array.isArray(localRaw.args)
              ? localRaw.args.filter((a): a is string => typeof a === "string")
              : [],
            envKeys: Array.isArray(localRaw.envKeys)
              ? localRaw.envKeys.filter((a): a is string => typeof a === "string")
              : Array.isArray(localRaw.env)
                ? localRaw.env.filter((a): a is string => typeof a === "string")
                : [],
            ...(str(localRaw.cwd) ? { cwd: str(localRaw.cwd) } : {}),
          },
        }
      : {}),
    authType: kind === "local" ? "none" : authType,
    ...(oauthRaw
      ? {
          oauth: {
            ...(str(oauthRaw.authorizationServer ?? oauthRaw.authorization_server)
              ? { authorizationServer: str(oauthRaw.authorizationServer ?? oauthRaw.authorization_server) }
              : {}),
            scopes: Array.isArray(oauthRaw.scopes)
              ? oauthRaw.scopes.filter((s): s is string => typeof s === "string")
              : [],
            hasClientId: oauthRaw.hasClientId === true,
            ...(str(oauthRaw.authorizationEndpoint ?? oauthRaw.authorization_endpoint)
              ? { authorizationEndpoint: str(oauthRaw.authorizationEndpoint ?? oauthRaw.authorization_endpoint) }
              : {}),
            ...(str(oauthRaw.tokenEndpoint ?? oauthRaw.token_endpoint)
              ? { tokenEndpoint: str(oauthRaw.tokenEndpoint ?? oauthRaw.token_endpoint) }
              : {}),
            ...(str(oauthRaw.registrationEndpoint ?? oauthRaw.registration_endpoint)
              ? {
                  registrationEndpoint: str(oauthRaw.registrationEndpoint ?? oauthRaw.registration_endpoint),
                }
              : {}),
            connected: oauthRaw.connected === true,
            ...(typeof oauthRaw.expiresAt === "number" ? { expiresAt: oauthRaw.expiresAt } : {}),
          },
        }
      : {}),
    ...(str(r.frontendUrl ?? r.frontend_url) ? { frontendUrl: str(r.frontendUrl ?? r.frontend_url) } : {}),
    enabled: r.enabled !== false,
    disabledTools: Array.isArray(r.disabledTools ?? r.disabled_tools)
      ? ((r.disabledTools ?? r.disabled_tools) as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
    status: statusOf(r.status),
    ...(str(r.lastError ?? r.last_error) ? { lastError: str(r.lastError ?? r.last_error) } : {}),
    cachedTools,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

/** Normalize a persisted array of servers (drops malformed/duplicate entries). */
export function normalizeMcpServers(raw: unknown): McpServer[] {
  if (!Array.isArray(raw)) return [];
  const out: McpServer[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const server = normalizeMcpServer(item);
    if (!server || seen.has(server.id)) continue;
    seen.add(server.id);
    out.push(server);
  }
  return out;
}

/** Every ENABLED server (the set a turn uses). */
export function enabledMcpServers(servers: McpServer[]): McpServer[] {
  return servers.filter((s) => s.enabled);
}

export interface McpListResponse {
  servers: McpServer[];
}

export async function fetchMcpServers(signal?: AbortSignal): Promise<McpServer[]> {
  const data = await requestJson<{ servers?: unknown[] }>(
    routeUrl(API_ROUTES.mcpList),
    undefined,
    signal,
  );
  return normalizeMcpServers(data.servers ?? []);
}

/** Payload for creating/updating a server (secrets included on write). */
export interface McpServerInput {
  name: string;
  description?: string;
  kind: "remote" | "local";
  url?: string;
  /** Pasted local-server JSON (object or string) for local servers. */
  json?: unknown;
  authType?: McpAuthType;
  oauth?: {
    authorizationServer?: string;
    scopes?: string[];
    clientId?: string;
    clientSecret?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    registrationEndpoint?: string;
  };
  frontendUrl?: string;
  enabled?: boolean;
  disabledTools?: string[];
}

export async function createMcpServer(input: McpServerInput): Promise<McpServer> {
  const data = await requestJson<{ server?: unknown }>(routeUrl(API_ROUTES.mcpCreate), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const server = normalizeMcpServer(data.server);
  if (!server) throw new Error("The backend did not return the created MCP server.");
  return server;
}

export async function updateMcpServer(id: string, patch: Partial<McpServerInput>): Promise<McpServer> {
  const data = await requestJson<{ server?: unknown }>(
    routeUrl(API_ROUTES.mcpUpdate, { params: { id } }),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  const server = normalizeMcpServer(data.server);
  if (!server) throw new Error("The backend did not return the updated MCP server.");
  return server;
}

export async function deleteMcpServer(id: string): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.mcpDelete, { params: { id } }), { method: "DELETE" }).catch(
    () => {},
  );
}

export interface McpValidateResult {
  count: number;
  tools: McpToolEntry[];
}

/**
 * Test an unsaved server payload (connect + list tools) without persisting
 * anything. The create modal calls this on Save and only saves on success.
 * Throws with the backend's message on failure.
 */
export async function validateMcpServer(input: McpServerInput): Promise<McpValidateResult> {
  const data = await requestJson<{
    count?: number;
    tools?: Array<{ name?: string; description?: string }>;
  }>(routeUrl(API_ROUTES.mcpValidate), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return {
    count: typeof data.count === "number" ? data.count : 0,
    tools: (data.tools ?? [])
      .filter((t) => t && typeof t.name === "string")
      .map((t) => ({
        name: t.name as string,
        native: null,
        description: typeof t.description === "string" ? t.description : "",
      })),
  };
}

export interface McpToolEntry {
  name: string;
  native: string | null;
  description: string;
}

export interface McpTestResult {
  server: McpServer;
  count: number;
  tools: McpToolEntry[];
}

/** Connect to a server and list its tools (the explicit Test/Connect action). */
export async function testMcpServer(id: string): Promise<McpTestResult> {
  const data = await requestJson<{
    server?: unknown;
    count?: number;
    tools?: Array<{ name?: string; native?: string | null; description?: string }>;
  }>(routeUrl(API_ROUTES.mcpTest, { params: { id } }), { method: "POST" });
  const server = normalizeMcpServer(data.server);
  if (!server) throw new Error("The backend did not return the tested MCP server.");
  return {
    server,
    count: typeof data.count === "number" ? data.count : 0,
    tools: (data.tools ?? [])
      .filter((t) => t && typeof t.name === "string")
      .map((t) => ({
        name: t.name as string,
        native: typeof t.native === "string" ? t.native : null,
        description: typeof t.description === "string" ? t.description : "",
      })),
  };
}

/** Live tool catalog of one server. */
export async function fetchMcpServerTools(id: string, signal?: AbortSignal): Promise<McpToolEntry[]> {
  const data = await requestJson<{ tools?: Array<{ name?: string; description?: string }> }>(
    routeUrl(API_ROUTES.mcpServerTools, { params: { id } }),
    undefined,
    signal,
  );
  return (data.tools ?? [])
    .filter((t) => t && typeof t.name === "string")
    .map((t) => ({ name: t.name as string, native: null, description: typeof t.description === "string" ? t.description : "" }));
}

export interface McpEditorTool {
  /** Stable native name stored in tool allow-lists. */
  name: string;
  /** Raw tool name as the server reports it. */
  display: string;
  description: string;
  server_id: string;
  server_name: string;
}

/** Every tool of every connected MCP server (for the agent editors). */
export async function fetchMcpEditorTools(signal?: AbortSignal): Promise<McpEditorTool[]> {
  const data = await requestJson<{ tools?: McpEditorTool[] }>(
    routeUrl(API_ROUTES.mcpTools),
    undefined,
    signal,
  );
  const tools = Array.isArray(data.tools) ? data.tools : [];
  return tools.filter((t) => t && typeof t.name === "string" && t.name.length > 0);
}

/** Turn an `mcp_*` native tool name back into a readable label. */
export function humanizeMcpToolName(name: string): string {
  return name
    .replace(/^mcp_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export interface McpOAuthDiscovery {
  resource: string;
  resource_name?: string | null;
  authorization_server: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string | null;
  supports_dynamic_registration: boolean;
  scopes: string[];
}

/** Discover a remote server's OAuth configuration from its URL. */
export async function discoverMcpOAuth(url: string, signal?: AbortSignal): Promise<McpOAuthDiscovery> {
  return requestJson<McpOAuthDiscovery>(
    routeUrl(API_ROUTES.mcpOAuthDiscover),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    },
    signal,
  );
}

export interface McpOAuthStart {
  auth_url: string;
  state: string;
  redirect_uri: string;
}

/** Start the browser OAuth flow — returns the authorization URL to open. */
export async function startMcpOAuth(
  serverId: string,
  options?: {
    frontendUrl?: string;
    clientId?: string;
    clientSecret?: string;
    scopes?: string[];
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    registrationEndpoint?: string;
  },
): Promise<McpOAuthStart> {
  const data = await requestJson<McpOAuthStart>(routeUrl(API_ROUTES.mcpOAuthStart), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      server_id: serverId,
      frontend_url: options?.frontendUrl || undefined,
      client_id: options?.clientId || undefined,
      client_secret: options?.clientSecret || undefined,
      scopes: options?.scopes,
      authorization_endpoint: options?.authorizationEndpoint || undefined,
      token_endpoint: options?.tokenEndpoint || undefined,
      registration_endpoint: options?.registrationEndpoint || undefined,
    }),
  });
  if (!data.auth_url) throw new Error("The backend did not return an authorization URL.");
  return data;
}

/**
 * Complete a frontend-mode OAuth flow: the provider redirected the browser to
 * the app URL with `?code=…&state=…`; post both here and the backend exchanges
 * the code, stores the tokens, and returns the connected server.
 */
export async function exchangeMcpOAuthCode(code: string, state: string): Promise<McpServer> {
  const data = await requestJson<{ server?: unknown }>(
    routeUrl(API_ROUTES.mcpOAuthExchange),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
    },
  );
  const server = normalizeMcpServer(data.server);
  if (!server) throw new Error("The backend did not return the connected MCP server.");
  return server;
}

/** Forget a server's OAuth tokens (disconnect authorization, keep config). */
export async function disconnectMcpOAuth(id: string): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.mcpOAuthDisconnect, { params: { id } }), {
    method: "POST",
  }).catch(() => {});
}

/** Poll one server until it leaves `connecting` (or attempts run out). */
export async function pollMcpConnected(
  id: string,
  attempts = 40,
  intervalMs = 2500,
): Promise<McpServerStatus> {
  for (let i = 0; i < attempts; i += 1) {
    const data = await requestJson<{ server?: unknown }>(
      routeUrl(API_ROUTES.mcpGet, { params: { id } }),
    ).catch(() => null);
    const server = normalizeMcpServer(data?.server);
    const status = server?.status ?? "disconnected";
    if (status === "connected" || status === "error" || status === "auth_required") return status;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return "connecting";
}
