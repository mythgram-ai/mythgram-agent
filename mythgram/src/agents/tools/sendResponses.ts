import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z
  .object({
    message: z
      .string()
      .min(1, "A message is required.")
      .describe("The message to send to the user."),
  })
  .strict();

type SendResponsesArgs = z.infer<typeof schema>;

/**
 * Tools that are ONLY available on messaging-channel turns (Telegram / Discord / Slack).
 * They are hidden from every other surface (web app, sub-agents, teams, CEO, chat mode).
 * This is the one source of truth consumed by agent.ts (single agent) — Custom Agents
 * never list it, the channel runner appends it explicitly instead.
 */
export const CHANNEL_ONLY_TOOLS: readonly string[] = ["send_responses"];

/**
 * Build the channel-mode system-prompt section appended to the Main Agent's prompt —
 * and to a Custom Agent's prompt — when (and only when) the turn arrived from a
 * messaging channel. It teaches the model the channel rules: reply via
 * send_responses, ask_question_to_user is unavailable, submit_plan resolves through
 * /@ok / /@no, and attach_files delivers to the channel automatically.
 */
export function buildChannelSystemSection(channel: {
  kind: string;
  channelName: string;
  userLabel: string;
}): string {
  const kindLabel =
    channel.kind === "telegram" ? "Telegram" : channel.kind === "discord" ? "Discord" : "Slack";
  return [
    "# Messaging channel mode",
    `- This turn arrived from the ${kindLabel} messaging channel "${channel.channelName}" (user: ${channel.userLabel}) — NOT from the web app. The send_responses tool is available ONLY because this turn came from a channel; detect the channel automatically from its presence.`,
    "- EVERYTHING the user sees must go through the send_responses tool ({ message }). The user never sees your plain final answer and never sees the raw execution log. After finishing work (tool calls, file edits, builds, tests), ALWAYS call send_responses with a clear, concise, user-facing summary: what was done, the key results, relevant file paths, and next steps. Never include internal reasoning, hidden thoughts, raw tool output, or execution logs.",
    "- Keep each send_responses message focused and reasonably short (channels truncate very long messages). Split a long result into 2-3 sequential send_responses calls when needed.",
    "- ask_question_to_user is DISABLED in channels: it always reports itself as unavailable because channels have no interactive question UI. If you need information or a decision from the user, ask directly with send_responses, then end your turn without further tool calls and wait for the user's next message. Do not call ask_question_to_user again on a channel turn.",
    "- submit_plan still works: the plan is forwarded to the channel automatically, and the user approves with /@ok or rejects with /@no (on Discord/Slack the commands need an @mention prefix, e.g. \"@Bot /@ok\"). Continue only after the tool returns the user's decision.",
    "- attach_files still works: attached files are delivered to the channel automatically — mention their names in your send_responses summary.",
    "- Channel commands the user may send (handle their effects, never invent them yourself): /@switch <agent name> (or /@switch default), /@new-chat, /@ok, /@no.",
  ].join("\n");
}

/**
 * send_responses — deliver a user-facing message to the messaging channel the
 * turn came from (Telegram / Discord / Slack).
 *
 * Available to the Main Agent and Custom Agents ONLY, and ONLY on turns that
 * arrived from a channel (the system detects this automatically). There is no
 * web-app UI on a channel turn, so this tool is the single way anything reaches
 * the user — call it for normal responses, updates, results, explanations, and
 * task-completion summaries instead of relying on the final answer text.
 */
export const sendResponsesTool = defineTool({
  name: "send_responses",
  description:
    "Send a message directly to the user. Use it for normal responses, updates, results, " +
    "explanations, or task completion summaries. Keep the message clear, concise, and user-facing. " +
    "Never include internal reasoning, hidden thoughts, raw tool output, or execution logs.",
  schema,
  label: (args: SendResponsesArgs) => {
    const preview = typeof args.message === "string" ? args.message.trim().slice(0, 60) : "";
    return preview ? `Send: ${preview}${args.message.trim().length > 60 ? "…" : ""}` : "Send response";
  },
  async execute(args: SendResponsesArgs, ctx: ToolContext): Promise<ToolResult> {
    const channel = ctx.channel;
    if (!channel) {
      return {
        ok: false,
        error: {
          code: "channel_only",
          message:
            "The send_responses tool is only available when chatting through a messaging " +
            "channel (Telegram, Discord, Slack). Answer the user directly instead.",
        },
      };
    }
    const message = args.message.trim();
    if (!message) {
      return {
        ok: false,
        error: { code: "empty_message", message: "The message cannot be empty." },
      };
    }
    try {
      await channel.sendMessage(message);
      return {
        ok: true,
        data: {
          delivered: true,
          chars: message.length,
          message: `Message sent to the ${channel.kind} channel.`,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "channel_send_failed",
          message: `Could not send the message to the channel: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
});
