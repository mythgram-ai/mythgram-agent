import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireMemory, memoryFailure } from "./memory_list.js";

const schema = z
  .object({
    path: z
      .string()
      .describe("Path of the memory file to read, relative to the memory directory."),
    limit: z
      .number()
      .int()
      .optional()
      .describe(
        "Optional number of lines to read from the text file. Use for large files to limit output. " +
          "Must be 1 or greater. If omitted, reads up to max file read lines by default.",
      ),
    offset: z
      .number()
      .int()
      .optional()
      .describe(
        "Optional line number to start reading from (1-based). Use with limit to read specific " +
          "sections of large files. Must be 1 or greater. If omitted, starts from line 1.",
      ),
    return_line_number: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Whether to include line numbers in the returned memory content. Enable this when precise " +
          "locations are needed for subsequent memory_edit operations.",
      ),
  })
  .strict();

type MemoryReadArgs = z.infer<typeof schema>;

/**
 * memory_read — read the contents of a persistent memory file. Supports incremental reads via
 * limit/offset and optional line-number prefixes for precise subsequent edits.
 */
export const memoryReadTool = defineTool({
  name: "memory_read",
  description:
    "Read the contents of a persistent memory file. Use this tool when information stored in memory " +
    "is relevant to the current task, such as user preferences, previous decisions, ongoing " +
    "projects, or other persistent context. For large memory files, use limit and offset to read " +
    "the file incrementally instead of loading the entire file at once.",
  schema,
  label: (args: MemoryReadArgs) => {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    return path ? `Memory: read ${path}` : "Memory: read";
  },
  async execute(args: MemoryReadArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireMemory(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.memory!.read(args.path, {
        limit: args.limit,
        offset: args.offset,
        returnLineNumber: args.return_line_number,
      });
    } catch (error) {
      return memoryFailure(error);
    }
  },
});
