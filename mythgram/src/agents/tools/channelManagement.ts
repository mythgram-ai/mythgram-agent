import type { ChannelManager } from "../../channels/manager.js";
import { CHANNEL_KINDS, CHANNEL_LABELS, type ChannelKind } from "../../channels/types.js";
import type { ToolContext, ToolResult } from "./types.js";

/** The five agent-driven communication-channel management tool names (single source of truth). */
export const CHANNEL_MANAGEMENT_TOOL_NAMES: readonly string[] = [
  "request_channel_connection_to_user",
  "list_available_channels",
  "disconnect_channels",
  "get_channel_status",
  "send_message_to_communication_channel",
];

/** True when a tool name is one of the agent-driven channel management tools. */
export function isChannelManagementTool(name: string): boolean {
  return (CHANNEL_MANAGEMENT_TOOL_NAMES as readonly string[]).includes((name ?? "").trim());
}

/** How long request_channel_connection_to_user waits for the user to connect (3 minutes). */
export const CHANNEL_CONNECTION_TIMEOUT_MS = 3 * 60_000;

/** Poll interval while waiting for the user to complete a channel connection. */
const CHANNEL_CONNECTION_POLL_MS = 2_000;

export interface ChannelCatalogEntry {
  channel_name: ChannelKind;
  label: string;
  description: string;
  setup_guide: string;
  addressing: string;
}

const CHANNEL_DESCRIPTIONS: Record<ChannelKind, string> = {
  telegram: "Chat with your agent from Telegram.",
  discord: "Chat with your agent from Discord.",
  slack: "Chat with your agent from Slack.",
};

const CHANNEL_SETUP_GUIDES: Record<ChannelKind, string> = {
  telegram:
    "Create a bot with @BotFather in Telegram, paste the bot token below, then open your bot and start chatting.",
  discord:
    "Create an application + bot in the Discord Developer Portal, enable the MESSAGE CONTENT privileged intent, invite the bot to your server, then paste the bot token below.",
  slack:
    "Create a Slack app + bot, add it to your workspace, then paste the Bot User OAuth Token (xoxb-…). Required scopes: channels:history, groups:history, im:history, mpim:history, channels:read, groups:read, im:read, mpim:read, chat:write, files:write, users:read.",
};

const CHANNEL_ADDRESSING: Record<ChannelKind, string> = {
  telegram: "No mention needed — just chat, or send /@switch, /@ok, /@no, /@new-chat directly.",
  discord:
    "Mention the bot before every command in servers, e.g. “@Bot /@switch researcher”. No mention needed in DMs.",
  slack:
    "Mention the bot before every command in channels, e.g. “@Bot /@ok”. No mention needed in DMs.",
};

/** The static catalog of connectable communication channels (mirrors the Channels page). */
export function channelCatalog(): ChannelCatalogEntry[] {
  return CHANNEL_KINDS.map((kind) => ({
    channel_name: kind,
    label: CHANNEL_LABELS[kind],
    description: CHANNEL_DESCRIPTIONS[kind],
    setup_guide: CHANNEL_SETUP_GUIDES[kind],
    addressing: CHANNEL_ADDRESSING[kind],
  }));
}

/** Normalize a user/LLM-supplied channel name to its canonical kind (case-insensitive). */
export function normalizeChannelName(raw: unknown): ChannelKind | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!value) return null;
  const match = (CHANNEL_KINDS as readonly string[]).find((kind) => kind === value);
  return (match ?? null) as ChannelKind | null;
}

/** Valid channel names for error messages, e.g. "telegram, discord, slack". */
export function validChannelNames(): string {
  return [...CHANNEL_KINDS].join(", ");
}

/** Shared guard: channel management tools need the persisted channel manager. */
export function requireChannelManager(ctx: ToolContext): ToolResult | null {
  if (!ctx.channelManager) {
    return {
      ok: false,
      error: {
        code: "channels_unavailable",
        message:
          "Communication-channel management is not available in this context. It is only available to the main agent, custom agents, and team/CEO agents.",
      },
    };
  }
  return null;
}

/** Browser-safe projection list, newest-first (mirrors manager.list order). */
export function publicChannelList(manager: ChannelManager): ReturnType<ChannelManager["listPublic"]> {
  return manager.listPublic();
}

/**
 * Emit the fresh channel list to the frontend so the Channels page + the next
 * chat turn converge on the backend truth immediately. Best-effort — a failure
 * to emit must never break the tool result.
 */
export function emitChannelsUpdated(ctx: ToolContext, manager: ChannelManager): void {
  try {
    ctx.emit?.("channels_updated", {
      channels: publicChannelList(manager),
      chat_id: ctx.chatId,
      tool_call_id: ctx.toolCallId,
    });
  } catch {
    // best effort
  }
}

/**
 * Emit a channel-connection request so the chat UI renders the inline
 * configuration form inside this tool's block. The frontend shows every
 * required field (connection name + bot token), the step-by-step setup guide,
 * and a Connect button that creates the connection via POST /api/channels.
 * The tool itself keeps polling the stored connections until one of this kind
 * flips to connected, fails, or the timeout elapses.
 */
export function emitChannelConnectionRequest(
  ctx: ToolContext,
  channel: ChannelCatalogEntry,
): void {
  try {
    ctx.emit?.("channel_connection_request", {
      channel_name: channel.channel_name,
      channel_label: channel.label,
      description: channel.description,
      setup_guide: channel.setup_guide,
      addressing: channel.addressing,
      chat_id: ctx.chatId,
      tool_call_id: ctx.toolCallId,
    });
  } catch {
    // best effort
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

/**
 * Block until a connection of `kind` flips to connected, or the timeout
 * elapses. Returns the fresh public connections of this kind (possibly empty)
 * on success, or null on timeout/abort. Never throws — timeouts and aborts
 * resolve to null so the caller can shape a model-facing message.
 */
export async function waitForChannelConnection(
  manager: ChannelManager,
  kind: ChannelKind,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<ReturnType<ChannelManager["listPublic"]> | null> {
  const timeoutMs = options?.timeoutMs ?? CHANNEL_CONNECTION_TIMEOUT_MS;
  const signal = options?.signal;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) return null;
    const connected = manager
      .listPublic()
      .filter((c) => c.kind === kind && c.enabled && c.status === "connected");
    if (connected.length > 0) return connected;
    if (Date.now() >= deadline) return null;
    const remaining = deadline - Date.now();
    await sleep(Math.min(CHANNEL_CONNECTION_POLL_MS, Math.max(250, remaining)), signal);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Delete every stored connection of one channel kind (used by disconnect_channels).
 * Returns the deleted public projections. Never throws — per-connection failures
 * are collected as errors.
 */
export async function deleteConnectionsOfKind(
  manager: ChannelManager,
  kind: ChannelKind,
): Promise<{ deleted: ReturnType<ChannelManager["listPublic"]>; errors: string[] }> {
  const targets = manager.listPublic().filter((c) => c.kind === kind);
  const deleted: ReturnType<ChannelManager["listPublic"]> = [];
  const errors: string[] = [];
  for (const target of targets) {
    try {
      const removed = await manager.deleteChannel(target.id);
      if (removed) deleted.push(target);
      else errors.push(`Could not disconnect "${target.name}".`);
    } catch (error) {
      errors.push(messageOf(error));
    }
  }
  return { deleted, errors };
}
