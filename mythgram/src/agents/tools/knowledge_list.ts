import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/** Shared guard: the knowledge runtime is only present for main-agent tool calls. */
export function requireKnowledge(ctx: ToolContext): ToolResult | null {
  if (!ctx.knowledge) {
    return {
      ok: false,
      error: {
        code: "knowledge_unavailable",
        message:
          "The knowledge tools are not available in this context (knowledge is only accessible to " +
          "the main agent, not sub-agents).",
      },
    };
  }
  return null;
}

const schema = z.object({}).strict();

type KnowledgeListArgs = z.infer<typeof schema>;

/**
 * knowledge_list — enumerate the available persistent knowledge files and their paths so the agent
 * can discover the knowledge-file structure or locate a file by browsing rather than searching.
 */
export const knowledgeListTool = defineTool({
  name: "knowledge_list",
  description:
    "List available persistent knowledge files and their paths. Use this when the agent needs to " +
    "discover the available knowledge-file structure or locate a file by browsing rather than " +
    "searching its contents.",
  schema,
  label: (_args: KnowledgeListArgs) => "Knowledge: list",
  async execute(_args: KnowledgeListArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireKnowledge(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.knowledge!.list();
    } catch (error) {
      return knowledgeFailure(error);
    }
  },
});

/** Uniform structured error for an unexpected runtime failure inside a knowledge tool. */
export function knowledgeFailure(error: unknown): ToolResult {
  return {
    ok: false,
    error: {
      code: "knowledge_operation_failed",
      message: `Knowledge operation failed: ${error instanceof Error ? error.message : String(error)}`,
    },
  };
}
