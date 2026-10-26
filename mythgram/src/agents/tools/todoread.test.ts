import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { todoWriteTool } from "./todowrite.js";
import { readTodosTool } from "./todoread.js";
import { createTodoRuntime } from "../todos.js";
import type { ToolContext, TodoItem } from "./types.js";

describe("read_todos tool", () => {
  let registry: ToolRegistry;

  before(() => {
    registry = new ToolRegistry().registerAll([todoWriteTool, readTodosTool]);
  });

  function ctxFor(todos: TodoItem[] = []): { ctx: ToolContext; events: unknown[] } {
    const events: unknown[] = [];
    const runtime = createTodoRuntime(todos);
    const ctx: ToolContext = {
      workspaceRoot: "/workspace",
      shellTimeoutMs: 10_000,
      todos: runtime,
      emit: (event, data) => events.push({ event, data }),
    };
    return { ctx, events };
  }

  it("is registered and selectable by the LLM alongside existing tools", () => {
    assert.ok(registry.has("read_todos"));
    const schema = registry.schemas.find((s) => s.function.name === "read_todos");
    assert.ok(schema, "read_todos must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
  });

  it("returns existing todos with id/content/status/priority", async () => {
    const todos: TodoItem[] = [
      { id: "1", content: "Plan feature", status: "in_progress", priority: "high" },
      { id: "2", content: "Ship it", status: "pending", priority: "medium" },
    ];
    const { ctx } = ctxFor(todos);
    const result = await registry.execute("read_todos", {}, ctx);
    assert.equal(result.ok, true);
    const data = result.data as { todos: TodoItem[]; count: number };
    assert.equal(data.count, 2);
    assert.deepEqual(data.todos, todos);
  });

  it("returns an empty todos array (no error) when there are no todos", async () => {
    const { ctx } = ctxFor([]);
    const result = await registry.execute("read_todos", {}, ctx);
    assert.equal(result.ok, true);
    const data = result.data as { todos: TodoItem[]; count: number };
    assert.deepEqual(data.todos, []);
    assert.equal(data.count, 0);
  });

  it("is read-only: does not modify or delete todos and emits nothing", async () => {
    const todos: TodoItem[] = [{ id: "x", content: "Keep me", status: "pending", priority: "low" }];
    const { ctx, events } = ctxFor(todos);
    const result = await registry.execute("read_todos", {}, ctx);
    assert.equal(result.ok, true);
    assert.deepEqual((result.data as { todos: TodoItem[] }).todos, todos);
    assert.deepEqual(events, [], "read_todos must not emit any events");
    // A subsequent read is unchanged — the list was not mutated.
    const again = await registry.execute("read_todos", {}, ctx);
    assert.deepEqual((again.data as { todos: TodoItem[] }).todos, todos);
  });

  it("always returns the todo IDs so the LLM can update those todos", async () => {
    const { ctx } = ctxFor([{ id: "abc", content: "Use id", status: "completed", priority: "high" }]);
    const result = await registry.execute("read_todos", {}, ctx);
    const todos = (result.data as { todos: TodoItem[] }).todos;
    assert.equal(todos[0]!.id, "abc");
    assert.ok(typeof todos[0]!.id === "string" && todos[0]!.id.length > 0);
  });

  it("reads from the same storage as TodoWrite within a turn", async () => {
    const { ctx } = ctxFor([]);
    await registry.execute(
      "TodoWrite",
      {
        todos: [{ id: "99", content: "After write", status: "in_progress", priority: "medium" }],
      },
      ctx,
    );
    const result = await registry.execute("read_todos", {}, ctx);
    assert.deepEqual((result.data as { todos: TodoItem[] }).todos, [
      { id: "99", content: "After write", status: "in_progress", priority: "medium" },
    ]);
  });

  it("returns an empty list (no error) when no todo runtime is present", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("read_todos", {}, ctx);
    assert.equal(result.ok, true);
    assert.deepEqual((result.data as { todos: TodoItem[] }).todos, []);
  });

  it("exposes a clear UI label", () => {
    assert.equal(readTodosTool.label({}), "Read Todos");
  });
});