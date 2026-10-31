import { z } from "zod";
import {
  defineTool,
  type TodoItem,
  type ToolContext,
  type ToolResult,
} from "./types.js";
import { normalizeTodos } from "../todos.js";

const STATUS_VALUES = ["pending", "in_progress", "completed"] as const;
const PRIORITY_VALUES = ["low", "medium", "high"] as const;

const schema = z.object({
  todos: z
    .array(
      z.object({
        id: z.string().describe("Unique string identifier for the todo."),
        content: z
          .string()
          .describe("Clear description of the task. Keep it concise and actionable."),
        status: z
          .enum(STATUS_VALUES)
          .describe("Current state of the todo: 'pending', 'in_progress', or 'completed'."),
        priority: z
          .enum(PRIORITY_VALUES)
          .describe("Importance of the todo: 'low', 'medium', or 'high'."),
      }),
    )
    .min(0)
    .max(200, "A todo list cannot contain more than 200 todos.")
    .describe(
      "The complete, updated todo list. This array represents the entire todo list after the " +
        "change — every todo you want to keep must be included here. Add new todos, update " +
        "existing ones (change their content, status, or priority), or drop ones that are no " +
        "longer relevant. Todos not present in this array are removed from the list.",
    ),
});

/**
 * Create, update, and maintain the user's structured task list for the current coding session.
 *
 * The `todos` array is the COMPLETE new todo list. Each todo must carry an `id`, `content`,
 * `status` (pending | in_progress | completed), and `priority` (low | medium | high). Pass only the
 * list you want to be authoritative: this tool replaces the stored list wholesale, so any existing
 * todo you wish to preserve MUST be included in `todos` (unchanged or updated) — otherwise it is
 * dropped. The updated list is persisted to the user's browser and surfaced in the UI so the user
 * can track progress.
 */
export const todoWriteTool = defineTool({
  name: "TodoWrite",
  description:
    "Use this tool to create and manage a structured task list for your current coding session. " +
    "It helps you track progress, organize complex tasks, and keep the user informed of overall " +
    "progress. Use it proactively for multi-step tasks (3 or more distinct steps), non-trivial " +
    "tasks needing careful planning, or whenever the user asks you to track work. Each todo must " +
    "have an id, content, status (pending, in_progress, or completed), and priority (low, medium, " +
    "or high). The `todos` array you pass is the COMPLETE updated list — add new todos, update " +
    "existing ones, or remove completed ones. Any existing todo you want to keep must be included " +
    "in the array you pass; call read_todos first to see the current list and its ids when " +
    "updating, and always reuse the returned ids for existing todos.",
  schema,
  label: (args) => `Write Todos (${args.todos.length})`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const next = normalizeTodos(args.todos);
      const todos: TodoItem[] = ctx.todos?.write(next, ctx) ?? next;

      return {
        ok: true,
        data: {
          todos,
          count: todos.length,
          message:
            "Todos have been modified successfully. Ensure that you continue to use the todo " +
            "list to track your progress. Please proceed with the current tasks if applicable.",
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "todo_write_failed",
          message: `Error updating todo list: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
});