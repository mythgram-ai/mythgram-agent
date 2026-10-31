/**
 * Messaging channel adapters (Telegram / Discord / Slack + the WhatsApp placeholder).
 *
 * A channel lets the user chat with the SAME agent runtime (built-in Main Agent or a
 * user-created Custom Agent) from a messaging app instead of the web UI. Every turn
 * reuses the existing AgentRunner / CustomAgentRunner — no separate agent exists for
 * channels. The runtime detects the channel automatically and advertises the
 * channel-only tools (send_responses) plus the channel rules to the model.
 *
 *   types      — channel/connection/chat shapes + defensive normalization
 *   commands   — /@switch / /@ok / /@no / /@new-chat parsing (with @mention rules)
 *   store      — persistent connections over the SQLite app_state repository
 *   context    — provider credentials + shared tooling resolved from app-state
 *   runner     — one turn per incoming message through the existing agent runtime
 *   manager    — connection lifecycle: start/stop providers, route inbound traffic
 *   providers/ — per-channel transports (long-polling / gateway / Web API polling)
 */

/** Live messaging channels. WhatsApp is a placeholder (see providers/whatsapp.ts). */
export const CHANNEL_KINDS = ["telegram", "discord", "slack"] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** Human label per channel kind. */
export const CHANNEL_LABELS: Record<ChannelKind, string> = {
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
};

/** True when the value names a live (non-placeholder) messaging channel. */
export function isChannelKind(value: unknown): value is ChannelKind {
  return (
    typeof value === "string" &&
    (CHANNEL_KINDS as readonly string[]).includes(value.trim().toLowerCase())
  );
}

/** Lifecycle status of one channel connection. */
export type ChannelStatus = "connected" | "connecting" | "error" | "disabled";

/**
 * One messaging-channel connection, persisted in the SQLite `app_state` document keyed
 * `channels` (the same document pattern connectors/MCP use). The token is stored
 * server-side and never served to the browser (like API keys in settings).
 */
export interface ChannelConnection {
  /** Stable unique id (`ch_` + 12 alphanumeric chars). */
  id: string;
  kind: ChannelKind;
  /** Human-readable connection name shown on the dashboard. */
  name: string;
  /** Bot token (Telegram/Discord) or bot OAuth token (Slack). Server-side only. */
  token: string;
  enabled: boolean;
  status: ChannelStatus;
  /** Last connection/runtime error, when status is error. */
  lastError?: string;
  /** Bot display name resolved at connect time (used for @mention prefixes). */
  botName: string;
  /** Bot user id resolved at connect time (used for <@id> mention matching). */
  botId: string;
  /**
   * The agent serving new chats on this channel: a Custom Agent id, or null for the
   * built-in Default Agent. When a channel is created while a Custom Agent is active
   * in the app, that agent is selected initially.
   */
  activeAgentId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Browser-safe projection of a connection (the token is never included). */
export interface ChannelConnectionPublic {
  id: string;
  kind: ChannelKind;
  name: string;
  enabled: boolean;
  status: ChannelStatus;
  lastError?: string;
  botName: string;
  botId: string;
  activeAgentId: string | null;
  /** Number of user chats on this channel. */
  chatCount: number;
  createdAt: number;
  updatedAt: number;
}

/** Untrusted over-the-wire / stored shape of a connection. Accepts both spellings. */
export interface ChannelConnectionWire {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  token?: unknown;
  bot_token?: unknown;
  enabled?: unknown;
  status?: unknown;
  last_error?: unknown;
  lastError?: unknown;
  bot_name?: unknown;
  botName?: unknown;
  bot_id?: unknown;
  botId?: unknown;
  active_agent_id?: unknown;
  activeAgentId?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "yes" || value === "on" || value === 1) return true;
  if (value === false || value === "no" || value === "off" || value === 0) return false;
  return fallback;
}

function statusOf(value: unknown): ChannelStatus {
  const s = str(value).trim().toLowerCase();
  if (s === "connected" || s === "active") return "connected";
  if (s === "connecting" || s === "pending") return "connecting";
  if (s === "error" || s === "failed") return "error";
  return "disabled";
}

/**
 * Defensively normalize an untrusted connection payload (wire or stored) into a
 * well-formed ChannelConnection, or `null` when it is unusable (unknown kind).
 */
export function normalizeChannelConnection(
  raw: unknown,
  defaults: { id: string; now: number },
): ChannelConnection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as ChannelConnectionWire;
  const kindRaw = str(r.kind).trim().toLowerCase();
  if (!isChannelKind(kindRaw)) return null;
  const name = str(r.name).trim().slice(0, 70) || CHANNEL_LABELS[kindRaw];
  return {
    id: str(r.id).trim() || defaults.id,
    kind: kindRaw,
    name,
    token: str(r.token ?? r.bot_token).trim(),
    enabled: bool(r.enabled, true),
    status: statusOf(r.status),
    lastError: str(r.last_error ?? r.lastError).trim() || undefined,
    botName: str(r.bot_name ?? r.botName).trim(),
    botId: str(r.bot_id ?? r.botId).trim(),
    activeAgentId: str(r.active_agent_id ?? r.activeAgentId).trim() || null,
    createdAt: num(r.created_at ?? r.createdAt, defaults.now),
    updatedAt: num(r.updated_at ?? r.updatedAt, defaults.now),
  };
}

/** Strip the token before serving a connection to the browser. */
export function toPublicChannel(
  connection: ChannelConnection,
  chatCount: number,
): ChannelConnectionPublic {
  return {
    id: connection.id,
    kind: connection.kind,
    name: connection.name,
    enabled: connection.enabled,
    status: connection.status,
    ...(connection.lastError ? { lastError: connection.lastError } : {}),
    botName: connection.botName,
    botId: connection.botId,
    activeAgentId: connection.activeAgentId,
    chatCount,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

/** One inbound message from a channel, normalized by the provider. */
export interface ChannelIncoming {
  /** Stable external user key (e.g. "tg:123", "dc:456", "sl:T1:U2"). */
  userKey: string;
  /** Human-readable user label. */
  userLabel: string;
  /** Opaque provider reply target (chat / channel / thread). */
  target: ChannelTarget;
  /** Text body (may be empty when only attachments were sent). */
  text: string;
  /** Files downloaded into the workspace uploads folder. */
  attachments: ChannelAttachment[];
  /**
   * True when commands in this message require an @mention of the bot
   * (Discord server messages, Slack channel messages). False for Telegram and
   * for direct (DM) conversations.
   */
  needsMention: boolean;
}

/** Opaque reply target — interpreted only by the provider that created it. */
export interface ChannelTarget {
  kind: ChannelKind;
  /** Telegram chat id / Discord channel id / Slack channel id. */
  chatId: string;
  /** Slack thread timestamp for threaded replies (undefined otherwise). */
  threadId?: string;
}

/** A file downloaded from a channel into the workspace uploads folder. */
export interface ChannelAttachment {
  filename: string;
  absolutePath: string;
  size: number;
  contentType: string;
}

/** Outbound transport implemented by each channel provider. */
export interface ChannelSender {
  sendMessage(target: ChannelTarget, text: string): Promise<void>;
  sendFile(
    target: ChannelTarget,
    file: { absolutePath: string; filename: string; contentType: string },
  ): Promise<void>;
}

/** A parsed user command or a plain chat message. */
export type ChannelCommand =
  | { type: "message"; text: string }
  | { type: "switch"; name: string }
  | { type: "ok" }
  | { type: "no" }
  | { type: "new-chat" };
