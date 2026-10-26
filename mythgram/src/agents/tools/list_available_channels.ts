import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { channelCatalog } from "./channelManagement.js";

const schema = z.object({}).strict();

export const listAvailableChannelsTool = defineTool({
  name: "list_available_channels",
  description:
    "List all communication channels that are currently available for connection. Use this tool whenever you need to know which channels are available, especially before using request_channel_connection_to_user.",
  schema,
  label: () => "List channels",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const catalog = channelCatalog().map((entry) => {
      if (!ctx.channelManager) return { ...entry, connected: undefined, connection_count: 0 };
      try {
        const connections = ctx.channelManager
          .listPublic()
          .filter((c) => c.kind === entry.channel_name);
        const connected = connections.filter((c) => c.enabled && c.status === "connected").length;
        return { ...entry, connected, connection_count: connections.length };
      } catch {
        return { ...entry, connected: undefined, connection_count: 0 };
      }
    });

    return {
      ok: true,
      data: {
        count: catalog.length,
        channels: catalog,
        message:
          `${catalog.length} communication channel(s) available: ` +
          catalog.map((c) => c.channel_name).join(", ") +
          ". Pass one of these exact channel names to request_channel_connection_to_user, disconnect_channels, get_channel_status, or send_message_to_communication_channel.",
      },
    };
  },
});
