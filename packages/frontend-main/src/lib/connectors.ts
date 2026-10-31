import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";
import type {
  ConnectorConnection,
  ConnectorOverviewItem,
  ConnectorStatus,
  ConnectorToolMeta,
} from "@/types";

/**
 * Connectors client — third-party app integrations (GitHub, Slack, Notion, Gmail,
 * Outlook) powered by Composio.
 *
 * Auth never touches tokens in the browser: the backend returns an OAuth `redirect_url`
 * (opened in a new tab), the user authorizes the app there, and this client polls the
 * backend until the connection becomes `active`. Only the connected-account id + status
 * are persisted (backend SQLite `connectors` document, synced like every other slice).
 */

/** Static connector metadata (mirrors the backend catalog order). */
export interface ConnectorMeta {
  id: string;
  name: string;
  description: string;
  homepage: string;
  /** Simple-Icons slug used as the logo fallback. */
  logoSlug: string;
}

export const AVAILABLE_CONNECTORS: readonly ConnectorMeta[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repositories, issues, pull requests, actions, and code search.",
    homepage: "https://github.com",
    logoSlug: "github",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Channels, messages, threads, and workspace search.",
    homepage: "https://slack.com",
    logoSlug: "slack",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Pages, databases, blocks, and workspace search.",
    homepage: "https://notion.so",
    logoSlug: "notion",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Send, read, search, label, and manage email.",
    homepage: "https://mail.google.com",
    logoSlug: "gmail",
  },
  {
    id: "outlook",
    name: "Outlook",
    description: "Mail, calendar, and contacts via Microsoft 365.",
    homepage: "https://outlook.live.com",
    logoSlug: "microsoftoutlook",
  },
];

/**
 * Resolve the best logo URL for a connector card: the official toolkit logo from
 * Composio when the backend provides one, else the official Simple-Icons mark.
 */
export function connectorLogo(meta: ConnectorMeta, logoUrl?: string | null): string {
  if (logoUrl && /^https?:\/\//i.test(logoUrl.trim())) return logoUrl.trim();
  return `https://cdn.simpleicons.org/${meta.logoSlug}`;
}

function statusOf(value: unknown): ConnectorStatus {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === "active") return "active";
  if (s === "failed") return "failed";
  if (s === "pending") return "pending";
  return "disconnected";
}

/** Defensive normalize of one stored/loaded connection. */
export function normalizeConnector(raw: unknown): ConnectorConnection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const connectorId = typeof r.connectorId === "string" ? r.connectorId.trim().toLowerCase() : "";
  if (!AVAILABLE_CONNECTORS.some((c) => c.id === connectorId)) return null;
  const connectedAccountId =
    typeof r.connectedAccountId === "string" ? r.connectedAccountId.trim() : "";
  if (!connectedAccountId) return null;
  return {
    connectorId,
    connectedAccountId,
    status: statusOf(r.status),
    accountLabel: typeof r.accountLabel === "string" ? r.accountLabel : "",
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

/** Normalize a persisted array of connections (drops malformed/duplicate entries). */
export function normalizeConnectors(raw: unknown): ConnectorConnection[] {
  if (!Array.isArray(raw)) return [];
  const out: ConnectorConnection[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const connection = normalizeConnector(item);
    if (!connection || seen.has(connection.connectorId)) continue;
    seen.add(connection.connectorId);
    out.push(connection);
  }
  return out;
}

export interface ConnectorsOverview {
  configured: boolean;
  connectors: ConnectorOverviewItem[];
}

/** Catalog + live connection status from the backend. */
export async function fetchConnectorsOverview(signal?: AbortSignal): Promise<ConnectorsOverview> {
  const data = await requestJson<{
    configured?: boolean;
    connectors?: ConnectorOverviewItem[];
  }>(routeUrl(API_ROUTES.connectorsOverview), undefined, signal);
  return {
    configured: data.configured === true,
    connectors: Array.isArray(data.connectors) ? data.connectors : [],
  };
}

export interface ConnectStart {
  redirect_url: string;
  connected_account_id: string;
  status: ConnectorStatus;
}

/** Start connecting a connector — returns the OAuth URL to open in a new tab. */
export async function startConnectorConnect(connectorId: string): Promise<ConnectStart> {
  const data = await requestJson<ConnectStart>(routeUrl(API_ROUTES.connectorsConnect), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connector_id: connectorId }),
  });
  if (!data.redirect_url) throw new Error("The backend did not return an authentication URL.");
  return data;
}

/** Poll one connected account until it leaves `pending` (or attempts run out). */
export async function pollConnectorActive(
  connectedAccountId: string,
  attempts = 60,
  intervalMs = 2500,
): Promise<ConnectorStatus> {
  for (let i = 0; i < attempts; i += 1) {
    const data = await requestJson<{ status?: string }>(
      routeUrl(API_ROUTES.connectorsStatus, { params: { connectedAccountId } }),
    ).catch(() => null);
    const status = statusOf(data?.status);
    if (status === "active" || status === "failed") return status;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return "pending";
}

/** Re-poll every stored connection (heals stale states on page open). */
export async function refreshConnectors(): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.connectorsRefresh), { method: "POST" }).catch(() => {});
}

/** Disconnect a connector (remote best-effort + local removal). */
export async function disconnectConnector(connectorId: string): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.connectorsDisconnect, { params: { connectorId } }), {
    method: "DELETE",
  }).catch(() => {});
}

/** Every tool of every ACTIVE connector (uncapped catalog for the agent editors). */
export async function fetchConnectorTools(signal?: AbortSignal): Promise<ConnectorToolMeta[]> {
  const data = await requestJson<{ tools?: ConnectorToolMeta[] }>(
    routeUrl(API_ROUTES.connectorsTools),
    undefined,
    signal,
  );
  const tools = Array.isArray(data.tools) ? data.tools : [];
  return tools.filter((t) => t && typeof t.name === "string" && t.name.length > 0);
}

/** Validate a Composio API key. Returns false instead of throwing. */
export async function validateComposioKey(composioApiKey?: string): Promise<boolean> {
  try {
    const data = await requestJson<{ ok?: boolean }>(routeUrl(API_ROUTES.connectorsValidate), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(composioApiKey ? { composio_api_key: composioApiKey } : {}),
    });
    return data.ok === true;
  } catch {
    return false;
  }
}
