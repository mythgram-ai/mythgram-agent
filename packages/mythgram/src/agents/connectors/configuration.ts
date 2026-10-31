/**
 * Connectors — configuration shapes for third-party app integrations (GitHub, Slack, ...).
 *
 * A "connector" is a user-facing integration with an external application, powered by
 * Composio (https://composio.dev). Each connector maps to exactly one Composio toolkit
 * (identified by its lowercase `toolkitSlug`, e.g. `github`). Once the user authenticates a
 * connector (OAuth via Composio), EVERY tool Composio exposes for that toolkit becomes a
 * native function tool for the agent — there is intentionally no allowlist, no per-connector
 * tool subset, and no cap on the number of tools.
 *
 * This file owns the static catalog + the defensive normalization. Adding a future connector
 * is a single entry in AVAILABLE_CONNECTORS (plus its logo slug) — everything else
 * (auth, tool discovery, execution, UI sync) is connector-agnostic and keys off this list.
 */

/** Stable connector ids — also the keys used in persisted state and on the wire. */
export const CONNECTOR_IDS = ["github", "slack", "notion", "gmail", "outlook"] as const;

export type ConnectorId = (typeof CONNECTOR_IDS)[number];

/** A single available third-party app integration. */
export interface ConnectorDefinition {
  /** Stable id (matches the persisted connection record). */
  id: ConnectorId;
  /** Human-readable app name shown on the connector card. */
  name: string;
  /** One-line description shown on the connector card. */
  description: string;
  /** Composio toolkit slug used for auth-config discovery, tool listing, and execution. */
  toolkitSlug: string;
  /** Simple-Icons slug used as the logo fallback (https://cdn.simpleicons.org/<slug>). */
  logoSlug: string;
  /** Link to the app's homepage (shown on the connector card). */
  homepage: string;
}

/**
 * The full catalog of connectors the app supports. Order here is the order the
 * frontend renders the connector cards. To add a new connector in the future,
 * append one entry — no other code changes are required.
 */
export const AVAILABLE_CONNECTORS: readonly ConnectorDefinition[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repositories, issues, pull requests, actions, and code search.",
    toolkitSlug: "github",
    logoSlug: "github",
    homepage: "https://github.com",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Channels, messages, threads, and workspace search.",
    toolkitSlug: "slack",
    logoSlug: "slack",
    homepage: "https://slack.com",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Pages, databases, blocks, and workspace search.",
    toolkitSlug: "notion",
    logoSlug: "notion",
    homepage: "https://notion.so",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Send, read, search, label, and manage email.",
    toolkitSlug: "gmail",
    logoSlug: "gmail",
    homepage: "https://mail.google.com",
  },
  {
    id: "outlook",
    name: "Outlook",
    description: "Mail, calendar, and contacts via Microsoft 365.",
    toolkitSlug: "outlook",
    logoSlug: "microsoftoutlook",
    homepage: "https://outlook.live.com",
  },
];

const CONNECTOR_BY_ID = new Map<string, ConnectorDefinition>(
  AVAILABLE_CONNECTORS.map((c) => [c.id, c]),
);

const CONNECTOR_BY_TOOLKIT = new Map<string, ConnectorDefinition>(
  AVAILABLE_CONNECTORS.map((c) => [c.toolkitSlug.toLowerCase(), c]),
);

/** Look up a connector definition by its stable id (case-insensitive). */
export function getConnector(id: string): ConnectorDefinition | undefined {
  return CONNECTOR_BY_ID.get(id.trim().toLowerCase());
}

/** Look up a connector definition by its Composio toolkit slug (case-insensitive). */
export function getConnectorByToolkit(toolkitSlug: string): ConnectorDefinition | undefined {
  return CONNECTOR_BY_TOOLKIT.get(toolkitSlug.trim().toLowerCase());
}

/** Base URL of the Composio REST API (v3.1 is current; it defaults tool versions to latest). */
export const COMPOSIO_API_BASE =
  (typeof process !== "undefined" && process.env.COMPOSIO_API_BASE?.trim()) ||
  "https://backend.composio.dev/api/v3.1";

/**
 * The Composio `user_id` every connection and execution is scoped to. A single stable
 * local user keeps the model simple (one set of connected apps per workspace); it can
 * be made per-user later without changing the connector surface.
 */
export const COMPOSIO_DEFAULT_USER_ID = "default";

/** Lifecycle status of one connector connection. */
export type ConnectorStatus = "pending" | "active" | "failed";

/**
 * One connector connection, persisted in the SQLite `app_state` document keyed
 * `connectors` (the same document the frontend syncs to).
 */
export interface ConnectorConnection {
  connectorId: ConnectorId;
  /** Composio connected-account id this connection authenticates with. */
  connectedAccountId: string;
  status: ConnectorStatus;
  /** Human label for the connected account (login, email, workspace), when known. */
  accountLabel: string;
  createdAt: number;
  updatedAt: number;
}

/** Untrusted over-the-wire / stored shape of a connection. Accepts both spellings. */
export interface ConnectorConnectionWire {
  connectorId?: unknown;
  connector_id?: unknown;
  connectedAccountId?: unknown;
  connected_account_id?: unknown;
  status?: unknown;
  accountLabel?: unknown;
  account_label?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function statusOf(value: unknown): ConnectorStatus {
  const s = str(value).trim().toLowerCase();
  if (s === "active") return "active";
  if (s === "failed" || s === "expired" || s === "revoked") return "failed";
  return "pending";
}

/**
 * Defensively normalize an untrusted connection payload (wire or stored) into a
 * well-formed ConnectorConnection, or `null` when it is unusable (unknown connector
 * or missing connected-account id).
 */
export function normalizeConnectorConnection(
  raw: unknown,
  defaults?: { now?: number },
): ConnectorConnection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as ConnectorConnectionWire;
  const connector = getConnector(str(r.connectorId) || str(r.connector_id));
  if (!connector) return null;
  const connectedAccountId = (str(r.connectedAccountId) || str(r.connected_account_id)).trim();
  if (!connectedAccountId) return null;
  const now = defaults?.now ?? Date.now();
  return {
    connectorId: connector.id,
    connectedAccountId,
    status: statusOf(r.status),
    accountLabel: (str(r.accountLabel) || str(r.account_label)).trim(),
    createdAt: num(r.createdAt ?? r.created_at, now),
    updatedAt: num(r.updatedAt ?? r.updated_at, now),
  };
}

/**
 * A connector reference as sent with each chat turn (mirrors how sub-agents/skills
 * travel): the connector id plus the Composio connected-account id to execute with.
 */
export interface ConnectorWire {
  connectorId: ConnectorId;
  connectedAccountId: string;
}

/** Defensively coerce a client-provided connector reference into a usable value. */
export function normalizeConnectorWire(raw: unknown): ConnectorWire | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as ConnectorConnectionWire;
  const connector = getConnector(str(r.connectorId) || str(r.connector_id));
  if (!connector) return null;
  const connectedAccountId = (str(r.connectedAccountId) || str(r.connected_account_id)).trim();
  if (!connectedAccountId) return null;
  return { connectorId: connector.id, connectedAccountId };
}

/**
 * True when a tool name looks like a Composio connector tool. Composio tool slugs are
 * SCREAMING_SNAKE_CASE (`GITHUB_CREATE_ISSUE`); no built-in registry tool uses that
 * shape (all are lowercase), so the pattern reliably identifies connector tools without
 * a registry lookup. Used to preserve connector tool selections (Custom Agents) and to
 * route execution without fetching the catalog first.
 */
export function isConnectorToolName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,}$/.test((name ?? "").trim());
}
