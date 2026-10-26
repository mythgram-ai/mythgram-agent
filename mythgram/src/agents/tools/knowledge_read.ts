import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireKnowledge, knowledgeFailure } from "./knowledge_list.js";

const schema = z
  .object({
    knowledge_path: z
      .string()
      .describe("Path of the existing knowledge file to read."),
    limit: z
      .number()
      .int()
      .optional()
      .describe(
        "Optional maximum number of lines to return. Use this for large files or when only part of " +
          "the file is needed.",
      ),
    offset: z
      .number()
      .int()
      .optional()
      .describe(
        "Optional 1-based line number from which reading should begin. Use with limit to read a " +
          "specific section.",
      ),
    return_line_number: z
      .boolean()
      .optional()
      .describe(
        "Whether to prefix returned lines with their line numbers. Set to true when inspecting " +
          "content before an exact edit. Defaults to false.",
      ),
  })
  .strict();

type KnowledgeReadArgs = z.infer<typeof schema>;

/**
 * knowledge_read — read the actual contents of a known persistent knowledge file. Supports
 * incremental reads via limit/offset and optional line-number prefixes for precise edits.
 */
export const knowledgeReadTool = defineTool({
  name: "knowledge_read",
  description:
    "Read the actual contents of a known persistent knowledge file. Use this when the knowledge " +
    "file path is already known or has been discovered through knowledge_search or knowledge_list. " +
    "For large files, read incrementally using limit and offset.",
  schema,
  label: (args: KnowledgeReadArgs) => {
    const path = typeof args.knowledge_path === "string" ? args.knowledge_path.trim() : "";
    return path ? `Knowledge: read ${path}` : "Knowledge: read";
  },
  async execute(args: KnowledgeReadArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireKnowledge(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.knowledge!.read(args.knowledge_path, {
        limit: args.limit,
        offset: args.offset,
        returnLineNumber: args.return_line_number,
      });
    } catch (error) {
      return knowledgeFailure(error);
    }
  },
});
