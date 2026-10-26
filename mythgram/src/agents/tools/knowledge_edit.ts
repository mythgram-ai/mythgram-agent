import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireKnowledge, knowledgeFailure } from "./knowledge_list.js";

const schema = z
  .object({
    knowledge_path: z
      .string()
      .describe("Path of the existing knowledge file to modify."),
    old_str: z
      .string()
      .describe(
        "Exact existing text that must be replaced. It must match the current file content exactly.",
      ),
    new_str: z
      .string()
      .describe(
        "Replacement text for old_str. Use an empty string to remove the matched content.",
      ),
  })
  .strict();

type KnowledgeEditArgs = z.infer<typeof schema>;

/**
 * knowledge_edit — modify an existing persistent knowledge file using exact string replacement.
 * old_str must match the current file content exactly and appear exactly once.
 */
export const knowledgeEditTool = defineTool({
  name: "knowledge_edit",
  description:
    "Modify an existing persistent knowledge file using exact string replacement. The old_str must " +
    "match the current file content exactly, including capitalization, whitespace, spelling, and " +
    "punctuation. If the current content is unknown, use knowledge_read first.",
  schema,
  label: (args: KnowledgeEditArgs) => {
    const path = typeof args.knowledge_path === "string" ? args.knowledge_path.trim() : "";
    return path ? `Knowledge: edit ${path}` : "Knowledge: edit";
  },
  async execute(args: KnowledgeEditArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireKnowledge(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.knowledge!.edit(args.knowledge_path, args.old_str, args.new_str, ctx);
    } catch (error) {
      return knowledgeFailure(error);
    }
  },
});
