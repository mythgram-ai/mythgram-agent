import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";
import { mimeTypeFromPath } from "../../utils/mime.js";

const schema = z.object({
  file_paths: z
    .array(z.string().trim().min(1, "file paths must be non-empty strings"))
    .min(1, "file_paths must contain at least one file")
    .describe(
      "Absolute paths of the files to attach. There is no fixed limit on the number of files. Each path must be a real file inside the workspace you want to hand to the user.",
    ),
});

/** Metadata the tool returns/streams for one successfully attached file. */
export interface AttachedFileInfo {
  /** Display name (basename) of the file. */
  name: string;
  /** Workspace-relative path used by the frontend to build the preview/download URL. */
  path: string;
  /** Absolute path on the server. */
  absolute_path: string;
  /** File size in bytes. */
  size: number;
  /** Best-effort MIME type derived from the file extension. */
  content_type: string;
  /** Human friendly size label, e.g. "2.4 KB". */
  size_label: string;
}

export interface AttachFileFailure {
  /** The raw path supplied by the model. */
  path: string;
  /** Human readable reason the file could not be attached. */
  error: string;
}

/** Format a byte count into a compact human readable string. */
export function formatFileSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
}

/**
 * Attach one or more files (by absolute path) to the user's conversation. The files are surfaced in
 * the UI so the user can preview or download each of them. Use this to hand the user a file you
 * produced or edited (logs, scripts, configs, build artifacts, images, documents, etc.) so they can
 * preview or download it directly instead of only reading about it in your reply.
 */
export const attachFilesTool = defineTool({
  name: "attach_files",
  description:
    "Attach one or more files from their absolute paths to the user's conversation. The attached files are made available to the user for preview or download — a popup lists each file with its size and type, plus Preview and Download actions. Use it whenever the user would benefit from accessing a file you created or modified (reports, configs, scripts, logs, build artifacts, images, documents, etc.). Only attach real files inside the workspace; files that do not exist or are not regular files are reported and skipped.",
  schema,
  label: (args) =>
    `Attach ${Array.isArray(args.file_paths) ? args.file_paths.length : 0} File` +
    (Array.isArray(args.file_paths) && args.file_paths.length === 1 ? "" : "s"),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const files: AttachedFileInfo[] = [];
    const errors: AttachFileFailure[] = [];

    for (const raw of args.file_paths) {
      const input = raw.trim();
      if (!input) {
        errors.push({ path: raw, error: "Empty file path." });
        continue;
      }

      let absolute: string;
      try {
        absolute = safeResolve(ctx.workspaceRoot, input);
      } catch (error) {
        errors.push({
          path: input,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      let stat;
      try {
        stat = await fs.promises.stat(absolute);
      } catch (error) {
        const errno = (error as NodeJS.ErrnoException)?.code;
        errors.push({
          path: input,
          error:
            errno === "ENOENT" || errno === "ENOTDIR"
              ? "File does not exist."
              : errno === "EACCES" || errno === "EPERM"
                ? "Permission denied."
                : error instanceof Error
                  ? error.message
                  : String(error),
        });
        continue;
      }

      if (!stat.isFile()) {
        errors.push({ path: input, error: "Path is not a regular file." });
        continue;
      }

      const relative = toWorkspaceRelative(ctx.workspaceRoot, absolute);
      files.push({
        name: path.basename(absolute),
        path: relative,
        absolute_path: absolute,
        size: stat.size,
        content_type: mimeTypeFromPath(absolute),
        size_label: formatFileSizeLabel(stat.size),
      });
    }

    // Surface the attached files to the frontend as soon as they are known so the popup can open
    // live, before the tool result arrives.
    ctx.emit?.("attach_files", {
      files,
      file_count: files.length,
      chat_id: ctx.chatId,
      tool_call_id: ctx.toolCallId,
    });

    // On a messaging-channel turn there is no app UI: deliver every attached file straight to
    // the channel the request came from. Best-effort — the tool result still reports the files
    // so the agent can mention them in its send_responses summary either way.
    let channelDelivered = 0;
    const channelErrors: Array<{ path: string; error: string }> = [];
    if (ctx.channel && files.length > 0) {
      try {
        const outcome = await ctx.channel.sendFiles(
          files.map((f) => ({
            absolutePath: f.absolute_path,
            filename: f.name,
            contentType: f.content_type,
          })),
        );
        channelDelivered = outcome.delivered;
        for (const error of outcome.errors) channelErrors.push({ path: "", error });
      } catch (error) {
        channelErrors.push({
          path: "",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (files.length === 0) {
      return {
        ok: false,
        error: {
          code: "no_files_attached",
          message:
            "None of the provided file paths could be attached. Check the errors and try again.",
          errors,
        },
      };
    }

    return {
      ok: true,
      data: {
        files,
        file_count: files.length,
        errors,
        ...(ctx.channel
          ? {
              channel_delivered: channelDelivered,
              channel_errors: channelErrors,
            }
          : {}),
        message:
          `${files.length} file${files.length === 1 ? "" : "s"} attached and made available to the user for preview or download.` +
          (ctx.channel
            ? channelDelivered === files.length
              ? " They were delivered to the messaging channel."
              : " Some files could not be delivered to the messaging channel — see channel_errors."
            : ""),
      },
    };
  },
});