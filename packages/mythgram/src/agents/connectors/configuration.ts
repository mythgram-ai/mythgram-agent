/**
 * Connectors — configuration shapes for third-party app integrations, powered by Composio
 * (https://composio.dev).
 *
 * There is intentionally NO static/pre-added catalog here. The connectable apps are fetched
 * LIVE from Composio: the backend lists the project's toolkits and keeps only the OAuth-capable
 * ones (see `ComposioClient.listToolkits`). A "connector" therefore maps 1:1 to a Composio toolkit
 * identified by its lowercase `toolkitSlug` (e.g. `github`). Once the user authenticates a
 * connector (OAuth via Composio), EVERY tool Composio exposes for that toolkit becomes a native
 * function tool for the agent — there is no allowlist, no per-connector tool subset, and no cap.
 *
 * This file owns the connection shapes + the defensive normalization; the live catalog lives in
 * the Composio client and the API layer.
 */

/**
 * A connector id is now just a Composio toolkit slug (e.g. `github`, `google_calendar`). Kept as
 * an alias so the rest of the connector surface does not depend on a hardcoded union.
 */
export type ConnectorId = string;

/** Toolkit-slug shape: letters, digits, `_` and `-`, 1–64 chars. */
const TOOLKIT_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** True when a string looks like a valid Composio toolkit slug. */
export function isToolkitSlug(value: string): boolean {
  return TOOLKIT_SLUG_RE.test((value ?? "").trim());
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
 * well-formed ConnectorConnection, or `null` when it is unusable (missing/invalid
 * toolkit slug or missing connected-account id).
 */
export function normalizeConnectorConnection(
  raw: unknown,
  defaults?: { now?: number },
): ConnectorConnection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as ConnectorConnectionWire;
  const connectorId = (str(r.connectorId) || str(r.connector_id)).trim().toLowerCase();
  if (!isToolkitSlug(connectorId)) return null;
  const connectedAccountId = (str(r.connectedAccountId) || str(r.connected_account_id)).trim();
  if (!connectedAccountId) return null;
  const now = defaults?.now ?? Date.now();
  return {
    connectorId,
    connectedAccountId,
    status: statusOf(r.status),
    accountLabel: (str(r.accountLabel) || str(r.account_label)).trim(),
    createdAt: num(r.createdAt ?? r.created_at, now),
    updatedAt: num(r.updatedAt ?? r.updated_at, now),
  };
}

/**
 * A connector reference as sent with each chat turn (mirrors how sub-agents/skills
 * travel): the toolkit slug plus the Composio connected-account id to execute with.
 */
export interface ConnectorWire {
  connectorId: ConnectorId;
  connectedAccountId: string;
}

/** Defensively coerce a client-provided connector reference into a usable value. */
export function normalizeConnectorWire(raw: unknown): ConnectorWire | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as ConnectorConnectionWire;
  const connectorId = (str(r.connectorId) || str(r.connector_id)).trim().toLowerCase();
  if (!isToolkitSlug(connectorId)) return null;
  const connectedAccountId = (str(r.connectedAccountId) || str(r.connected_account_id)).trim();
  if (!connectedAccountId) return null;
  return { connectorId, connectedAccountId };
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
