import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import {
  AVAILABLE_CONNECTORS,
  COMPOSIO_DEFAULT_USER_ID,
  ComposioClient,
  ConnectorManager,
  getConnector,
  type ComposioToolkitInfo,
  type ConnectorId,
} from "../agents/connectors/index.js";
import { isSafeSessionId } from "../database/index.js";

/**
 * Connectors API — third-party app integrations (GitHub, Slack, Notion, Gmail, Outlook)
 * powered by Composio.
 *
 * The browser owns no tokens: the OAuth dance happens through Composio (redirect URL
 * opened in a new tab, status polled until ACTIVE), and only the connected-account id
 * + status are persisted in the SQLite `connectors` document. Tool execution always
 * happens server-side through the connector bridge.
 *
 *   GET    /api/connectors              catalog + connection status (+ official logos)
 *   POST   /api/connectors/connect      { connector_id } -> { redirect_url, connected_account_id }
 *   GET    /api/connectors/status/:id   poll one connected account, persist its status
 *   POST   /api/connectors/refresh      re-poll every stored connection
 *   DELETE /api/connectors/:connectorId disconnect (remote best-effort + local removal)
 *   GET    /api/connectors/tools        every tool of every ACTIVE connector (uncapped)
 *   POST   /api/connectors/validate     { composio_api_key? } -> { ok }
 */

/** Toolkit metadata cache so the overview rarely hits Composio (logos change ~never). */
const TOOLKIT_INFO_TTL_MS = 60 * 60_000;
const toolkitInfoCache = new Map<string, { at: number; info: ComposioToolkitInfo | null }>();

async function toolkitInfo(
  client: ComposioClient,
  toolkitSlug: string,
): Promise<ComposioToolkitInfo | null> {
  const cached = toolkitInfoCache.get(toolkitSlug);
  if (cached && Date.now() - cached.at < TOOLKIT_INFO_TTL_MS) return cached.info;
  const info = await client.getToolkit(toolkitSlug);
  toolkitInfoCache.set(toolkitSlug, { at: Date.now(), info });
  return info;
}

function clientFor(manager: ConnectorManager, config: AppConfig, override?: unknown): ComposioClient {
  const key = manager.resolveApiKey(
    typeof override === "string" ? override : "",
    config.composioApiKey,
  );
  return new ComposioClient(key);
}

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code });
}

export function buildConnectorsRouter(manager: ConnectorManager, config: AppConfig): Router {
  const router = Router();

  /** Catalog with live connection status (and official logos when a key is configured). */
  router.get("/", async (_req: Request, res: Response) => {
    const probe = clientFor(manager, config);
    const configured = probe.configured;
    const stored = new Map(manager.list().map((c) => [c.connectorId, c]));

    let logos = new Map<string, ComposioToolkitInfo | null>();
    if (configured) {
      const settled = await Promise.all(
        AVAILABLE_CONNECTORS.map(async (connector) => {
          try {
            return [connector.id, await toolkitInfo(probe, connector.toolkitSlug)] as const;
          } catch {
            return [connector.id, null] as const;
          }
        }),
      );
      logos = new Map(settled);
    }

    res.json({
      ok: true,
      configured,
      user_id: COMPOSIO_DEFAULT_USER_ID,
      connectors: AVAILABLE_CONNECTORS.map((connector) => {
        const connection = stored.get(connector.id);
        const info = logos.get(connector.id) ?? null;
        return {
          id: connector.id,
          name: connector.name,
          description: connector.description,
          homepage: connector.homepage,
          logo_url: info?.logo ?? null,
          tools_count: info?.toolsCount ?? null,
          status: connection?.status ?? "disconnected",
          connected_account_id: connection?.connectedAccountId ?? null,
          account_label: connection?.accountLabel ?? "",
          updated_at: connection?.updatedAt ?? null,
        };
      }),
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
    const connector = getConnector(typeof body.connector_id === "string" ? body.connector_id : "");
    if (!connector) {
      err(res, 400, "unknown_connector", "Unknown connector. Expected one of: github, slack, notion, gmail, outlook.");
      return;
    }
    const client = clientFor(manager, config, body.composio_api_key);
    if (!client.configured) {
      err(res, 400, "composio_key_missing", "No Composio API key is configured. Add one in Settings → Composio first.");
      return;
    }

    try {
      let authConfig = await client.findAuthConfig(connector.toolkitSlug);
      authConfig ??= await client.createAuthConfig(connector.toolkitSlug);
      const link = await client.createLink(authConfig.id, COMPOSIO_DEFAULT_USER_ID);
      const record = manager.upsertPending(connector.id, link.connectedAccountId);
      res.json({
        ok: true,
        connector_id: connector.id,
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
      // Attribute the polled account to whichever stored connection holds its id.
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
    const connector = getConnector(String(req.params.connectorId));
    if (!connector) {
      err(res, 404, "unknown_connector", "Unknown connector.");
      return;
    }
    const stored = manager.get(connector.id);
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
    manager.remove(connector.id as ConnectorId);
    res.json({ ok: true, connector_id: connector.id });
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
    const byToolkit = new Map<string, ConnectorId>();
    for (const connection of active) {
      const connector = getConnector(connection.connectorId);
      if (connector) byToolkit.set(connector.toolkitSlug.toLowerCase(), connector.id);
    }
    const tools: Array<{
      name: string;
      display: string;
      description: string;
      connector_id: string;
      toolkit: string;
    }> = [];
    await Promise.all(
      [...byToolkit.entries()].map(async ([toolkitSlug, connectorId]) => {
        try {
          const items = await client.listTools(toolkitSlug);
          for (const item of items) {
            tools.push({
              name: item.slug,
              display: item.name || item.slug,
              description: item.description,
              connector_id: connectorId,
              toolkit: toolkitSlug,
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
