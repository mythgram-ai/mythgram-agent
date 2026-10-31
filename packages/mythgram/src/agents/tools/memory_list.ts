import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/** Shared guard: the memory runtime is only present for main-agent tool calls. */
export function requireMemory(ctx: ToolContext): ToolResult | null {
  if (!ctx.memory) {
    return {
      ok: false,
      error: {
        code: "memory_unavailable",
        message:
          "The memory tools are not available in this context (memory is only accessible to the " +
          "main agent, not sub-agents).",
      },
    };
  }
  return null;
}

/** Uniform structured error for an unexpected runtime failure inside a memory tool. */
export function memoryFailure(error: unknown): ToolResult {
  return {
    ok: false,
    error: {
      code: "memory_operation_failed",
      message: `Memory operation failed: ${error instanceof Error ? error.message : String(error)}`,
    },
  };
}

const schema = z.object({}).strict();

type MemoryListArgs = z.infer<typeof schema>;

/**
 * memory_list — enumerate the persistent memory files available to the agent and their paths so it
 * can discover existing memories before reading, editing, or deleting one when the exact path is not
 * already known.
 */
export const memoryListTool = defineTool({
  name: "memory_list",
  description:
    "List all persistent memory files available to the agent. Use this tool to discover existing " +
    "memory files before reading, editing, or deleting a memory when the exact file path is not " +
    "already known.",
  schema,
  label: (_args: MemoryListArgs) => "Memory: list",
  async execute(_args: MemoryListArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireMemory(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.memory!.list();
    } catch (error) {
      return memoryFailure(error);
    }
  },
});
