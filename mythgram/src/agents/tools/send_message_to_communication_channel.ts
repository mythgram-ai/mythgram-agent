import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  channelCatalog,
  normalizeChannelName,
  requireChannelManager,
  validChannelNames,
} from "./channelManagement.js";

const schema = z
  .object({
    channel_name: z
      .string()
      .trim()
      .min(1, "A channel name is required.")
      .describe(
        "The name of the connected communication channel through which the message should be sent. Must be a valid channel name returned by list_available_channels.",
      ),
    message: z
      .string()
      .trim()
      .min(1, "A message is required.")
      .describe("The message to send to the user through the specified communication channel."),
  })
  .strict();

type SendMessageToChannelArgs = z.infer<typeof schema>;

export const sendMessageToCommunicationChannelTool = defineTool({
  name: "send_message_to_communication_channel",
  description:
    "Send a message to the user through a connected communication channel. This tool works only when the specified channel is already connected. Before using it, use list_available_channels to get valid channel names and, when necessary, use get_channel_status to verify that the channel is connected.",
  schema,
  label: (args: SendMessageToChannelArgs) => {
    const name = typeof args.channel_name === "string" ? args.channel_name.trim() : "";
    const preview =
      typeof args.message === "string" && args.message.trim().length > 0
        ? args.message.trim().slice(0, 60)
        : "";
    return name ? `Send via ${name}${preview ? `: ${preview}` : ""}` : "Send channel message";
  },
  async execute(args: SendMessageToChannelArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireChannelManager(ctx);
    if (unavailable) return unavailable;
    const manager = ctx.channelManager!;

    const kind = normalizeChannelName(args.channel_name);
    if (!kind) {
      return {
        ok: false,
        error: {
          code: "unknown_channel",
          message:
            `Unknown communication channel "${args.channel_name}". ` +
            `Available channels: ${validChannelNames()}. ` +
            "Call list_available_channels to see them, then retry with one of those exact names.",
        },
      };
    }

    const message = args.message.trim();
    if (!message) {
      return { ok: false, error: { code: "empty_message", message: "The message cannot be empty." } };
    }

    const catalog = channelCatalog().find((c) => c.channel_name === kind)!;
    const connected = manager
      .listPublic()
      .filter((c) => c.kind === kind && c.enabled && c.status === "connected");
    if (connected.length === 0) {
      const configured = manager.listPublic().filter((c) => c.kind === kind);
      return {
        ok: false,
        error: {
          code: "channel_not_connected",
          message:
            configured.length === 0
              ? `The ${catalog.label} channel is not connected yet. Use request_channel_connection_to_user with channel_name "${kind}" to ask the user to connect it first.`
              : `The ${catalog.label} channel is configured but has no active connection right now. Use get_channel_status to inspect it, or ask the user to reconnect it on the Channels page.`,
        },
      };
    }

    try {
      const outcome = await manager.sendMessageToChannel(kind, message, { signal: ctx.signal });
      if (outcome.delivered === 0) {
        return {
          ok: false,
          error: {
            code: outcome.errorCode ?? "channel_send_failed",
            message: outcome.message,
            ...(outcome.errors.length > 0 ? { errors: outcome.errors } : {}),
          },
        };
      }
      return {
        ok: true,
        data: {
          channel_name: kind,
          channel_label: catalog.label,
          delivered: outcome.delivered,
          targets: outcome.targets,
          ...(outcome.errors.length > 0 ? { errors: outcome.errors } : {}),
          message: outcome.message,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "channel_send_failed",
          message: `Could not send the message via ${catalog.label}: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
});
