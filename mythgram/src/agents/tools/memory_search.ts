import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireMemory, memoryFailure } from "./memory_list.js";

const schema = z
  .object({
    query: z.string().describe("The search query."),
  })
  .strict();

type MemorySearchArgs = z.infer<typeof schema>;

/**
 * memory_search — search persistent memory with a natural-language query and return, for every
 * matching file, the 1-based line numbers where the query was found AND each matching line's content
 * (rendered as `LINE <n>: <content>`). The agent follows up with memory_read at those exact
 * paths/lines only when it needs the surrounding context.
 */
export const memorySearchTool = defineTool({
  name: "memory_search",
  description:
    "Search persistent memory using a natural-language query. Returns the matching file paths and, " +
    "for each match, the line number together with that line's content (rendered as `LINE <n>: " +
    "<content>`). Use memory_read on those paths/lines to load the surrounding context.",
  schema,
  label: (args: MemorySearchArgs) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    return query ? `Memory: search "${query}"` : "Memory: search";
  },
  async execute(args: MemorySearchArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireMemory(ctx);
    if (unavailable) return unavailable;
    try {
      return ctx.memory!.search(args.query);
    } catch (error) {
      return memoryFailure(error);
    }
  },
});
