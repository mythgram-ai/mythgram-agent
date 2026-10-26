import type { TodoItem, TodoRuntime, ToolContext } from "./tools/types.js";

/**
 * Build the TodoRuntime bound to a single main-agent turn. The returned object is injected into
 * the ToolContext so TodoWrite / read_todos can read and update the user's todo list. Todos live
 * in the SQLite database (and browser runtime state) and travel with each turn; the runtime keeps a per-turn
 * mutable snapshot so reads/writes within the same turn see consistent state.
 */
export function createTodoRuntime(definitions: TodoItem[]): TodoRuntime {
  const runner = new TodoRunner(definitions);
  return {
    get todos(): TodoItem[] {
      return runner.list();
    },
    write: (todos, ctx) => runner.write(todos, ctx),
  };
}

class TodoRunner {
  private current: TodoItem[] = [];

  constructor(initial: TodoItem[]) {
    this.current = normalizeTodos(initial);
  }

  /** The current todo list. */
  list(): TodoItem[] {
    return this.current.map((todo) => ({ ...todo }));
  }

  /**
   * Replace the whole todo list, emit the updated list to the frontend so it can be persisted to
   * the user's browser, and return the new list. Existing todos that are not intentionally changed
   * are preserved by the caller — this snapshot simply becomes the new authoritative list.
   */
  write(todos: TodoItem[], ctx: ToolContext): TodoItem[] {
    const next = normalizeTodos(todos);
    this.current = next;
    ctx.emit?.("todo_updated", { todos: next });
    return this.list();
  }
}

const TODO_STATUSES = new Set(["pending", "in_progress", "completed"]);
const TODO_PRIORITIES = new Set(["low", "medium", "high"]);

/**
 * Defensively coerce arbitrary input into a well-typed todo list: arrays are filtered, unknown
 * status/priority values fall back to `pending`/`medium`, blank ids are regenerated, duplicate ids
 * are de-duplicated (first occurrence wins), and blank content is preserved as-is so the LLM can see
 * it and fix it. Never throws.
 */
export function normalizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TodoItem[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    let id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) id = `todo_${Date.now().toString(36)}_${out.length}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const status = typeof record.status === "string" && TODO_STATUSES.has(record.status)
      ? (record.status as TodoItem["status"])
      : "pending";
    const priority = typeof record.priority === "string" && TODO_PRIORITIES.has(record.priority)
      ? (record.priority as TodoItem["priority"])
      : "medium";

    out.push({
      id,
      content: typeof record.content === "string" ? record.content : "",
      status,
      priority,
    });
  }
  return out;
}