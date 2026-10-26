import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireMemory, memoryFailure } from "./memory_list.js";

const schema = z
  .object({
    path: z
      .string()
      .describe("Path of the existing memory file relative to the memory directory."),
    old_str: z
      .string()
      .describe(
        "Exact existing text that should be replaced. The text must match exactly, including " +
          "whitespace and line breaks.",
      ),
    new_str: z
      .string()
      .describe("Replacement text for old_str. Use an empty string to remove the matched text."),
  })
  .strict();

type MemoryEditArgs = z.infer<typeof schema>;

/**
 * memory_edit — edit an existing persistent memory file using exact string replacement. old_str
 * must match the existing text exactly and appear exactly once. Read the memory first if unsure.
 */
export const memoryEditTool = defineTool({
  name: "memory_edit",
  description:
    "Edit an existing persistent memory file using exact string replacement. Use this tool when " +
    "only a specific part of a memory needs to be changed. The old_str must exactly match the " +
    "existing text. Do not guess the target text; read the memory first if necessary.",
  schema,
  label: (args: MemoryEditArgs) => {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    return path ? `Memory: edit ${path}` : "Memory: edit";
  },
  async execute(args: MemoryEditArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireMemory(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.memory!.edit(args.path, args.old_str, args.new_str, ctx);
    } catch (error) {
      return memoryFailure(error);
    }
  },
});
