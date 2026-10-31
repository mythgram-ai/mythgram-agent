import fs from "node:fs/promises";
import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

const editSchema = z
  .object({
    old_text: z
      .string()
      .min(1, "old_text must be a non-empty string.")
      .describe("Exact text that must exist in the file."),
    new_text: z.string().describe("Text that replaces old_text."),
  })
  .strict()
  .describe("A single exact-text replacement: the matched old_text (including its lines) is removed and replaced by new_text.");

const schema = z
  .object({
    file_path: z.string().describe("Absolute path of the file to edit."),
    edits: z
      .array(editSchema)
      .min(1, "At least one edit is required.")
      .describe("Multiple edits to apply to the file."),
  })
  .strict();

interface ValidationIssue {
  kind: "not_found" | "multiple" | "overlap";
  index: number;
  old_text: string;
  count?: number;
  other?: string;
}

interface MatchedEdit {
  edit: z.infer<typeof editSchema>;
  start: number;
  end: number;
}

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

/** Format a (possibly multi-line) old_text for error messages, truncated and quoted. */
function describeText(text: string): string {
  const single = text.split("\n")[0].trim();
  const preview = single.length > 60 ? `${single.slice(0, 57)}...` : single;
  return `"${preview}"`;
}

function buildValidationError(filePath: string, issues: ValidationIssue[]): ToolResult {
  const lines: string[] = [
    `Cannot apply edits to ${filePath}: validation failed and NO changes were written.`,
  ];
  for (const issue of issues) {
    const where = `edit #${issue.index + 1} (old_text ${describeText(issue.old_text)})`;
    if (issue.kind === "not_found") {
      lines.push(`- ${where} was not found in the file. Read the file and provide the exact text (including whitespace).`);
    } else if (issue.kind === "multiple") {
      lines.push(`- ${where} was found ${issue.count} times; it must match exactly once. Make it more unique.`);
    } else {
      lines.push(`- ${where} overlaps with ${describeText(issue.other ?? "")}. Edits must not overlap.`);
    }
  }
  return {
    ok: false,
    error: {
      code: "edit_validation_failed",
      message: lines.join("\n"),
      file_path: filePath,
      issues: issues.map(({ kind, index, old_text, count, other }) => ({
        kind,
        edit_index: index,
        old_text,
        ...(count !== undefined ? { occurrences: count } : {}),
        ...(other !== undefined ? { overlaps_with: other } : {}),
      })),
    },
  };
}

export const applyMultipleEditsTool = defineTool({
  name: "apply_multiple_edits",
  description:
    "Apply multiple exact text edits to a single file in one operation. Each edit replaces an exact existing " +
    "text block (old_text, including its lines) with new_text; use an empty new_text to delete the matched block. " +
    "All old_text values are validated against the current file content BEFORE anything is written: the call fails " +
    "if any old_text is not found, matches more than once, or overlaps another edit — in that case NO changes are " +
    "written and the error reports exactly which old_text values caused the failure. Use this instead of multiple " +
    "str_replace calls when several edits target the same file.",
  schema,
  label: (args) => `Edit: ${args.file_path}`,
  async execute(args, ctx): Promise<ToolResult> {
    const { file_path, edits } = args;

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

    // Phase 1 — validate every old_text against the ORIGINAL content. Any issue fails the
    // entire call so the file is never left in a partially-edited state.
    const issues: ValidationIssue[] = [];
    const matched: MatchedEdit[] = [];

    for (const [index, edit] of edits.entries()) {
      const occurrences = countOccurrences(content, edit.old_text);
      if (occurrences === 0) {
        issues.push({ kind: "not_found", index, old_text: edit.old_text });
      } else if (occurrences > 1) {
        issues.push({ kind: "multiple", index, old_text: edit.old_text, count: occurrences });
      } else {
        const start = content.indexOf(edit.old_text);
        matched.push({ edit, start, end: start + edit.old_text.length });
      }
    }

    // Overlapping matches would corrupt the result when applied in sequence.
    const byStart = [...matched].sort((a, b) => a.start - b.start);
    for (let i = 1; i < byStart.length; i++) {
      if (byStart[i].start < byStart[i - 1].end) {
        issues.push({
          kind: "overlap",
          index: edits.indexOf(byStart[i].edit),
          old_text: byStart[i].edit.old_text,
          other: byStart[i - 1].edit.old_text,
        });
      }
    }

    if (issues.length > 0) {
      return buildValidationError(file_path, issues);
    }

    // Phase 2 — apply the replacements. Splicing in descending start order keeps every
    // original match position valid because earlier regions are untouched until later.
    let newContent = content;
    const descending = [...matched].sort((a, b) => b.start - a.start);
    for (const { edit, start } of descending) {
      newContent =
        newContent.slice(0, start) + edit.new_text + newContent.slice(start + edit.old_text.length);
    }

    try {
      await fs.writeFile(absolute, newContent, "utf8");
      return {
        ok: true,
        data: {
          file_path: toWorkspaceRelative(ctx.workspaceRoot, absolute),
          edits_applied: edits.length,
          line_count: newContent.length === 0 ? 0 : newContent.split("\n").length,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "file_write_failed",
          message: `Failed to write file after edits: ${error instanceof Error ? error.message : String(error)}`,
          file_path,
        },
      };
    }
  },
});