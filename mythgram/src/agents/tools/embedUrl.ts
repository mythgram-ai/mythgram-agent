import { z } from "zod";
import { defineTool, type ToolResult, type ToolContext } from "./types.js";

const schema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "url must be a non-empty string")
    .describe(
      "Publicly accessible HTTP or HTTPS URL to preview. Can be a live web app, a website, an audio/video stream, an image, a document, or any other URL you want to show the user.",
    ),
});

/**
 * Embed a live application frontend URL (or any public HTTP/HTTPS URL) inside the app's browser
 * preview panel so the user can see it without leaving the chat. The URL may be the running
 * frontend of the app being built, an external website, or any resource (audio, video, image,
 * document, etc.) that can be shown via a URL. Use it whenever showing the user something visual or
 * before answering questions about a live webpage/app.
 */
export const embedUrlTool = defineTool({
  name: "embed_url",
  description:
    "Embed a live public URL inside the app's browser preview panel so the user can see it. Use it to show a preview of a running application frontend, a website, or any URL-addressable resource (audio, video, image, document, etc.). The URL must be publicly accessible over HTTP or HTTPS — e.g. the live URL of the app you built, a hosted site, an audio/video stream, or an image. Call this to present the user something visual. Always prefer real public URLs over localhost or private addresses, which cannot be reached from the user's browser.",
  schema,
  label: (args) => `Embed: ${args.url}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const url = args.url.trim();

    if (!/^https?:\/\//i.test(url)) {
      return {
        ok: false,
        error: {
          code: "invalid_url",
          message:
            `embed_url expects a publicly accessible HTTP or HTTPS URL. Received: "${url}". ` +
            "Protocol-relative or non-URL values cannot be previewed.",
          url: args.url,
        },
      };
    }

    // Surface the URL to the frontend immediately so it can open/update the browser preview panel
    // before the tool result arrives.
    ctx.emit?.("embed_url", {
      url,
      chat_id: ctx.chatId,
      tool_call_id: ctx.toolCallId,
    });

    return {
      ok: true,
      data: {
        url,
        message:
          "The URL has been embedded in the browser preview panel for the user to view.",
      },
    };
  },
});