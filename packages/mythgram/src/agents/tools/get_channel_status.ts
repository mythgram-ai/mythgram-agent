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
        "The name of the channel whose current status should be checked. Must be a valid channel name returned by list_available_channels.",
      ),
  })
  .strict();

type GetChannelStatusArgs = z.infer<typeof schema>;

export const getChannelStatusTool = defineTool({
  name: "get_channel_status",
  description:
    "Get the current connection and configuration status of a communication channel. Use list_available_channels first to retrieve valid channel names. Use this tool when you need to check whether a specific channel is connected, disconnected, configured, or requires setup.",
  schema,
  label: (args: GetChannelStatusArgs) => {
    const name = typeof args.channel_name === "string" ? args.channel_name.trim() : "";
    return name ? `Channel status: ${name}` : "Get channel status";
  },
  async execute(args: GetChannelStatusArgs, ctx: ToolContext): Promise<ToolResult> {
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

    const catalog = channelCatalog().find((c) => c.channel_name === kind)!;
    const connections = manager.listPublic().filter((c) => c.kind === kind);
    const connected = connections.filter((c) => c.enabled && c.status === "connected");

    return {
      ok: true,
      data: {
        channel_name: kind,
        channel_label: catalog.label,
        available: true,
        configured: connections.length > 0,
        connected: connected.length > 0,
        connection_count: connections.length,
        connected_count: connected.length,
        connections: connections.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          enabled: c.enabled,
          bot_name: c.botName,
          chat_count: c.chatCount,
          ...(c.lastError ? { last_error: c.lastError } : {}),
        })),
        message:
          connections.length === 0
            ? `The ${catalog.label} channel is not configured yet. Use request_channel_connection_to_user with channel_name "${kind}" to ask the user to connect it.`
            : connected.length > 0
              ? `The ${catalog.label} channel is connected (${connected.length}/${connections.length} connection(s) active).`
              : `The ${catalog.label} channel is configured but not connected (${connections.length} connection(s), none active). Ask the user to reconnect it or check the Channels page for errors.`,
      },
    };
  },
});
