import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireMemory, memoryFailure } from "./memory_list.js";

const schema = z
  .object({
    path: z
      .string()
      .describe("Path of the memory file to permanently delete, relative to the memory directory."),
  })
  .strict();

type MemoryDeleteArgs = z.infer<typeof schema>;

/**
 * memory_delete — permanently delete a persistent memory file. The three pre-added core files
 * (MEMORY.md, SOUL.md, USER.md) cannot be deleted and return a structured error.
 */
export const memoryDeleteTool = defineTool({
  name: "memory_delete",
  description:
    "Permanently delete a persistent memory file. Use this tool when a memory is explicitly " +
    "requested to be forgotten or is no longer valid or useful. Verify that the target memory is " +
    "the correct one before deleting it.",
  schema,
  label: (args: MemoryDeleteArgs) => {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    return path ? `Memory: delete ${path}` : "Memory: delete";
  },
  async execute(args: MemoryDeleteArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireMemory(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.memory!.remove(args.path, ctx);
    } catch (error) {
      return memoryFailure(error);
    }
  },
});
