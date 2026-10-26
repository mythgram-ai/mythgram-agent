import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireMemory, memoryFailure } from "./memory_list.js";

const schema = z
  .object({
    path: z
      .string()
      .describe("Path of the memory file relative to the memory directory."),
    content: z
      .string()
      .describe(
        "Complete content to store in the memory file. When the file already exists, its entire " +
          "contents will be replaced.",
      ),
  })
  .strict();

type MemoryWriteArgs = z.infer<typeof schema>;

/**
 * memory_write — create a new persistent memory file or completely overwrite an existing one. Use
 * memory_edit instead when only a specific part of an existing memory needs to change.
 */
export const memoryWriteTool = defineTool({
  name: "memory_write",
  description:
    "Create a new persistent memory file or completely overwrite an existing memory file. Use this " +
    "tool to store information that should persist across conversations or future agent runs. When " +
    "only a specific part of an existing memory needs to change, use memory_edit instead.",
  schema,
  label: (args: MemoryWriteArgs) => {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    return path ? `Memory: write ${path}` : "Memory: write";
  },
  async execute(args: MemoryWriteArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireMemory(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.memory!.write(args.path, args.content, ctx);
    } catch (error) {
      return memoryFailure(error);
    }
  },
});
