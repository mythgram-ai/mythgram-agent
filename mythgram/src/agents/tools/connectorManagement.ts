import {
  AVAILABLE_CONNECTORS,
  getConnector,
  type ComposioClient,
  type ConnectorConnection,
  type ConnectorId,
} from "../connectors/index.js";
import type { ConnectorManager } from "../connectors/manager.js";
import type { ToolContext, ToolResult } from "./types.js";

/**
 * Shared plumbing for the four agent-driven application-connector tools.
 *
 * Connectors are third-party app integrations (GitHub, Slack, Notion, Gmail, Outlook)
 * powered by Composio. The catalog, persistence, and the native tool bridge all live
 * in `agents/connectors`; this file is only the agent-facing glue:
 *
 *   - the tool-name registry + context guard
 *   - a model-facing projection of the catalog and of the current connections
 *   - the SSE events the chat UI renders (Connect button + refreshed connection list)
 *   - the bounded wait for the user to finish the OAuth flow
 *   - attach/detach of a connector's FULL native tool catalog on the LIVE turn, so an
 *     app the agent just connected is usable on the very next model iteration
 *
 * Secrets never appear here: a connection record is only a Composio connected-account
 * id plus a status, and every provider call goes through the Composio REST client.
 */

/** The four agent-driven application-connector tool names (single source of truth). */
export const CONNECTOR_MANAGEMENT_TOOL_NAMES: readonly string[] = [
  "connect_applications_connectors",
  "list_available_application_connectors",
  "disconnect_application_connector",
  "get_application_connector_status",
];

const CONNECTOR_TOOL_NAMES = new Set<string>(CONNECTOR_MANAGEMENT_TOOL_NAMES);

/** True when a tool name is one of the agent-driven connector management tools. */
export function isConnectorManagementTool(name: string): boolean {
  return CONNECTOR_TOOL_NAMES.has((name ?? "").trim());
}

/** How long a connect call waits for the user to finish authorizing (3 minutes). */
export const CONNECTOR_CONNECTION_TIMEOUT_MS = 3 * 60_000;

/** Poll interval while waiting for the user to complete the connector OAuth flow. */
const CONNECTOR_CONNECTION_POLL_MS = 2_000;

/**
 * Shared guard: connector management tools need the persisted connector manager, so
 * they only work where the manager is injected (main / custom / team / CEO agents) and
 * never for sub-agents, chat mode, or the memory agent.
 */
export function requireConnectorManager(ctx: ToolContext): ToolResult | null {
  if (!ctx.connectorManager) {
    return {
      ok: false,
      error: {
        code: "connectors_unavailable",
        message:
          "Application-connector management is not available in this context. It is only available to the main agent, custom agents, and team/CEO agents.",
      },
    };
  }
  return null;
}

/** One catalog entry as the model sees it in list / status results. */
export interface ConnectorCatalogEntry {
  /** The exact name to pass to connect/disconnect/status (lowercase connector id). */
  connector_name: ConnectorId;
  /** Human display name, e.g. "GitHub". */
  label: string;
  description: string;
  /** The app's homepage, useful when explaining what connecting does. */
  homepage: string;
  /** Composio toolkit slug that backs this connector (informational). */
  toolkit: string;
}

/** The full connectable catalog, in the order the Connectors page renders it. */
export function connectorCatalog(): ConnectorCatalogEntry[] {
  return AVAILABLE_CONNECTORS.map((connector) => ({
    connector_name: connector.id,
    label: connector.name,
    description: connector.description,
    homepage: connector.homepage,
    toolkit: connector.toolkitSlug,
  }));
}

/**
 * Normalize an LLM/user-supplied connector name to its canonical id. Accepts the exact
 * catalog name (case/space-insensitive) and the app's display name so the agent is never
 * blocked on capitalization. Returns null when nothing matches.
 */
export function normalizeConnectorName(raw: unknown): ConnectorId | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!value) return null;
  if (getConnector(value)) return value as ConnectorId;
  const spaced = value.replace(/[\s_-]+/g, "");
  if (getConnector(spaced)) return spaced as ConnectorId;
  const byName = AVAILABLE_CONNECTORS.find(
    (connector) => connector.name.trim().toLowerCase().replace(/[\s_-]+/g, "") === spaced,
  );
  return byName ? byName.id : null;
}

/** Valid connector names for error messages, e.g. "github, slack, notion, gmail, outlook". */
export function validConnectorNames(): string {
  return AVAILABLE_CONNECTORS.map((c) => c.id).join(", ");
}

/**
 * The effective connection state of one connector, in the vocabulary the tools report:
 * connected | disconnected | requires_user_action | failed.
 */
export type ConnectorEffectiveStatus =
  | "connected"
  | "disconnected"
  | "requires_user_action"
  | "failed";

/** Map a stored record (or its absence) to the effective status above. */
export function effectiveStatus(connection: ConnectorConnection | null): ConnectorEffectiveStatus {
  if (!connection) return "disconnected";
  if (connection.status === "active") return "connected";
  if (connection.status === "failed") return "failed";
  return "requires_user_action";
}

/**
 * Browser-safe projection of one connection for the model + the chat UI. A null
 * connection projects as the disconnected state, so callers never branch on it.
 */
export function publicConnection(connection: ConnectorConnection | null): Record<string, unknown> {
  if (!connection) {
    return {
      status: "disconnected" satisfies ConnectorEffectiveStatus,
      stored_status: null,
      connected: false,
      enabled: false,
      requires_user_action: false,
      account_label: "",
      connected_at: null,
      updated_at: null,
    };
  }
  const definition = getConnector(connection.connectorId);
  return {
    connector_name: connection.connectorId,
    label: definition?.name ?? connection.connectorId,
    status: effectiveStatus(connection),
    stored_status: connection.status,
    connected: connection.status === "active",
    enabled: connection.status === "active",
    requires_user_action: connection.status === "pending",
    account_label: connection.accountLabel,
    connected_at: connection.createdAt,
    updated_at: connection.updatedAt,
  };
}

/** Every stored connection, projected for the model + the chat UI. */
export function publicConnectionList(manager: ConnectorManager): Array<Record<string, unknown>> {
  return manager.list().map(publicConnection);
}

/**
 * Emit the fresh connection list so the Connectors page and the next chat turn converge
 * on the backend truth immediately. The payload is the stored `ConnectorConnection[]`
 * shape (no secrets — only a Composio connected-account id + status), which is exactly
 * what the frontend store persists and sends back with the next turn.
 *
 * Best-effort — a failed emit never breaks the tool result.
 */
export function emitConnectorsUpdated(ctx: ToolContext, manager: ConnectorManager): void {
  try {
    ctx.emit?.("connectors_updated", {
      connectors: manager.list(),
      chat_id: ctx.chatId,
      tool_call_id: ctx.toolCallId,
    });
  } catch {
    // best effort
  }
}

/**
 * Emit the OAuth connect request so the chat UI renders a Connect button inside this
 * tool's block. The backend has already opened the Composio link session and persisted
 * the pending connection, so the button only has to open `redirect_url` in a new tab;
 * this tool keeps polling Composio until the account activates or the timeout elapses.
 */
export function emitConnectorConnectRequired(
  ctx: ToolContext,
  entry: ConnectorCatalogEntry,
  link: { redirectUrl: string; connectedAccountId: string },
): void {
  try {
    ctx.emit?.("connector_connect_required", {
      connector_name: entry.connector_name,
      connector_label: entry.label,
      description: entry.description,
      redirect_url: link.redirectUrl,
      connected_account_id: link.connectedAccountId,
      chat_id: ctx.chatId,
      tool_call_id: ctx.toolCallId,
    });
  } catch {
    // best effort
  }
}

/**
 * The Composio client for management calls. It comes from the turn's connector runtime
 * so the tools inherit the turn's credentials and transport; null when the user has no
 * Composio key configured (in which case connectors cannot be managed at all).
 */
export function requireComposioClient(ctx: ToolContext): ComposioClient | null {
  return ctx.connectors?.composioClient() ?? null;
}

/** Attach a connector's FULL native tool catalog to the live turn (same-turn availability). */
export async function attachConnectorToTurn(
  ctx: ToolContext,
  connectorId: string,
  connectedAccountId: string,
): Promise<{ attached: number; tools: string[] }> {
  try {
    if (!ctx.connectors) return { attached: 0, tools: [] };
    return await ctx.connectors.attachConnector(connectorId, connectedAccountId);
  } catch {
    // Best effort — the persisted connection is still usable from the next chat turn.
    return { attached: 0, tools: [] };
  }
}

/** Remove a disconnected connector's native tools from the live turn immediately. */
export function detachConnectorFromTurn(ctx: ToolContext, connectorId: string): number {
  try {
    return ctx.connectors?.detachConnector(connectorId) ?? 0;
  } catch {
    return 0;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** How a connect attempt finished. */
export type ConnectorConnectOutcome =
  | { status: "connected"; connection: ConnectorConnection }
  | { status: "failed"; connection: ConnectorConnection | null; message: string }
  | { status: "pending"; connection: ConnectorConnection | null }
  | { status: "aborted" };

/** Normalize a Composio connected-account status onto our stored statuses. */
function storedStatusOf(remoteStatus: string): "active" | "failed" | "pending" {
  const s = (remoteStatus ?? "").trim().toLowerCase();
  if (s === "active" || s === "connected") return "active";
  if (s === "failed" || s === "expired" || s === "revoked") return "failed";
  return "pending";
}

/**
 * Poll Composio until the pending connected account becomes active, fails, or the
 * timeout elapses, persisting each transition so the Connectors page stays truthful.
 *
 * Polling the provider (rather than the local record) is what makes this reliable: the
 * status can also flip when the user finishes the flow opened from the Connectors page
 * instead of from this tool block. Never throws — a transport failure yields a
 * "still pending" outcome so the agent simply waits out the window.
 */
export async function waitForConnectorConnection(
  manager: ConnectorManager,
  client: ComposioClient | null,
  connectorId: ConnectorId,
  options?: { timeoutMs?: number; signal?: AbortSignal; pollMs?: number },
): Promise<ConnectorConnectOutcome> {
  const timeoutMs = options?.timeoutMs ?? CONNECTOR_CONNECTION_TIMEOUT_MS;
  const pollMs = options?.pollMs ?? CONNECTOR_CONNECTION_POLL_MS;
  const signal = options?.signal;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) return { status: "aborted" };
    const stored = manager.get(connectorId);
    // The record disappeared (disconnected meanwhile) — nothing left to wait for.
    if (!stored) return { status: "failed", connection: null, message: "The connection request was cancelled." };

    if (client) {
      try {
        const account = await client.getConnectedAccount(stored.connectedAccountId);
        const next = storedStatusOf(account.status);
        if (next !== stored.status) manager.markStatus(connectorId, next);
        const fresh = manager.get(connectorId) ?? stored;
        if (next === "active") return { status: "connected", connection: fresh };
        if (next === "failed") {
          return {
            status: "failed",
            connection: fresh,
            message: "The user rejected the authorization or the provider rejected the request.",
          };
        }
      } catch {
        // Transport hiccup — keep waiting; the deadline below bounds the call.
      }
    }

    if (Date.now() >= deadline) return { status: "pending", connection: manager.get(connectorId) };
    const remaining = deadline - Date.now();
    await sleep(Math.min(pollMs, Math.max(250, remaining)), signal);
  }
}

/**
 * Re-poll one stored connection from Composio and persist the result. Used by
 * get_application_connector_status so the model never reports a stale status.
 * Never throws — on any failure the stored status is reported unchanged.
 */
export async function refreshConnectorStatus(
  manager: ConnectorManager,
  client: ComposioClient | null,
  connectorId: ConnectorId,
): Promise<ConnectorConnection | null> {
  const stored = manager.get(connectorId);
  if (!stored || !client) return stored;
  try {
    const account = await client.getConnectedAccount(stored.connectedAccountId);
    const next = storedStatusOf(account.status);
    if (next !== stored.status) manager.markStatus(connectorId, next);
    return manager.get(connectorId) ?? stored;
  } catch {
    return stored;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Map a thrown error onto a stable, model-actionable tool error. */
export function connectorError(code: string, error: unknown): ToolResult {
  return { ok: false, error: { code, message: messageOf(error) } };
}
