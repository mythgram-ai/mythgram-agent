import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

const schema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      "Absolute path of the directory to list (e.g. /home/user/project or /home/user). Relative paths are rejected. If omitted, the current workspace root is listed.",
    ),
});

export const fileListTool = defineTool({
  name: "file_list",
  description:
    "List the files and directories directly inside the given absolute directory path. " +
    "The directory may be anywhere on the local filesystem; the workspace root is only the default " +
    "location, not an access boundary. Use this to discover what files exist before reading or editing them.",
  schema,
  label: (args) => `List: ${args.path || "."}`,
  async execute(args, ctx): Promise<ToolResult> {
    const requested = args.path && args.path.trim() ? args.path.trim() : ctx.workspaceRoot;
    try {
      const absolute = safeResolve(ctx.workspaceRoot, requested);
      const dirents = await fs.readdir(absolute, { withFileTypes: true });
      const items = await Promise.all(
        dirents.map(async (dirent) => {
          const entryAbs = path.join(absolute, dirent.name);
          let size: number | null = null;
          try {
            if (dirent.isFile()) {
              const stat = await fs.stat(entryAbs);
              size = stat.size;
            }
          } catch {
            size = null;
          }
          return {
            name: dirent.name,
            type: dirent.isDirectory() ? "dir" : "file",
            path: toWorkspaceRelative(ctx.workspaceRoot, entryAbs),
            size,
          };
        }),
      );
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return {
        ok: true,
        data: {
          path: toWorkspaceRelative(ctx.workspaceRoot, absolute),
          items,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "file_list_failed",
          message: error instanceof Error ? error.message : String(error),
          path: requested,
        },
      };
    }
  },
});
