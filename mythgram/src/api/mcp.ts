import { Router, type Request, type Response } from "express";
import {
  McpManager,
  buildAuthorizeUrl,
  canonicalResourceUri,
  discoverOAuth,
  exchangeCode,
  fetchAuthorizationServerMetadata,
  isMcpToolName,
  mcpServerSlug,
  normalizeMcpServerConfig,
  pkceChallenge,
  randomOAuthString,
  registerClient,
  toPublicServer,
  type McpServerConfig,
} from "../agents/mcp/index.js";
import { isSafeSessionId } from "../database/index.js";

/**
 * MCP API — Model Context Protocol servers (remote Streamable HTTP + local
 * stdio), with OAuth 2.1 authorization for protected servers.
 *
 * Secrets (API keys, tokens, header values) NEVER leave the backend: every
 * read endpoint serves the public projection; writes accept secrets and store
 * them directly into SQLite.
 *
 * OAuth always completes in the app (frontend URL): the provider redirects
 * the browser back to the app with `?code=…&state=…`, the app posts both to
 * `POST /api/mcp/oauth/exchange`, and the backend exchanges, stores, and
 * warms the catalog.
 *
 *   GET    /api/mcp                        servers (public) + statuses
 *   POST   /api/mcp                        create {name, kind, url|json, ...}
 *   POST   /api/mcp/validate               test an unsaved payload (no persistence)
 *   PUT    /api/mcp/:id                    update (secrets are write-only)
 *   DELETE /api/mcp/:id                    delete (+ kill local child)
 *   POST   /api/mcp/:id/test               connect + tools/list, persist status
 *   GET    /api/mcp/:id/tools              live tool catalog of one server
 *   GET    /api/mcp/tools                  native tool entries of all connected
 *                                          servers (for the agent editors)
 *   POST   /api/mcp/oauth/discover         { url } -> resource + AS metadata
 *   POST   /api/mcp/oauth/start            { server_id, ... } -> { auth_url }
 *   POST   /api/mcp/oauth/exchange         { code, state } -> connected server
 *   POST   /api/mcp/:id/oauth/disconnect   forget OAuth tokens
 */

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code });
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The OAuth redirect URI: the app URL plus an `mcp_oauth=1` marker so the SPA
 * recognizes the returning authorization response (the provider appends
 * `&code=…&state=…`). Registered verbatim — the provider must allowlist this
 * exact URL or it rejects the flow with invalid redirect_uri.
 */
function frontendRedirectUri(frontendUrl: string): string {
  const base = frontendUrl.trim().replace(/\/+$/, "");
  return base.includes("?") ? `${base}&mcp_oauth=1` : `${base}?mcp_oauth=1`;
}

/** Native function name for an editor entry (mirrors runtime.nativeToolName). */
function nativeName(server: McpServerConfig, tool: string): string | null {
  const clean = tool.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!clean) return null;
  let base = `mcp_${mcpServerSlug(server)}_${clean}`;
  if (base.length > 64) base = `${base.slice(0, 57)}_${shortHash(`${server.id}:${tool}`)}`;
  return base;
}

function shortHash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (Math.imul(h, 31) + value.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).padStart(6, "0").slice(0, 6);
}

export function buildMcpRouter(manager: McpManager): Router {
  const router = Router();

  /** Every server (public projection) with live statuses. */
  router.get("/", (_req: Request, res: Response) => {
    res.json({ ok: true, count: manager.list().length, servers: manager.listPublic() });
  });

  /** Create a server (remote URL or pasted local JSON). */
  router.post("/", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const server = manager.create(body);
      res.json({ ok: true, server: toPublicServer(server) });
    } catch (error) {
      err(res, 400, "invalid_server", error instanceof Error ? error.message : String(error));
    }
  });

  /**
   * Validate a not-yet-saved server payload: checks the shape (including
   * pasted local JSON), connects, and lists its tools. Nothing is persisted
   * and no pooled connection is kept — the local child process is reaped.
   * The create modal calls this on Save and only saves when it succeeds.
   */
  router.post("/validate", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const tools = await manager.validateDraft(body);
      res.json({ ok: true, count: tools.length, tools });
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = error instanceof Error ? error.message : String(error);
      if (code === "invalid_server") {
        err(res, 400, code, message);
      } else if (code === "oauth_required") {
        err(res, 401, code, message);
      } else {
        err(res, 502, "mcp_validate_failed", message);
      }
    }
  });

  /**
   * Native tool entries of every CONNECTED + enabled server, for the agent
   * editors (sub-agents, Custom Agents). Built from the persisted catalog
   * cache so it answers without dialing any server; each entry carries the
   * stable native name the turn stores in tool allow-lists.
   */
  router.get("/tools", (_req: Request, res: Response) => {
    const tools: Array<{
      name: string;
      display: string;
      description: string;
      server_id: string;
      server_name: string;
    }> = [];
    for (const server of manager.listEnabled()) {
      for (const tool of server.cachedTools) {
        if (server.disabledTools.includes(tool.name)) continue;
        const name = nativeName(server, tool.name);
        if (!name) continue;
        tools.push({
          name,
          display: tool.name,
          description: tool.description,
          server_id: server.id,
          server_name: server.name,
        });
      }
    }
    tools.sort((a, b) =>
      a.server_name === b.server_name
        ? a.name.localeCompare(b.name)
        : a.server_name.localeCompare(b.server_name),
    );
    res.json({ ok: true, count: tools.length, tools });
  });

  /**
   * Discover a remote server's OAuth configuration (protected-resource
   * metadata + authorization-server metadata). No server needs to exist yet —
   * the MCP page calls this from the server URL the user typed.
   * Body: { url: string }.
   */
  router.post("/oauth/discover", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { url?: unknown };
    const url = str(body.url).trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      err(res, 400, "invalid_url", "A valid http(s) MCP server URL is required for OAuth discovery.");
      return;
    }
    try {
      const discovery = await discoverOAuth(url);
      res.json({
        ok: true,
        resource: discovery.resourceMetadata.resource,
        resource_name: discovery.resourceMetadata.resourceName ?? null,
        authorization_server: discovery.serverMetadata.issuer,
        authorization_endpoint: discovery.serverMetadata.authorizationEndpoint,
        token_endpoint: discovery.serverMetadata.tokenEndpoint,
        registration_endpoint: discovery.serverMetadata.registrationEndpoint ?? null,
        supports_dynamic_registration: discovery.supportsDynamicRegistration,
        scopes: discovery.recommendedScopes,
      });
    } catch (error) {
      err(res, 502, "oauth_discovery_failed", error instanceof Error ? error.message : String(error));
    }
  });

  /**
   * Start the browser OAuth flow for a server. The provider always redirects
   * back to the app's frontend URL (`?mcp_oauth=1&code=…&state=…`), which the
   * app completes via `POST /api/mcp/oauth/exchange`. Resolves endpoints
   * (manual overrides win, else discovery), obtains client credentials
   * (stored ones, else dynamic registration), and returns the authorization
   * URL to open. Body: { server_id, frontend_url?, client_id?,
   * client_secret?, scopes? }.
   */
  router.post("/oauth/start", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const serverId = str(body.server_id ?? body.serverId);
    if (!isSafeSessionId(serverId)) {
      err(res, 400, "invalid_id", "A valid server id is required.");
      return;
    }
    const server = manager.get(serverId);
    if (!server) {
      err(res, 404, "unknown_server", "MCP server not found.");
      return;
    }
    if (server.kind !== "remote") {
      err(res, 400, "local_server", "Local MCP servers do not use OAuth — credentials come from the environment.");
      return;
    }
    try {
      const oauth = server.oauth ?? { scopes: [] };
      const manualAuth = str(body.authorization_endpoint ?? oauth.authorizationEndpoint).trim();
      const manualToken = str(body.token_endpoint ?? oauth.tokenEndpoint).trim();
      const manualRegister = str(body.registration_endpoint ?? oauth.registrationEndpoint).trim();
      const issuer =
        str(body.authorization_server ?? body.issuer ?? oauth.authorizationServer).trim() || undefined;

      // The provider redirects back to the app URL (auto-detected, editable).
      // This exact URL is registered and sent — allowlist it verbatim at the
      // provider, or the provider rejects the flow with invalid redirect_uri.
      const frontendBase = str(body.frontend_url ?? body.frontendUrl ?? server.frontendUrl).trim();
      if (!/^https?:\/\//i.test(frontendBase)) {
        err(
          res,
          400,
          "frontend_url_required",
          "Your app's URL is required (e.g. http://localhost:5173 or your live cloud URL).",
        );
        return;
      }
      const redirectUri = frontendRedirectUri(frontendBase);

      let authorizationEndpoint = manualAuth || "";
      let tokenEndpoint = manualToken || "";
      let registrationEndpoint = manualRegister || "";
      let pkceMethods: string[] | undefined;
      if (!authorizationEndpoint || !tokenEndpoint) {
        // Resolve via discovery (stored issuer first, else fresh discovery).
        let discoveredIssuer = issuer;
        let scopes = Array.isArray(body.scopes) ? (body.scopes as string[]) : oauth.scopes;
        if (!discoveredIssuer) {
          const discovery = await discoverOAuth(server.url);
          discoveredIssuer = discovery.serverMetadata.issuer;
          authorizationEndpoint = authorizationEndpoint || discovery.serverMetadata.authorizationEndpoint;
          tokenEndpoint = tokenEndpoint || discovery.serverMetadata.tokenEndpoint;
          registrationEndpoint = registrationEndpoint || discovery.serverMetadata.registrationEndpoint || "";
          pkceMethods = discovery.serverMetadata.codeChallengeMethods;
          if (scopes.length === 0) scopes = discovery.recommendedScopes;
        } else {
          const meta = await fetchAuthorizationServerMetadata(discoveredIssuer);
          authorizationEndpoint = authorizationEndpoint || meta.authorizationEndpoint;
          tokenEndpoint = tokenEndpoint || meta.tokenEndpoint;
          registrationEndpoint = registrationEndpoint || meta.registrationEndpoint || "";
          pkceMethods = meta.codeChallengeMethods;
          if (scopes.length === 0) scopes = meta.scopesSupported;
        }
        if (!authorizationEndpoint || !tokenEndpoint) {
          err(res, 502, "oauth_no_endpoints", "Could not resolve the authorization and token endpoints. Enter them manually.");
          return;
        }
        // The spec requires S256 PKCE: refuse early when the AS rules it out,
        // instead of sending the user into a doomed authorization page.
        if (pkceMethods && pkceMethods.length > 0 && !pkceMethods.includes("S256")) {
          err(
            res,
            400,
            "oauth_no_pkce",
            `The authorization server does not support PKCE S256 (advertises: ${pkceMethods.join(", ")}). MCP requires S256.`,
          );
          return;
        }
        // Persist what we learned so reconnects skip discovery.
        manager.update(serverId, {
          oauth: {
            ...oauth,
            authorizationServer: discoveredIssuer,
            authorizationEndpoint,
            tokenEndpoint,
            registrationEndpoint: registrationEndpoint || undefined,
            scopes,
          },
          ...(str(body.frontend_url ?? body.frontendUrl).trim()
            ? { frontendUrl: str(body.frontend_url ?? body.frontendUrl).trim() }
            : {}),
        });
      } else if (str(body.frontend_url ?? body.frontendUrl).trim()) {
        manager.update(serverId, {
          frontendUrl: str(body.frontend_url ?? body.frontendUrl).trim(),
        });
      }

      let clientId = str(body.client_id ?? oauth.clientId).trim();
      let clientSecret: string | undefined = str(body.client_secret ?? oauth.clientSecret).trim() || undefined;
      if (!clientId) {
        if (!registrationEndpoint) {
          err(
            res,
            400,
            "oauth_client_required",
            "This authorization server needs a pre-registered client: enter its client ID (and secret for confidential clients).",
          );
          return;
        }
        // Dynamic registration MUST carry the exact redirect_uri the flow will
        // send — otherwise the provider later rejects it as unregistered.
        const registered = await registerClient({
          registrationEndpoint,
          redirectUris: [redirectUri],
          clientName: "Mythgram MCP Client",
        });
        clientId = registered.clientId;
        clientSecret = registered.clientSecret;
        manager.update(serverId, { oauth: { clientId, clientSecret } });
      } else if (str(body.client_secret).trim()) {
        manager.update(serverId, { oauth: { clientId, clientSecret } });
      } else if (oauth.clientId !== clientId) {
        manager.update(serverId, { oauth: { clientId } });
      }

      const fresh = manager.get(serverId);
      const scopes: string[] = Array.isArray(body.scopes)
        ? (body.scopes as unknown[]).filter((s): s is string => typeof s === "string")
        : (fresh?.oauth?.scopes ?? []);
      const resource = canonicalResourceUri(server.url);
      const verifier = randomOAuthString(64);
      const state = `mcp_${randomOAuthString(32)}`;
      manager.savePendingFlow({
        state,
        serverId,
        verifier,
        resource,
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
        tokenEndpoint,
        redirectUri,
      });

      const authUrl = buildAuthorizeUrl({
        authorizationEndpoint,
        clientId,
        redirectUri,
        resource,
        scopes,
        state,
        codeChallenge: pkceChallenge(verifier),
      });
      res.json({ ok: true, auth_url: authUrl, state, redirect_uri: redirectUri });
    } catch (error) {
      err(res, 502, "oauth_start_failed", error instanceof Error ? error.message : String(error));
    }
  });

  /**
   * Complete an OAuth flow whose authorization server redirected the browser
   * to the FRONTEND url (`?code=…&state=…`). The frontend captures those
   * params and posts them here; the backend validates the state, exchanges
   * the code (+ PKCE verifier + resource indicator), stores the tokens, warms
   * the tool catalog, and returns the connected server.
   * Body: { code: string, state: string }.
   */
  router.post("/oauth/exchange", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { code?: unknown; state?: unknown };
    const code = str(body.code);
    const state = str(body.state);
    if (!code || !state) {
      err(res, 400, "missing_code", "An authorization code and state are required.");
      return;
    }
    const pending = manager.takePendingFlow(state);
    if (!pending) {
      err(res, 400, "unknown_state", "Unknown or expired authorization session. Restart the flow from the MCP page.");
      return;
    }
    try {
      const tokens = await exchangeCode({
        tokenEndpoint: pending.tokenEndpoint,
        code,
        redirectUri: pending.redirectUri,
        codeVerifier: pending.verifier,
        clientId: pending.clientId,
        clientSecret: pending.clientSecret,
        resource: pending.resource,
      });
      manager.storeTokens(pending.serverId, tokens);
      try {
        const client = await manager.connection(pending.serverId);
        const tools = await client.listTools();
        manager.markStatus(pending.serverId, "connected", {
          cachedTools: tools.map((t) => ({ name: t.name, description: t.description })),
        });
      } catch {
        manager.markStatus(pending.serverId, "connected");
      }
      const server = manager.getPublic(pending.serverId);
      if (!server) {
        err(res, 404, "unknown_server", "MCP server not found.");
        return;
      }
      res.json({ ok: true, server });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      manager.markStatus(pending.serverId, "error", { lastError: message.slice(0, 300) });
      err(res, 502, "oauth_exchange_failed", message);
    }
  });

  /** Live tool catalog of one server (connects, lists, persists the cache). */
  router.get("/:id/tools", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "invalid_id", "Invalid server id.");
      return;
    }
    const server = manager.get(id);
    if (!server) {
      err(res, 404, "unknown_server", "MCP server not found.");
      return;
    }
    try {
      const client = await manager.connection(id);
      const tools = await client.listTools();
      manager.touch(id);
      manager.markStatus(id, "connected", {
        cachedTools: tools.map((t) => ({ name: t.name, description: t.description })),
      });
      res.json({
        ok: true,
        server_id: id,
        count: tools.length,
        tools: tools.map((t) => ({ name: t.name, native: nativeName(server, t.name), description: t.description })),
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "OAUTH_REQUIRED") {
        manager.markStatus(id, "auth_required", { lastError: messageOf(error) });
        err(res, 401, "oauth_required", messageOf(error));
        return;
      }
      manager.markStatus(id, "error", { lastError: messageOf(error) });
      err(res, 502, "mcp_list_failed", messageOf(error));
    }
  });

  /**
   * Connect + list: the explicit "Test"/"Connect" action. Persists status +
   * cached catalog so cards render tools without dialing on every page open.
   */
  router.post("/:id/test", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "invalid_id", "Invalid server id.");
      return;
    }
    const server = manager.get(id);
    if (!server) {
      err(res, 404, "unknown_server", "MCP server not found.");
      return;
    }
    try {
      const client = await manager.connection(id);
      const tools = await client.listTools();
      manager.touch(id);
      const updated = manager.markStatus(id, "connected", {
        cachedTools: tools.map((t) => ({ name: t.name, description: t.description })),
      });
      res.json({
        ok: true,
        server: updated ? toPublicServer(updated) : toPublicServer(server),
        count: tools.length,
        tools: tools.map((t) => ({ name: t.name, native: nativeName(server, t.name), description: t.description })),
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "OAUTH_REQUIRED") {
        manager.markStatus(id, "auth_required", { lastError: messageOf(error) });
        err(res, 401, "oauth_required", messageOf(error));
        return;
      }
      const message = messageOf(error);
      manager.markStatus(id, "error", { lastError: message.slice(0, 300) });
      err(res, 502, "mcp_test_failed", message);
    }
  });

  /** Forget a server's OAuth tokens (disconnect authorization, keep config). */
  router.post("/:id/oauth/disconnect", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "invalid_id", "Invalid server id.");
      return;
    }
    const updated = manager.clearTokens(id);
    if (!updated) {
      err(res, 404, "unknown_server", "MCP server not found.");
      return;
    }
    res.json({ ok: true, server: toPublicServer(updated) });
  });

  router.get("/:id", (req: Request, res: Response) => {
    const server = manager.getPublic(String(req.params.id));
    if (!server) {
      err(res, 404, "unknown_server", "MCP server not found.");
      return;
    }
    res.json({ ok: true, server });
  });

  router.put("/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "invalid_id", "Invalid server id.");
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = manager.update(id, body);
    if (!updated) {
      err(res, 404, "unknown_server", "MCP server not found.");
      return;
    }
    res.json({ ok: true, server: toPublicServer(updated) });
  });

  router.delete("/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "invalid_id", "Invalid server id.");
      return;
    }
    res.json({ ok: manager.delete(id) });
  });

  return router;
}

/** Re-exported so chat.ts can normalize without touching the manager. */
export { normalizeMcpServerConfig, isMcpToolName };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
