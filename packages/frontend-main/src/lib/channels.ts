import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";
import type {
  ChannelChat,
  ChannelChatMessage,
  ChannelConnection,
  ChannelKind,
} from "@/types";

/**
 * Channels client — messaging-channel adapters (Telegram / Discord / Slack).
 *
 * Tokens are write-only: the browser sends them on create/update, the backend
 * stores them in SQLite and only ever serves the public projection (status, bot
 * identity, agent selection, chat counts). Chat transcripts come from the
 * backend's channel tables; nothing channel-related lives in browser storage.
 */

/** Static metadata per live channel kind (mirrors the backend catalog). */
export interface ChannelMeta {
  id: ChannelKind;
  name: string;
  description: string;
  /** Short setup instructions shown on the create form. */
  setup: string;
  /** Hint about how commands must be addressed on this channel. */
  addressing: string;
}

export const AVAILABLE_CHANNELS: readonly ChannelMeta[] = [
  {
    id: "telegram",
    name: "Telegram",
    description: "Chat with your agent from Telegram.",
    setup:
      "Create a bot with @BotFather in Telegram, paste the bot token below, then open your bot and start chatting.",
    addressing: "No mention needed — just chat, or send /@switch, /@ok, /@no, /@new-chat directly.",
  },
  {
    id: "discord",
    name: "Discord",
    description: "Chat with your agent from Discord.",
    setup:
      "Create an application + bot in the Discord Developer Portal, enable the MESSAGE CONTENT privileged intent, invite the bot to your server, then paste the bot token below.",
    addressing: "Mention the bot before every command in servers, e.g. “@Bot /@switch researcher”. No mention needed in DMs.",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Chat with your agent from Slack.",
    setup:
      "Create a Slack app + bot, add it to your workspace, then paste the Bot User OAuth Token (xoxb-…). Required scopes: channels:history, groups:history, im:history, mpim:history, channels:read, groups:read, im:read, mpim:read, chat:write, files:write, users:read.",
    addressing: "Mention the bot before every command in channels, e.g. “@Bot /@ok”. No mention needed in DMs.",
  },
];

/** Placeholder descriptor for WhatsApp (coming soon — Telegram is the alternative). */
export const WHATSAPP_PLACEHOLDER = {
  id: "whatsapp",
  name: "WhatsApp",
  description: "Chat with your agent straight from WhatsApp.",
  headline: "Coming soon",
  alternative: "Use Telegram instead — it works today with the same agent.",
  alternativeLabel: "Use Telegram instead",
} as const;

export function channelMeta(kind: ChannelKind): ChannelMeta {
  return AVAILABLE_CHANNELS.find((c) => c.id === kind) ?? AVAILABLE_CHANNELS[0]!;
}

/** Defensive normalize of one served connection. */
export function normalizeChannel(raw: unknown): ChannelConnection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  const kind = typeof r.kind === "string" ? r.kind : "";
  if (!id || (kind !== "telegram" && kind !== "discord" && kind !== "slack")) return null;
  const status =
    r.status === "connected" || r.status === "connecting" || r.status === "error"
      ? r.status
      : "disabled";
  return {
    id,
    kind,
    name: typeof r.name === "string" && r.name ? r.name : kind,
    enabled: r.enabled !== false,
    status,
    ...(typeof r.lastError === "string" && r.lastError ? { lastError: r.lastError } : {}),
    botName: typeof r.botName === "string" ? r.botName : "",
    botId: typeof r.botId === "string" ? r.botId : "",
    activeAgentId: typeof r.activeAgentId === "string" && r.activeAgentId ? r.activeAgentId : null,
    chatCount: typeof r.chatCount === "number" ? r.chatCount : 0,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

export async function fetchChannels(signal?: AbortSignal): Promise<ChannelConnection[]> {
  const data = await requestJson<{ channels?: unknown[] }>(
    routeUrl(API_ROUTES.channelsList),
    undefined,
    signal,
  );
  return (Array.isArray(data.channels) ? data.channels : [])
    .map(normalizeChannel)
    .filter((c): c is ChannelConnection => c !== null);
}

export interface ChannelInput {
  kind: ChannelKind;
  name?: string;
  token: string;
}

export async function createChannel(input: ChannelInput): Promise<ChannelConnection> {
  const data = await requestJson<{ channel?: unknown }>(routeUrl(API_ROUTES.channelsCreate), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const channel = normalizeChannel(data.channel);
  if (!channel) throw new Error("The backend did not return the created channel.");
  return channel;
}

export async function updateChannel(
  id: string,
  patch: { name?: string; token?: string; enabled?: boolean },
): Promise<ChannelConnection> {
  const data = await requestJson<{ channel?: unknown }>(
    routeUrl(API_ROUTES.channelsUpdate, { params: { id } }),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  const channel = normalizeChannel(data.channel);
  if (!channel) throw new Error("The backend did not return the updated channel.");
  return channel;
}

export async function deleteChannel(id: string): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.channelsDelete, { params: { id } }), {
    method: "DELETE",
  }).catch(() => {});
}

/** Set the agent serving new chats on a channel ("main" = Default Agent). */
export async function setChannelAgent(id: string, agentId: string | null): Promise<ChannelConnection> {
  const data = await requestJson<{ channel?: unknown }>(
    routeUrl(API_ROUTES.channelsSetAgent, { params: { id } }),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    },
  );
  const channel = normalizeChannel(data.channel);
  if (!channel) throw new Error("The backend did not return the updated channel.");
  return channel;
}

function normalizeChat(raw: unknown): ChannelChat | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.chat_id !== "string" || !r.chat_id) return null;
  return {
    chat_id: r.chat_id,
    user_key: typeof r.user_key === "string" ? r.user_key : "",
    user_label: typeof r.user_label === "string" ? r.user_label : "",
    agent_id: typeof r.agent_id === "string" && r.agent_id ? r.agent_id : null,
    agent_name: typeof r.agent_name === "string" ? r.agent_name : "Default Agent",
    title: typeof r.title === "string" ? r.title : "",
    created_at: typeof r.created_at === "number" ? r.created_at : 0,
    updated_at: typeof r.updated_at === "number" ? r.updated_at : 0,
  };
}

export async function fetchChannelChats(id: string, signal?: AbortSignal): Promise<ChannelChat[]> {
  const data = await requestJson<{ chats?: unknown[] }>(
    routeUrl(API_ROUTES.channelsChats, { params: { id } }),
    undefined,
    signal,
  );
  return (Array.isArray(data.chats) ? data.chats : [])
    .map(normalizeChat)
    .filter((c): c is ChannelChat => c !== null);
}

function normalizeChatMessage(raw: unknown): ChannelChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.role !== "string") return null;
  return {
    seq: typeof r.seq === "number" ? r.seq : 0,
    role: r.role,
    text: typeof r.text === "string" ? r.text : "",
    has_tools: r.has_tools === true,
  };
}

export async function fetchChannelChatMessages(
  id: string,
  chatId: string,
  signal?: AbortSignal,
): Promise<ChannelChatMessage[]> {
  const data = await requestJson<{ messages?: unknown[] }>(
    routeUrl(API_ROUTES.channelsChatMessages, { params: { id, chatId } }),
    undefined,
    signal,
  );
  return (Array.isArray(data.messages) ? data.messages : [])
    .map(normalizeChatMessage)
    .filter((m): m is ChannelChatMessage => m !== null);
}

/** Switch the agent serving one existing chat ("main" = Default Agent). */
export async function setChannelChatAgent(
  id: string,
  chatId: string,
  agentId: string | null,
): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.channelsChatAgent, { params: { id, chatId } }), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId }),
  });
}

/** Start a fresh chat for an external user (dashboard "new chat"). */
export async function startChannelChat(id: string, userKey: string): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.channelsNewChat, { params: { id, userKey } }), {
    method: "POST",
  });
}
