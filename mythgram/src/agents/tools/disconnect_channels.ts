import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  deleteConnectionsOfKind,
  emitChannelsUpdated,
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
        "The name of the configured channel to disconnect. Must be a valid channel name returned by list_available_channels.",
      ),
  })
  .strict();

type DisconnectChannelsArgs = z.infer<typeof schema>;

export const disconnectChannelsTool = defineTool({
  name: "disconnect_channels",
  description:
    "Disconnect a configured communication channel. Before using this tool, use list_available_channels to retrieve the available channel names and select the channel to disconnect. Use this tool only when the user explicitly requests that a channel connection be removed.",
  schema,
  label: (args: DisconnectChannelsArgs) => {
    const name = typeof args.channel_name === "string" ? args.channel_name.trim() : "";
    return name ? `Disconnect channel: ${name}` : "Disconnect channel";
  },
  async execute(args: DisconnectChannelsArgs, ctx: ToolContext): Promise<ToolResult> {
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

    const existing = manager.listPublic().filter((c) => c.kind === kind);
    if (existing.length === 0) {
      return {
        ok: false,
        error: {
          code: "channel_not_configured",
          message:
            `No ${kind} channel connection exists, so there is nothing to disconnect. ` +
            "Call get_channel_status to verify the current state.",
        },
      };
    }

    const { deleted, errors } = await deleteConnectionsOfKind(manager, kind);
    emitChannelsUpdated(ctx, manager);

    if (deleted.length === 0) {
      return {
        ok: false,
        error: {
          code: "channel_disconnect_failed",
          message:
            `Could not disconnect the ${kind} channel${errors.length > 0 ? `: ${errors.join("; ")}` : "."}`,
        },
      };
    }

    return {
      ok: true,
      data: {
        channel_name: kind,
        disconnected: deleted.map((c) => ({ id: c.id, name: c.name })),
        disconnected_count: deleted.length,
        ...(errors.length > 0 ? { errors } : {}),
        message:
          `Disconnected ${deleted.length} ${kind} channel connection(s) ` +
          `(${deleted.map((c) => `"${c.name}"`).join(", ")}). Their chats and transcripts were removed. ` +
          "The agent will no longer receive or send messages on them.",
      },
    };
  },
});
