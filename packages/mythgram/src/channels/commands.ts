import type { ChannelCommand } from "./types.js";

/**
 * Channel command parsing.
 *
 * Commands (shared by every channel):
 *   /@switch <custom agent name>   switch the serving agent (or /@switch default)
 *   /@ok                           approve a pending submit_plan review
 *   /@no                           reject a pending submit_plan review
 *   /@new-chat                      start a fresh chat session
 *
 * Mention rules differ per channel:
 *   - Telegram: no mention needed — the user chats with the bot directly.
 *   - Discord / Slack: every command MUST be prefixed with an @mention of the bot,
 *     e.g. "@HelperBot /@switch researcher" (raw "<@123>" mentions are accepted too).
 *     The mention is stripped before command matching.
 */

export interface MentionInfo {
  /** Raw bot user id for `<@id>` / `<@!id>` mention matching (empty when unknown). */
  botId: string;
  /** Bot display name for `@Name` mention matching (empty when unknown). */
  botName: string;
}

interface MentionStrip {
  /** The message with the leading mention removed (trimmed). */
  stripped: string;
  /** True when a mention was present and removed. */
  mentioned: boolean;
}

/**
 * Remove one leading @mention of the bot (`<@id>`, `<@!id>`, or `@Name`,
 * case-insensitive) from the text. Returns the stripped text plus whether a
 * mention was found.
 */
export function stripMention(text: string, mention: MentionInfo): MentionStrip {
  const trimmed = text.trim();
  const id = mention.botId.trim();
  if (id) {
    // Raw Discord/Slack style mentions: <@123> or <@!123> (nickname mention).
    const raw = new RegExp(`^<@!?${escapeRegExp(id)}>\\s*`);
    if (raw.test(trimmed)) {
      return { stripped: trimmed.replace(raw, "").trim(), mentioned: true };
    }
  }
  const name = mention.botName.trim();
  if (name) {
    // Human "@Name" mention (case-insensitive, trailing punctuation tolerated).
    const named = new RegExp(`^@${escapeRegExp(name)}[\\s:,.!?]*`, "i");
    if (named.test(trimmed)) {
      return { stripped: trimmed.replace(named, "").trim(), mentioned: true };
    }
  }
  return { stripped: trimmed, mentioned: false };
}

/**
 * Parse an inbound channel message into a command or a plain message.
 *
 * When `mentionRequired` is true (Discord / Slack) and no @mention of the bot is
 * present, the message is NOT for the bot — returns null so the caller ignores it.
 * Commands must start with `/@` after the (optional) mention is stripped.
 */
export function parseChannelCommand(
  rawText: string,
  options: { mentionRequired: boolean; mention: MentionInfo },
): ChannelCommand | null {
  const { stripped, mentioned } = stripMention(rawText, options.mention);
  if (options.mentionRequired && !mentioned) return null;

  const text = stripped;
  if (!text.startsWith("/@")) return { type: "message", text };

  const [head, ...rest] = text.slice(2).trim().split(/\s+/);
  const word = (head ?? "").trim().toLowerCase();
  const arg = rest.join(" ").trim();

  switch (word) {
    case "switch":
      return { type: "switch", name: arg };
    case "ok":
      return { type: "ok" };
    case "no":
      return { type: "no" };
    case "new-chat":
    case "newchat":
    case "new_chat":
      return { type: "new-chat" };
    default:
      // Unknown /@command — treat as a plain message so the agent can respond
      // helpfully instead of dropping it silently.
      return { type: "message", text };
  }
}

/**
 * The example prefix a user must type before commands on mention-gated channels
 * ("" on Telegram). Used in help texts and plan-approval instructions.
 */
export function commandPrefix(kind: string, botName: string): string {
  if (kind === "telegram") return "";
  const name = botName.trim() || "Bot";
  return `@${name} `;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
