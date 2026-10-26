import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireKnowledge, knowledgeFailure } from "./knowledge_list.js";

const schema = z
  .object({
    knowledge_path: z
      .string()
      .describe("Path of the existing knowledge file to permanently delete."),
  })
  .strict();

type KnowledgeDeleteArgs = z.infer<typeof schema>;

/**
 * knowledge_delete — permanently delete an existing persistent knowledge file. There are no
 * protected/pre-added knowledge files, so any existing file may be deleted.
 */
export const knowledgeDeleteTool = defineTool({
  name: "knowledge_delete",
  description:
    "Permanently delete an existing persistent knowledge file. Use this only when the knowledge " +
    "file should be completely removed. If the path is unknown, use knowledge_search or " +
    "knowledge_list first.",
  schema,
  label: (args: KnowledgeDeleteArgs) => {
    const path = typeof args.knowledge_path === "string" ? args.knowledge_path.trim() : "";
    return path ? `Knowledge: delete ${path}` : "Knowledge: delete";
  },
  async execute(args: KnowledgeDeleteArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireKnowledge(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.knowledge!.remove(args.knowledge_path, ctx);
    } catch (error) {
      return knowledgeFailure(error);
    }
  },
});
