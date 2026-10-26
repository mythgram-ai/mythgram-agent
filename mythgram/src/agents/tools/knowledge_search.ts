import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireKnowledge, knowledgeFailure } from "./knowledge_list.js";

const schema = z
  .object({
    query: z.string().describe("The search query."),
  })
  .strict();

type KnowledgeSearchArgs = z.infer<typeof schema>;

/**
 * knowledge_search — search the persistent knowledge base with a natural-language query and return,
 * for every matching file, the 1-based line numbers where the query was found AND each matching
 * line's content (rendered as `LINE <n>: <content>`). The agent follows up with knowledge_read at
 * those exact paths/lines only when it needs the surrounding context.
 */
export const knowledgeSearchTool = defineTool({
  name: "knowledge_search",
  description:
    "Search the persistent knowledge base using a natural-language query. Returns the matching file " +
    "paths and, for each match, the line number together with that line's content (rendered as " +
    "`LINE <n>: <content>`). Use knowledge_read on those paths/lines to load the surrounding context.",
  schema,
  label: (args: KnowledgeSearchArgs) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    return query ? `Knowledge: search "${query}"` : "Knowledge: search";
  },
  async execute(args: KnowledgeSearchArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireKnowledge(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.knowledge!.search(args.query);
    } catch (error) {
      return knowledgeFailure(error);
    }
  },
});
