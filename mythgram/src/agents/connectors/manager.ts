import type { AppStateRepo } from "../../database/repositories/appStateRepo.js";
import {
  normalizeConnectorConnection,
  type ConnectorConnection,
  type ConnectorId,
  type ConnectorStatus,
} from "./configuration.js";

/**
 * ConnectorManager — the persistent store for connector connections.
 *
 * It reuses the application's existing persistence architecture: connections live in
 * the SQLite-backed `app_state` document keyed `connectors` (the very same document
 * the frontend syncs to). No new persistence system is introduced.
 *
 * A connection record only stores the Composio connected-account id + status — never
 * tokens or secrets (those stay inside Composio). At most one connection per connector.
 */
export class ConnectorManager {
  constructor(private readonly appState: AppStateRepo) {}

  /** All stored connections, normalized (unknown connectors / malformed rows dropped). */
  list(): ConnectorConnection[] {
    const raw = this.appState.get("connectors");
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    const out: ConnectorConnection[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const connection = normalizeConnectorConnection(item, { now });
      if (!connection || seen.has(connection.connectorId)) continue;
      seen.add(connection.connectorId);
      out.push(connection);
    }
    return out.sort((a, b) => a.connectorId.localeCompare(b.connectorId));
  }

  /** One connection by connector id, or null when not connected. */
  get(connectorId: string): ConnectorConnection | null {
    const key = connectorId.trim().toLowerCase();
    return this.list().find((c) => c.connectorId === key) ?? null;
  }

  /**
   * Record a freshly initiated OAuth flow (status `pending`). Replaces any previous
   * record for the connector so a reconnect never leaves stale account ids behind.
   */
  upsertPending(connectorId: ConnectorId, connectedAccountId: string): ConnectorConnection {
    const now = Date.now();
    const record: ConnectorConnection = {
      connectorId,
      connectedAccountId,
      status: "pending",
      accountLabel: this.get(connectorId)?.accountLabel ?? "",
      createdAt: this.get(connectorId)?.createdAt ?? now,
      updatedAt: now,
    };
    this.persist([record, ...this.list().filter((c) => c.connectorId !== connectorId)]);
    return record;
  }

  /** Update a connection's status (and optional account label) after polling Composio. */
  markStatus(
    connectorId: ConnectorId,
    status: ConnectorStatus,
    accountLabel?: string,
  ): ConnectorConnection | null {
    const all = this.list();
    const index = all.findIndex((c) => c.connectorId === connectorId);
    if (index === -1) return null;
    const existing = all[index]!;
    const updated: ConnectorConnection = {
      ...existing,
      status,
      accountLabel:
        typeof accountLabel === "string" && accountLabel.trim().length > 0
          ? accountLabel.trim()
          : existing.accountLabel,
      updatedAt: Date.now(),
    };
    const next = all.slice();
    next[index] = updated;
    this.persist(next);
    return updated;
  }

  /** Remove a connection (after disconnecting on Composio's side). Returns true when removed. */
  remove(connectorId: string): boolean {
    const key = connectorId.trim().toLowerCase();
    const all = this.list();
    const next = all.filter((c) => c.connectorId !== key);
    if (next.length === all.length) return false;
    this.persist(next);
    return true;
  }

  /**
   * Resolve the Composio API key for a request: an explicit per-request override wins,
   * then the key stored in settings (synced from the frontend Settings popup), then the
   * server `COMPOSIO_API_KEY` env fallback. Returns "" when none is configured.
   */
  resolveApiKey(override?: string, serverFallback = ""): string {
    const fromOverride = (override ?? "").trim();
    if (fromOverride) return fromOverride;
    try {
      const settings = this.appState.get("settings");
      if (settings && typeof settings === "object") {
        const key = (settings as Record<string, unknown>).composioApiKey;
        if (typeof key === "string" && key.trim()) return key.trim();
      }
    } catch {
      // fall through to the server fallback
    }
    const fromServer = (serverFallback ?? "").trim();
    if (fromServer) return fromServer;
    return (process.env.COMPOSIO_API_KEY ?? "").trim();
  }

  private persist(connections: ConnectorConnection[]): void {
    this.appState.set("connectors", connections);
  }
}
