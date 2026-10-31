import crypto from "node:crypto";

/**
 * OAuth 2.1 client for MCP remote servers (authorization-code flow w/ PKCE S256,
 * RFC9728 protected-resource discovery, RFC8414 authorization-server metadata,
 * RFC7591 dynamic client registration, RFC8707 resource indicators).
 *
 * Flow implemented here (all server-side; the browser only visits the
 * authorization URL and lands back on the backend callback):
 *
 *   1. discover(serverUrl) — GET the protected-resource metadata
 *      (path-inserted `/.well-known/oauth-protected-resource/<path>` first,
 *      then the root document), honoring a 401 `WWW-Authenticate` header that
 *      points at `resource_metadata`.
 *   2. Authorization-server metadata — `/.well-known/oauth-authorization-server`
 *      (plus issuer-path and OpenID fallbacks) for endpoints.
 *   3. Client credentials — dynamic registration when the AS advertises it and
 *      the user gave no pre-registered client id, else the stored/manual one.
 *   4. start() — builds the authorization URL (response_type=code,
 *      code_challenge=S256, resource=<canonical server URI>, state) and keeps
 *      the verifier in a short-lived pending map.
 *   5. callback() — exchanges the code (+ resource + verifier) for tokens.
 *   6. refresh() — rotates the access token when the server 401s a call.
 */

const FETCH_TIMEOUT_MS = 20_000;

export interface ProtectedResourceMetadata {
  /** Canonical resource identifier (the MCP endpoint URI). */
  resource: string;
  /** Candidate authorization-server issuers (first = preferred). */
  authorizationServers: string[];
  /** Scopes the server advertises (may be empty). */
  scopesSupported: string[];
  /** Human-readable resource name, when advertised. */
  resourceName?: string;
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported: string[];
  /** PKCE methods the AS advertises (absent = unknown, not "none"). */
  codeChallengeMethods?: string[];
}

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret?: string;
}

export interface AuthorizeStart {
  /** URL to open in the browser. */
  authUrl: string;
  /** Opaque state the callback echoes back. */
  state: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires (0 = unknown). */
  expiresAt: number;
  tokenType: string;
}

/** Result of the discovery step shown in the UI before connecting. */
export interface McpOAuthDiscovery {
  /** The protected-resource metadata (canonical resource + AS list). */
  resourceMetadata: ProtectedResourceMetadata;
  /** Resolved authorization-server metadata (endpoints + scopes). */
  serverMetadata: AuthorizationServerMetadata;
  /** Whether the AS supports dynamic client registration. */
  supportsDynamicRegistration: boolean;
  /**
   * Scopes to request: the `scope` challenge from the 401 WWW-Authenticate
   * header when the server sent one (authoritative per RFC6750), else the
   * AS-advertised `scopes_supported` (may be empty).
   */
  recommendedScopes: string[];
}

function timeoutSignal(ms: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; headers: Headers; body: unknown }> {
  const { signal, cleanup } = timeoutSignal(FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal });
    const text = await res.text().catch(() => "");
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { status: res.status, headers: res.headers, body };
  } finally {
    cleanup();
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * Canonical MCP server URI for the `resource` parameter (RFC8707 §2):
 * scheme + lowercase host + port when non-default + path without trailing
 * slash, no query/fragment.
 */
export function canonicalResourceUri(serverUrl: string): string {
  const u = new URL(serverUrl.trim());
  u.hash = "";
  u.search = "";
  u.hostname = u.hostname.toLowerCase();
  u.protocol = u.protocol.toLowerCase();
  const isDefaultPort =
    (u.protocol === "https:" && (u.port === "" || u.port === "443")) ||
    (u.protocol === "http:" && (u.port === "" || u.port === "80"));
  const port = isDefaultPort ? "" : u.port ? `:${u.port}` : "";
  let path = u.pathname;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "/") path = "";
  return `${u.protocol}//${u.hostname}${port}${path}`;
}

/**
 * Candidate protected-resource metadata URLs for an MCP endpoint, most
 * specific first (RFC9728 §3.1 path-insertion, then the root document).
 */
export function protectedResourceMetadataUrls(serverUrl: string): string[] {
  const u = new URL(serverUrl.trim());
  const origin = `${u.protocol}//${u.host}`;
  const urls: string[] = [];
  let path = u.pathname;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path && path !== "/") {
    urls.push(`${origin}/.well-known/oauth-protected-resource${path}`);
  }
  urls.push(`${origin}/.well-known/oauth-protected-resource`);
  return urls;
}

/** Parse an RFC9728/RFC6750 `WWW-Authenticate` challenge for a `resource_metadata` URI. */
export function resourceMetadataFromWwwAuthenticate(header: string): string | null {
  return parseWwwAuthenticateChallenge(header).resourceMetadata;
}

/**
 * Parse a `WWW-Authenticate: Bearer ...` challenge (RFC9728 §5.1 + RFC6750 §3):
 * the `resource_metadata` URI plus the authoritative `scope` challenge, if any.
 */
export function parseWwwAuthenticateChallenge(header: string): {
  resourceMetadata: string | null;
  scope: string[];
} {
  const text = header ?? "";
  const meta = /resource_metadata\s*=\s*"([^"]+)"/i.exec(text)?.[1]?.trim() || null;
  const scopeRaw = /scope\s*=\s*"([^"]*)"/i.exec(text)?.[1] ?? "";
  const scope = scopeRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return { resourceMetadata: meta, scope };
}

function parseResourceMetadata(body: unknown, fallbackResource: string): ProtectedResourceMetadata | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  const servers = strList(r.authorization_servers);
  if (servers.length === 0) return null;
  return {
    resource: str(r.resource).trim() || fallbackResource,
    authorizationServers: servers.map((s) => s.trim()).filter(Boolean),
    scopesSupported: strList(r.scopes_supported),
    resourceName: str(r.resource_name).trim() || undefined,
  };
}

/**
 * Discover a remote MCP server's OAuth configuration: protected-resource
 * metadata (authorization servers + scopes), then authorization-server
 * metadata (endpoints). Tries the `WWW-Authenticate` hint first when a probe
 * request 401s, then the well-known URLs directly.
 */
export async function discoverOAuth(serverUrl: string): Promise<McpOAuthDiscovery> {
  let probeHint: string | null = null;
  let challengedScopes: string[] = [];
  try {
    const probe = await fetchJson(serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "mcp-oauth-probe", method: "ping" }),
    });
    if (probe.status === 401) {
      const challenge = parseWwwAuthenticateChallenge(probe.headers.get("www-authenticate") ?? "");
      probeHint = challenge.resourceMetadata;
      // The 401 scope challenge is authoritative for what to request (RFC6750).
      challengedScopes = challenge.scope;
    }
  } catch {
    // The probe is best-effort; discovery continues with the well-known URLs.
  }

  const canonical = canonicalResourceUri(serverUrl);
  const candidates = [
    ...(probeHint ? [probeHint] : []),
    ...protectedResourceMetadataUrls(serverUrl),
  ];
  let resourceMetadata: ProtectedResourceMetadata | null = null;
  const tried: string[] = [];
  for (const url of candidates) {
    tried.push(url);
    try {
      const res = await fetchJson(url, { headers: { Accept: "application/json" } });
      if (res.status !== 200) continue;
      const parsed = parseResourceMetadata(res.body, canonical);
      if (parsed) {
        resourceMetadata = parsed;
        break;
      }
    } catch {
      // try the next candidate
    }
  }
  if (!resourceMetadata) {
    throw new Error(
      `No OAuth protected-resource metadata found for this MCP server (tried ${tried.join(", ")}). ` +
        "The server may not require OAuth, or it uses a different authorization server — " +
        "enter the authorization server details manually.",
    );
  }

  const serverMetadata = await fetchAuthorizationServerMetadata(resourceMetadata.authorizationServers[0]!);
  return {
    resourceMetadata,
    serverMetadata,
    supportsDynamicRegistration: Boolean(serverMetadata.registrationEndpoint),
    recommendedScopes:
      challengedScopes.length > 0 ? challengedScopes : serverMetadata.scopesSupported,
  };
}

/**
 * Candidate authorization-server metadata URLs for an issuer, in the exact
 * priority order the MCP spec mandates:
 *  - issuer WITH path: oauth-authorization-server insertion, then
 *    openid-configuration insertion, then openid-configuration appending.
 *  - issuer WITHOUT path: oauth-authorization-server, then openid-configuration.
 */
function authorizationServerMetadataUrls(issuer: string): string[] {
  const clean = issuer.trim().replace(/\/+$/, "");
  const u = new URL(clean);
  const origin = `${u.protocol}//${u.host}`;
  const path = u.pathname && u.pathname !== "/" ? u.pathname.replace(/\/+$/, "") : "";
  if (path) {
    return [
      `${origin}/.well-known/oauth-authorization-server${path}`,
      `${origin}/.well-known/openid-configuration${path}`,
      `${clean}/.well-known/openid-configuration`,
    ];
  }
  return [
    `${origin}/.well-known/oauth-authorization-server`,
    `${origin}/.well-known/openid-configuration`,
  ];
}

/** Fetch and validate an authorization server's metadata document. */
export async function fetchAuthorizationServerMetadata(issuer: string): Promise<AuthorizationServerMetadata> {
  const candidates = authorizationServerMetadataUrls(issuer);
  const tried: string[] = [];
  for (const url of candidates) {
    tried.push(url);
    try {
      const res = await fetchJson(url, { headers: { Accept: "application/json" } });
      if (res.status !== 200) continue;
      const body = res.body as Record<string, unknown>;
      const authorizationEndpoint = str(body.authorization_endpoint).trim();
      const tokenEndpoint = str(body.token_endpoint).trim();
      if (!authorizationEndpoint || !tokenEndpoint) continue;
      return {
        issuer: str(body.issuer).trim() || issuer,
        authorizationEndpoint,
        tokenEndpoint,
        registrationEndpoint: str(body.registration_endpoint).trim() || undefined,
        scopesSupported: strList(body.scopes_supported),
        codeChallengeMethods: strList(body.code_challenge_methods_supported).map((m) =>
          m.trim().toUpperCase(),
        ),
      };
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `No OAuth authorization-server metadata found (tried ${tried.join(", ")}). ` +
      "Enter the authorization and token endpoints manually.",
  );
}

/**
 * Verify PKCE support before starting a flow (spec: clients MUST rely on AS
 * metadata and MUST use S256 when capable). Throws when the AS explicitly
 * advertises challenge methods without S256. An absent field means "unknown",
 * not "unsupported", so the flow proceeds.
 */
export function assertPkceS256Supported(meta: AuthorizationServerMetadata): void {
  const methods = meta.codeChallengeMethods;
  if (methods && methods.length > 0 && !methods.includes("S256")) {
    throw new Error(
      `The authorization server does not support PKCE S256 (advertises: ${methods.join(", ")}). ` +
        "MCP requires S256, so this server cannot be authorized.",
    );
  }
}

export interface RegisterClientOptions {
  registrationEndpoint: string;
  /** Redirect URIs the new client registers (must include the flow's redirect_uri). */
  redirectUris: string[];
  /** Human name shown on the authorization server's consent screen. */
  clientName?: string;
}

/**
 * Dynamic client registration (RFC7591): obtain a client id without user
 * interaction. Public client (no secret) unless the AS assigns credentials.
 */
export async function registerClient(options: RegisterClientOptions): Promise<OAuthClientCredentials> {
  const res = await fetchJson(options.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      redirect_uris: options.redirectUris,
      client_name: options.clientName ?? "Mythgram MCP Client",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: undefined,
    }),
  });
  if (res.status < 200 || res.status >= 300) {
    const message =
      (res.body as Record<string, unknown>)?.error_description ??
      (res.body as Record<string, unknown>)?.error ??
      `HTTP ${res.status}`;
    throw new Error(`Dynamic client registration failed: ${String(message).slice(0, 300)}`);
  }
  const body = res.body as Record<string, unknown>;
  const clientId = str(body.client_id).trim();
  if (!clientId) throw new Error("Dynamic client registration did not return a client_id.");
  const clientSecret = str(body.client_secret).trim() || undefined;
  return { clientId, clientSecret };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Random high-entropy string for PKCE verifiers and OAuth state. */
export function randomOAuthString(length = 64): string {
  const bytes = crypto.randomBytes(length);
  return base64Url(bytes).slice(0, length);
}

/** S256 PKCE challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  const digest = crypto.createHash("sha256").update(verifier, "utf8").digest();
  return base64Url(digest);
}

export interface BuildAuthorizeUrlOptions {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  /** Canonical MCP server URI (RFC8707 resource indicator). */
  resource: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}

/** Build the authorization URL the user visits (OAuth 2.1 + PKCE + resource). */
export function buildAuthorizeUrl(options: BuildAuthorizeUrlOptions): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: options.scopes.join(" "),
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    resource: options.resource,
  });
  const joiner = options.authorizationEndpoint.includes("?") ? "&" : "?";
  return `${options.authorizationEndpoint}${joiner}${params.toString()}`;
}

export interface ExchangeCodeOptions {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  /** Canonical MCP server URI (RFC8707 resource indicator). */
  resource: string;
}

/** Exchange an authorization code (+ PKCE verifier) for tokens. */
export async function exchangeCode(options: ExchangeCodeOptions): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    code_verifier: options.codeVerifier,
    resource: options.resource,
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (options.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;
  }
  const res = await fetchJson(options.tokenEndpoint, { method: "POST", headers, body: body.toString() });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Token exchange failed: ${tokenError(res.body)}`);
  }
  return toTokenSet(res.body);
}

export interface RefreshTokenOptions {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
  /** Canonical MCP server URI (RFC8707 resource indicator). */
  resource: string;
  scopes?: string[];
}

/** Rotate an expired access token with the stored refresh token. */
export async function refreshAccessToken(options: RefreshTokenOptions): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: options.refreshToken,
    client_id: options.clientId,
    resource: options.resource,
  });
  if (options.scopes && options.scopes.length > 0) body.set("scope", options.scopes.join(" "));
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (options.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;
  }
  const res = await fetchJson(options.tokenEndpoint, { method: "POST", headers, body: body.toString() });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Token refresh failed: ${tokenError(res.body)}`);
  }
  const tokens = toTokenSet(res.body);
  // Some servers rotate without re-issuing a refresh token — keep the old one then.
  if (!tokens.refreshToken) tokens.refreshToken = options.refreshToken;
  return tokens;
}

function tokenError(body: unknown): string {
  const r = (body ?? {}) as Record<string, unknown>;
  const desc = str(r.error_description).trim();
  const code = str(r.error).trim();
  return `${code || "unknown_error"}${desc ? ` — ${desc}` : ""}`.slice(0, 300);
}

function toTokenSet(body: unknown): TokenSet {
  const r = (body ?? {}) as Record<string, unknown>;
  const accessToken = str(r.access_token).trim();
  if (!accessToken) throw new Error("The authorization server did not return an access token.");
  const expiresIn = typeof r.expires_in === "number" && Number.isFinite(r.expires_in) ? r.expires_in : 0;
  return {
    accessToken,
    refreshToken: str(r.refresh_token).trim() || undefined,
    expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
    tokenType: str(r.token_type).trim() || "Bearer",
  };
}
