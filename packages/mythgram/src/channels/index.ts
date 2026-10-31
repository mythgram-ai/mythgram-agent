/**
 * Messaging channel adapters (Telegram / Discord / Slack + the WhatsApp placeholder).
 *
 * Lets the user chat with the SAME agent runtime (built-in Main Agent or a
 * user-created Custom Agent) from a messaging app instead of the web UI.
 */
export {
  CHANNEL_KINDS,
  CHANNEL_LABELS,
  isChannelKind,
  normalizeChannelConnection,
  toPublicChannel,
  type ChannelCommand,
  type ChannelConnection,
  type ChannelConnectionPublic,
  type ChannelConnectionWire,
  type ChannelIncoming,
  type ChannelKind,
  type ChannelSender,
  type ChannelStatus,
  type ChannelTarget,
  type ChannelAttachment,
} from "./types.js";
export {
  parseChannelCommand,
  stripMention,
  commandPrefix,
  type MentionInfo,
} from "./commands.js";
export { ChannelStore } from "./store.js";
export { resolveChannelRunContext, type ChannelRunContext } from "./context.js";
export {
  ChannelTurnRunner,
  CHANNEL_PLAN_TIMEOUT_MS,
  CHANNEL_TURN_TIMEOUT_MS,
  CHANNEL_SUMMARY_NUDGE,
} from "./runner.js";
export { ChannelManager, type ChannelManagerDeps } from "./manager.js";
export { WHATSAPP_PLACEHOLDER } from "./providers/whatsapp.js";
export { verifyTelegramToken, TelegramProvider } from "./providers/telegram.js";
export { verifyDiscordToken, DiscordProvider } from "./providers/discord.js";
export { verifySlackToken, SlackProvider } from "./providers/slack.js";
