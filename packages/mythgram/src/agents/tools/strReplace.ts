import fs from "node:fs/promises";
import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

const schema = z.object({
  file_path: z.string().describe("Path of the file to edit, relative to the workspace root."),
  old_string: z
    .string()
    .describe(
      "The exact text/code block to find and remove. The matched text (including its full lines) " +
        "is deleted and replaced by new_string.",
    ),
  new_string: z
    .string()
    .describe("The replacement text/code. Use an empty string to delete the matched block entirely."),
  replace_all: z
    .boolean()
    .default(false)
    .describe("Replace every occurrence of old_string instead of requiring a single unique match."),
});

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export const strReplaceTool = defineTool({
  name: "str_replace",
  description:
    "Perform an exact string replacement inside a file. old_string must match the file content exactly " +
    "(including indentation and newlines). The matched text — and its lines — is fully removed and replaced " +
    "by new_string. Fails if old_string is not found, or is not unique unless replace_all is true.",
  schema,
  label: (args) => `Edit: ${args.file_path}`,
  async execute(args, ctx): Promise<ToolResult> {
    const { file_path, old_string, new_string, replace_all } = args;

    if (old_string.length === 0) {
      return {
        ok: false,
        error: {
          code: "empty_old_string",
          message: "old_string must be a non-empty string.",
          file_path,
        },
      };
    }

    let absolute: string;
    let content: string;
    try {
      absolute = safeResolve(ctx.workspaceRoot, file_path);
      content = await fs.readFile(absolute, "utf8");
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "file_read_failed",
          message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
          file_path,
        },
      };
    }

    const occurrences = countOccurrences(content, old_string);
    if (occurrences === 0) {
      return {
        ok: false,
        error: {
          code: "string_not_found",
          message:
            "old_string was not found in the file. Read the file and provide the exact text (including whitespace).",
          file_path,
        },
      };
    }

    if (occurrences > 1 && !replace_all) {
      return {
        ok: false,
        error: {
          code: "multiple_occurrences",
          message: `Found ${occurrences} occurrences of old_string. Provide a more unique string or set replace_all=true.`,
          file_path,
          occurrences,
        },
      };
    }

    const newContent = replace_all
      ? content.split(old_string).join(new_string)
      : content.replace(old_string, () => new_string);

    try {
      await fs.writeFile(absolute, newContent, "utf8");
      return {
        ok: true,
        data: {
          file_path: toWorkspaceRelative(ctx.workspaceRoot, absolute),
          replaced: replace_all ? occurrences : 1,
          replace_all,
          line_count: newContent.length === 0 ? 0 : newContent.split("\n").length,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "file_write_failed",
          message: `Failed to write file after replacement: ${error instanceof Error ? error.message : String(error)}`,
          file_path,
        },
      };
    }
  },
});
