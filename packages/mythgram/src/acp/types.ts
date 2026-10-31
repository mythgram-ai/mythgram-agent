/**
 * Agent Client Protocol (ACP) shared types + constants.
 *
 * ACP lets editors/clients (Zed, and any other ACP client) drive an agent as a
 * subprocess over newline-delimited JSON-RPC 2.0 on stdio. Mythgram exposes the
 * SAME agent runtimes it uses in the web console through an ACP bridge, so any
 * ACP client can use the default agent, a Custom Agent, an agent team, or a CEO
 * system exactly as configured in the app.
 *
 * This file is intentionally dependency-free (no database/Express imports) so it
 * can be imported by both the backend ACP router and the standalone stdio bridge.
 */

/** Latest ACP major protocol version this agent implements. */
export const ACP_PROTOCOL_VERSION = 1;

/** Programmatic agent name exchanged during `initialize`. */
export const ACP_AGENT_NAME = "mythgram";

/** Human-readable agent title exchanged during `initialize`. */
export const ACP_AGENT_TITLE = "Mythgram";

/** Agent implementation version exchanged during `initialize`. */
export const ACP_AGENT_VERSION = "1.0.0";

/**
 * Which Mythgram runtime an ACP session runs as.
 * - `default` — the built-in Main Agent (honors the active custom system prompt).
 * - `chat`    — the lightweight conversational runtime (memory/knowledge/web only).
 * - `custom`  — a user-created top-level Custom Agent (by id).
 * - `team`    — a user-created multi-agent team (head + members).
 * - `ceo`     — a user-created CEO system coordinating several teams.
 */
export type AcpMode = "default" | "chat" | "custom" | "team" | "ceo";

/** Context-management override selected in the ACP panel. */
export type AcpContextManagement = "inherit" | "summarization" | "sliding_window";

/** Memory-agent override selected in the ACP panel. */
export type AcpMemoryAgent = "inherit" | "on" | "off";

/**
 * Persisted ACP configuration (SQLite app-state document `acp`). The panel is the
 * source of truth; the ACP bridge reads the resolved turn from the backend, so it
 * never needs the provider keys itself. Empty LLM fields inherit the app Settings.
 */
export interface AcpConfig {
  /** Informational on/off switch shown in the panel. */
  enabled: boolean;
  /** Which runtime ACP sessions run as. */
  mode: AcpMode;
  /** Selected Custom Agent id (when `mode === "custom"`). */
  customAgentId: string;
  /** Selected team id (when `mode === "team"`). */
  teamId: string;
  /** Selected CEO agent id (when `mode === "ceo"`). */
  ceoId: string;

  // ---- LLM override (empty = inherit the app Settings) ----
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  /** `null` = inherit Settings temperature. */
  temperature: number | null;
  /** Empty = inherit Settings reasoning effort. */
  effort: string;

  // ---- Context management override ----
  contextManagementMethod: AcpContextManagement;
  /** `null` = inherit Settings. */
  slidingWindowTruncatePercent: number | null;
  /** `null` = inherit Settings/server default. */
  summaryThreshold: number | null;
  /** `null` = resolve from Settings/manual entry/provider catalog. */
  contextLimit: number | null;

  // ---- Memory agent override ----
  memoryAgent: AcpMemoryAgent;
  /** `null` = inherit Settings. */
  memoryAgentInterval: number | null;
}

/** Sensible starting configuration: inherit everything, run the Default Agent. */
export const DEFAULT_ACP_CONFIG: AcpConfig = {
  enabled: true,
  mode: "default",
  customAgentId: "",
  teamId: "",
  ceoId: "",
  provider: "",
  model: "",
  apiKey: "",
  baseUrl: "",
  temperature: null,
  effort: "",
  contextManagementMethod: "inherit",
  slidingWindowTruncatePercent: null,
  summaryThreshold: null,
  contextLimit: null,
  memoryAgent: "inherit",
  memoryAgentInterval: null,
};

/** JSON-RPC 2.0 message id (requests/responses only). */
export type JsonRpcId = number | string | null;

/** A decoded JSON-RPC message (request, response, or notification). */
export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** JSON-RPC standard error: method not found. */
export const JSONRPC_METHOD_NOT_FOUND = -32601;
/** JSON-RPC standard error: invalid params. */
export const JSONRPC_INVALID_PARAMS = -32602;
/** JSON-RPC standard error: internal error. */
export const JSONRPC_INTERNAL_ERROR = -32603;

/** One ACP prompt content block (only the fields the bridge consumes). */
export interface AcpContentBlock {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
  resource?: { uri?: string; mimeType?: string; text?: string; blob?: string };
}

/** Minimal view of a resolved ACP turn returned by `GET /api/acp/turn`. */
export interface AcpTurnDescriptor {
  /** The `/api/chat/stream` request body (snake_case, as the web app sends it). */
  body: Record<string, unknown>;
  /** The resolved runtime mode. */
  mode: AcpMode;
  /** A human-readable label for the active agent (e.g. the team name). */
  label: string;
}
