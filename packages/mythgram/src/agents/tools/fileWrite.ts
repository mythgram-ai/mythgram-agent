import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

const schema = z.object({
  file_path: z
    .string()
    .describe("Path of the file to create or overwrite, relative to the workspace root."),
  content: z.string().describe("The full content to write to the file. Overwrites any existing file."),
});

export const fileWriteTool = defineTool({
  name: "file_write",
  description:
    "Create a new file or completely overwrite an existing file with the provided content. " +
    "Parent directories are created automatically. Use this for creating files or fully rewriting them.",
  schema,
  label: (args) => `Create: ${args.file_path}`,
  async execute(args, ctx): Promise<ToolResult> {
    try {
      const absolute = safeResolve(ctx.workspaceRoot, args.file_path);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, args.content, "utf8");
      const lineCount = args.content.length === 0 ? 0 : args.content.split("\n").length;
      return {
        ok: true,
        data: {
          file_path: toWorkspaceRelative(ctx.workspaceRoot, absolute),
          bytes_written: Buffer.byteLength(args.content, "utf8"),
          line_count: lineCount,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "file_write_failed",
          message: error instanceof Error ? error.message : String(error),
          file_path: args.file_path,
        },
      };
    }
  },
});
