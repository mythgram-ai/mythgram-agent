import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireKnowledge, knowledgeFailure } from "./knowledge_list.js";

const schema = z
  .object({
    knowledge_path: z
      .string()
      .describe("Path where the new knowledge file should be created."),
    content: z
      .string()
      .describe(
        "Complete content to store in the new knowledge file. This must be the actual durable " +
          "knowledge to persist.",
      ),
  })
  .strict();

type KnowledgeCreateArgs = z.infer<typeof schema>;

/**
 * knowledge_create — create a new persistent long-term knowledge file. Fails if a file already
 * exists at the path (use knowledge_edit for that) so existing knowledge is never overwritten blind.
 */
export const knowledgeCreateTool = defineTool({
  name: "knowledge_create",
  description:
    "Create a new persistent long-term knowledge file. Use this only when suitable knowledge does " +
    "not already exist in another file. Store durable, useful knowledge rather than temporary task " +
    "information or explanations of the operation.",
  schema,
  label: (args: KnowledgeCreateArgs) => {
    const path = typeof args.knowledge_path === "string" ? args.knowledge_path.trim() : "";
    return path ? `Knowledge: create ${path}` : "Knowledge: create";
  },
  async execute(args: KnowledgeCreateArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireKnowledge(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.knowledge!.create(args.knowledge_path, args.content, ctx);
    } catch (error) {
      return knowledgeFailure(error);
    }
  },
});
