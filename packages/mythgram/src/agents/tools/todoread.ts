import { z } from "zod";
import { defineTool, type TodoItem, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({});

/**
 * Read the current todo list. Returns every currently stored todo, including each todo's unique
 * id, content, status, and priority, so the caller (and the LLM) can inspect existing todos before
 * creating or updating them. This tool never creates, modifies, or deletes todos — it only
 * retrieves the current state. When no todos exist, it returns an empty `todos` array instead of
 * erroring. It reads from the same persistent todo storage used by TodoWrite, so both tools always
 * operate on the same list.
 */
export const readTodosTool = defineTool({
  name: "read_todos",
  description:
    "Read the current todo list. Use this tool when you need to inspect existing todos before " +
    "creating or updating them. The tool returns all currently stored todos, including their " +
    "unique IDs, content, status, and priority. Always use the returned todo IDs when referring " +
    "to or updating existing todos with TodoWrite.",
  schema,
  label: () => "Read Todos",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const todos: TodoItem[] = (ctx.todos?.todos ?? []).map((todo) => ({ ...todo }));
      return {
        ok: true,
        data: {
          todos,
          count: todos.length,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "todo_read_failed",
          message: `Error reading todo list: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
});