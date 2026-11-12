import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import {
  COMPOSIO_DEFAULT_USER_ID,
  ComposioClient,
  ConnectorManager,
  isToolkitSlug,
  type ComposioToolkitSummary,
} from "../agents/connectors/index.js";
import { isSafeSessionId } from "../database/index.js";

/**
 * Connectors API — third-party app integrations powered by Composio.
 *
 * The connectable app catalog is fetched LIVE from Composio (no static/pre-added list): the
 * backend lists the project's toolkits, keeps only the OAuth-capable ones, and returns them with
 * their official names, descriptions, and logo URLs. The browser owns no tokens: the OAuth dance
 * happens through Composio (redirect URL opened in a new tab, status polled until ACTIVE), and only
 * the connected-account id + status are persisted in the SQLite `connectors` document. Tool
 * execution always happens server-side through the connector bridge.
 *
 *   GET    /api/connectors              live OAuth-capable catalog + connection status (+ logos)
 *   POST   /api/connectors/connect      { connector_id } -> { redirect_url, connected_account_id }
 *   GET    /api/connectors/status/:id   poll one connected account, persist its status
 *   POST   /api/connectors/refresh      re-poll every stored connection
 *   DELETE /api/connectors/:connectorId disconnect (remote best-effort + local removal)
 *   GET    /api/connectors/tools        every tool of every ACTIVE connector (uncapped)
 *   POST   /api/connectors/validate     { composio_api_key? } -> { ok }
 */

/** Live toolkit catalog cache so the overview rarely hits Composio (logos change ~never). */
const TOOLKIT_CATALOG_TTL_MS = 60 * 60_000;
interface CatalogEntry {
  at: number;
  toolkits: ComposioToolkitSummary[];
}
const toolkitCatalogCache = new Map<string, CatalogEntry>();

async function oauthToolkits(client: ComposioClient, apiKey: string): Promise<ComposioToolkitSummary[]> {
  const cached = toolkitCatalogCache.get(apiKey);
  if (cached && Date.now() - cached.at < TOOLKIT_CATALOG_TTL_MS) return cached.toolkits;
  const all = await client.listToolkits();
  // Allow only OAuth-capable connectors, as required.
  const toolkits = all.filter((t) => t.oauthCapable);
  toolkitCatalogCache.set(apiKey, { at: Date.now(), toolkits });
  return toolkits;
}

function keyFor(manager: ConnectorManager, config: AppConfig, override?: unknown): string {
  return manager.resolveApiKey(
    typeof override === "string" ? override : "",
    config.composioApiKey,
  );
}

function clientFor(manager: ConnectorManager, config: AppConfig, override?: unknown): ComposioClient {
  return new ComposioClient(keyFor(manager, config, override));
}

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code });
}

export function buildConnectorsRouter(manager: ConnectorManager, config: AppConfig): Router {
  const router = Router();

  /** Live OAuth-capable catalog with connection status and official logos. */
  router.get("/", async (_req: Request, res: Response) => {
    const client = clientFor(manager, config);
    if (!client.configured) {
      res.json({ ok: true, configured: false, user_id: COMPOSIO_DEFAULT_USER_ID, connectors: [] });
      return;
    }
    const stored = new Map(manager.list().map((c) => [c.connectorId, c]));
    let toolkits: ComposioToolkitSummary[] = [];
    try {
      toolkits = await oauthToolkits(client, keyFor(manager, config));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string }).code ?? "composio_request_failed";
      res.status(502).json({ error: message, code, configured: true, connectors: [] });
      return;
    }

    const connectable = toolkits
      .map((toolkit) => {
        const connection = stored.get(toolkit.slug);
        return {
          id: toolkit.slug,
          name: toolkit.name,
          description: toolkit.description,
          homepage: toolkit.homepage,
          logo_url: toolkit.logo || null,
          tools_count: toolkit.toolsCount || null,
          status: connection?.status ?? "disconnected",
          connected_account_id: connection?.connectedAccountId ?? null,
          account_label: connection?.accountLabel ?? "",
          updated_at: connection?.updatedAt ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // Always include stored connections that are no longer in the live OAuth catalog so a
    // user can still see and disconnect them.
    for (const connection of stored.values()) {
      if (connectable.some((c) => c.id === connection.connectorId)) continue;
      connectable.push({
        id: connection.connectorId,
        name: connection.connectorId,
        description: "",
        homepage: "",
        logo_url: null,
        tools_count: null,
        status: connection.status,
        connected_account_id: connection.connectedAccountId,
        account_label: connection.accountLabel,
        updated_at: connection.updatedAt,
      });
    }

    res.json({
      ok: true,
      configured: true,
      user_id: COMPOSIO_DEFAULT_USER_ID,
      connectors: connectable,
    });
  });

  /**
   * Start connecting a connector. Resolves the toolkit's auth config (creating a
   * Composio-managed one when the project has none), opens a link session, and stores
   * the pending connection. The frontend opens `redirect_url` in a new tab and polls
   * `GET /status/:id` until the status becomes `active`.
   * Body: { connector_id: string, composio_api_key?: string }
   */
  router.post("/connect", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { connector_id?: unknown; composio_api_key?: unknown };
    const toolkitSlug = typeof body.connector_id === "string" ? body.connector_id.trim().toLowerCase() : "";
    if (!isToolkitSlug(toolkitSlug)) {
      err(res, 400, "unknown_connector", "A valid connector id (Composio toolkit slug) is required.");
      return;
    }
    const client = clientFor(manager, config, body.composio_api_key);
    if (!client.configured) {
      err(res, 400, "composio_key_missing", "No Composio API key is configured. Add one in Settings → Composio first.");
      return;
    }

    try {
      let authConfig = await client.findAuthConfig(toolkitSlug);
      authConfig ??= await client.createAuthConfig(toolkitSlug);
      const link = await client.createLink(authConfig.id, COMPOSIO_DEFAULT_USER_ID);
      const record = manager.upsertPending(toolkitSlug, link.connectedAccountId);
      res.json({
        ok: true,
        connector_id: toolkitSlug,
        redirect_url: link.redirectUrl,
        connected_account_id: link.connectedAccountId,
        status: record.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string }).code ?? "connector_connect_failed";
      err(res, 502, code, message);
    }
  });

  /** Poll one connected account and persist its latest status. */
  router.get("/status/:connectedAccountId", async (req: Request, res: Response) => {
    const connectedAccountId = String(req.params.connectedAccountId);
    if (!isSafeSessionId(connectedAccountId)) {
      err(res, 400, "invalid_id", "Invalid connected account id.");
      return;
    }
    const client = clientFor(manager, config);
    if (!client.configured) {
      err(res, 400, "composio_key_missing", "No Composio API key is configured. Add one in Settings → Composio first.");
      return;
    }
    try {
      const account = await client.getConnectedAccount(connectedAccountId);
      const status = account.status === "active" ? "active" : account.status === "failed" ? "failed" : "pending";
      const match = manager.list().find((c) => c.connectedAccountId === connectedAccountId);
      if (match) manager.markStatus(match.connectorId, status);
      res.json({ ok: true, connected_account_id: account.id, status });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string }).code ?? "connector_status_failed";
      err(res, 502, code, message);
    }
  });

  /** Re-poll every stored connection (used on boot / page open to heal stale states). */
  router.post("/refresh", async (_req: Request, res: Response) => {
    const client = clientFor(manager, config);
    if (!client.configured) {
      err(res, 400, "composio_key_missing", "No Composio API key is configured. Add one in Settings → Composio first.");
      return;
    }
    const results: Array<{ connector_id: string; status: string }> = [];
    for (const connection of manager.list()) {
      try {
        const account = await client.getConnectedAccount(connection.connectedAccountId);
        const status = account.status === "active" ? "active" : account.status === "failed" ? "failed" : "pending";
        manager.markStatus(connection.connectorId, status);
        results.push({ connector_id: connection.connectorId, status });
      } catch {
        results.push({ connector_id: connection.connectorId, status: connection.status });
      }
    }
    res.json({ ok: true, connectors: results });
  });

  /** Disconnect a connector: delete the remote account (best-effort) + drop the record. */
  router.delete("/:connectorId", async (req: Request, res: Response) => {
    const key = String(req.params.connectorId).trim().toLowerCase();
    if (!isToolkitSlug(key)) {
      err(res, 404, "unknown_connector", "Unknown connector.");
      return;
    }
    const stored = manager.get(key);
    if (stored) {
      const client = clientFor(manager, config);
      if (client.configured) {
        try {
          await client.deleteConnectedAccount(stored.connectedAccountId);
        } catch {
          // Local removal still proceeds — a stale remote account harms nothing.
        }
      }
    }
    manager.remove(key);
    res.json({ ok: true, connector_id: key });
  });

  /**
   * Every tool of every ACTIVE connector — the catalog the agent editors
   * (Custom Agents, sub-agents) offer. Uncapped by design: all pages, all tools.
   */
  router.get("/tools", async (_req: Request, res: Response) => {
    const client = clientFor(manager, config);
    if (!client.configured) {
      res.json({ ok: true, configured: false, count: 0, tools: [] });
      return;
    }
    const active = manager.list().filter((c) => c.status === "active");
    const tools: Array<{
      name: string;
      display: string;
      description: string;
      connector_id: string;
      toolkit: string;
    }> = [];
    await Promise.all(
      active.map(async (connection) => {
        try {
          const items = await client.listTools(connection.connectorId);
          for (const item of items) {
            tools.push({
              name: item.slug,
              display: item.name || item.slug,
              description: item.description,
              connector_id: connection.connectorId,
              toolkit: connection.connectorId,
            });
          }
        } catch {
          // One toolkit failing must not hide the others.
        }
      }),
    );
    tools.sort((a, b) =>
      a.connector_id === b.connector_id
        ? a.name.localeCompare(b.name)
        : a.connector_id.localeCompare(b.connector_id),
    );
    res.json({ ok: true, configured: true, count: tools.length, tools });
  });

  /** Validate a Composio API key (used by Settings / the Connectors page). */
  router.post("/validate", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { composio_api_key?: unknown };
    const client = clientFor(manager, config, body.composio_api_key);
    if (!client.configured) {
      err(res, 400, "composio_key_missing", "No Composio API key was provided.");
      return;
    }
    try {
      // A cheap, read-only probe: listing auth configs proves the key works.
      await client.findAuthConfig("github");
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string }).code ?? "composio_invalid_key";
      err(res, 502, code, message);
    }
  });

  return router;
}
