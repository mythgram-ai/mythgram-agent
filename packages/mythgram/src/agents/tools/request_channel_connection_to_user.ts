import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  CHANNEL_CONNECTION_TIMEOUT_MS,
  channelCatalog,
  emitChannelConnectionRequest,
  emitChannelsUpdated,
  normalizeChannelName,
  requireChannelManager,
  validChannelNames,
  waitForChannelConnection,
} from "./channelManagement.js";

const schema = z
  .object({
    channel_name: z
      .string()
      .trim()
      .min(1, "A channel name is required.")
      .describe(
        "The name of the channel for which the user should be asked to complete the configuration or connection setup. Must be a channel name returned by list_available_channels.",
      ),
  })
  .strict();

type RequestChannelConnectionArgs = z.infer<typeof schema>;

export const requestChannelConnectionToUserTool = defineTool({
  name: "request_channel_connection_to_user",
  description:
    "Use this tool to request the user to configure and connect a communication channel. This tool allows you to ask the user to complete the required channel setup or connection process. Before using this tool, use list_available_channels to retrieve the available channel names and provide a valid channel name.",
  schema,
  label: (args: RequestChannelConnectionArgs) => {
    const name = typeof args.channel_name === "string" ? args.channel_name.trim() : "";
    return name ? `Connect channel: ${name}` : "Request channel connection";
  },
  async execute(args: RequestChannelConnectionArgs, ctx: ToolContext): Promise<ToolResult> {
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

    // Already connected — no need to block the turn waiting for the user.
    const already = manager
      .listPublic()
      .filter((c) => c.kind === kind && c.enabled && c.status === "connected");
    if (already.length > 0) {
      return {
        ok: true,
        data: {
          channel_name: kind,
          channel_label: catalog.label,
          connected: true,
          already_connected: true,
          connections: already.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            enabled: c.enabled,
            bot_name: c.botName,
          })),
          message:
            `The ${catalog.label} channel is already connected (${already.length} connection(s)). ` +
            "No further setup is needed — continue with the task.",
        },
      };
    }

    // Surface the inline configuration form in the chat UI, then block up to
    // 3 minutes for the user to complete it. The frontend creates the
    // connection via POST /api/channels; this tool observes the stored
    // connections and resolves as soon as one of this kind connects.
    emitChannelConnectionRequest(ctx, catalog);
    ctx.emit?.("status", { state: "waiting", label: `Waiting for ${catalog.label} setup…` });

    const finished = await waitForChannelConnection(manager, kind, {
      timeoutMs: CHANNEL_CONNECTION_TIMEOUT_MS,
      signal: ctx.signal,
    });

    if (ctx.signal?.aborted) {
      return { ok: false, error: { code: "aborted", message: "The channel connection request was aborted." } };
    }
    if (!finished) {
      return {
        ok: true,
        data: {
          channel_name: kind,
          channel_label: catalog.label,
          connected: false,
          timed_out: true,
          message:
            `The user did not complete the ${catalog.label} channel configuration within 3 minutes. ` +
            "Continue without it for now — you can ask again later with request_channel_connection_to_user, " +
            "or guide the user to the Channels page to connect it manually.",
        },
      };
    }

    emitChannelsUpdated(ctx, manager);
    const fresh = manager.listPublic().filter((c) => c.kind === kind && c.enabled && c.status === "connected");
    return {
      ok: true,
      data: {
        channel_name: kind,
        channel_label: catalog.label,
        connected: true,
        connections: fresh.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          enabled: c.enabled,
          bot_name: c.botName,
        })),
        message:
          `The user connected the ${catalog.label} channel (${fresh.length} connection(s) now active). ` +
          "Continue with the task using it.",
      },
    };
  },
});
