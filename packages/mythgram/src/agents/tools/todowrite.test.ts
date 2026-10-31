import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { todoWriteTool } from "./todowrite.js";
import { readTodosTool } from "./todoread.js";
import { createTodoRuntime } from "../todos.js";
import type { ToolContext, TodoItem } from "./types.js";

describe("TodoWrite tool", () => {
  let registry: ToolRegistry;
  let events: Array<{ event: string; data: Record<string, unknown> }>;

  before(() => {
    registry = new ToolRegistry().registerAll([todoWriteTool, readTodosTool]);
  });

  function runtimeFor(initial: TodoItem[] = []) {
    const runtime = createTodoRuntime(initial);
    events = [];
    const ctx: ToolContext = {
      workspaceRoot: "/workspace",
      shellTimeoutMs: 10_000,
      todos: runtime,
      emit: (event, data) => events.push({ event, data }),
    };
    return ctx;
  }

  const sampleTodos: TodoItem[] = [
    { id: "1", content: "Write tests", status: "pending", priority: "high" },
    { id: "2", content: "Commit changes", status: "in_progress", priority: "medium" },
  ];

  it("is registered and selectable by the LLM alongside existing tools", () => {
    assert.ok(registry.has("TodoWrite"));
    const schema = registry.schemas.find((s) => s.function.name === "TodoWrite");
    assert.ok(schema, "TodoWrite must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.todos, "todos property must be declared");
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required, ["todos"]);
  });

  it("writes the full todo list and emits it so the browser can persist it", async () => {
    const ctx = runtimeFor();
    const result = await registry.execute("TodoWrite", { todos: sampleTodos }, ctx);

    assert.equal(result.ok, true);
    const data = result.data as { todos: TodoItem[]; count: number; message: string };
    assert.equal(data.count, 2);
    assert.deepEqual(data.todos, sampleTodos);
    assert.ok(data.message.includes("Todos have been modified"));

    assert.equal(events.length, 1);
    assert.equal(events[0]!.event, "todo_updated");
    assert.deepEqual(events[0]!.data.todos, sampleTodos);

    // read_todos afterwards reflects the freshly written list (same runtime).
    const readResult = await registry.execute("read_todos", {}, ctx);
    assert.equal(readResult.ok, true);
    assert.deepEqual((readResult.data as { todos: TodoItem[] }).todos, sampleTodos);
  });

  it("replaces the whole list (dropped todos are removed, kept ones preserved)", async () => {
    const ctx = runtimeFor(sampleTodos);
    const updated: TodoItem[] = [
      { ...sampleTodos[0]!, status: "completed" },
      { id: "3", content: "New todo", status: "pending", priority: "low" },
    ];
    const result = await registry.execute("TodoWrite", { todos: updated }, ctx);
    assert.equal(result.ok, true);
    assert.deepEqual((result.data as { todos: TodoItem[] }).todos, updated);
  });

  it("adds, updates status/priority/content, and preserves untouched todos", async () => {
    const ctx = runtimeFor(sampleTodos);
    const updated: TodoItem[] = [
      sampleTodos[0]!, // untouched — preserved as-is
      { ...sampleTodos[1]!, status: "completed", priority: "high" },
      { id: "4", content: "Review PR", status: "pending", priority: "medium" },
    ];
    const result = await registry.execute("TodoWrite", { todos: updated }, ctx);
    assert.equal(result.ok, true);
    assert.deepEqual((result.data as { todos: TodoItem[] }).todos, updated);
  });

  it("returns an empty list (no error) when cleared", async () => {
    const ctx = runtimeFor(sampleTodos);
    const result = await registry.execute("TodoWrite", { todos: [] }, ctx);
    assert.equal(result.ok, true);
    assert.deepEqual((result.data as { todos: TodoItem[] }).todos, []);
    assert.equal((result.data as { count: number }).count, 0);
  });

  it("normalizes input the schema allows (empty ids regenerated, duplicates dropped)", async () => {
    const ctx = runtimeFor();
    const result = await registry.execute(
      "TodoWrite",
      {
        todos: [
          { id: "a", content: "ok", status: "pending", priority: "high" },
          { id: "dup", content: "first", status: "in_progress", priority: "low" },
          { id: "dup", content: "duplicate", status: "completed", priority: "high" },
          { id: "", content: "", status: "completed", priority: "high" }, // empty id -> generated
        ],
      },
      ctx,
    );
    assert.equal(result.ok, true);
    const todos = (result.data as { todos: TodoItem[] }).todos;
    assert.equal(todos.length, 3); // duplicate id dropped, empty id regenerated
    assert.equal(todos[0]!.id, "a");
    assert.equal(todos[1]!.status, "in_progress");
    assert.ok(todos[2]!.id.length > 0 && todos[2]!.id !== "dup", "empty id must be generated");
  });

  it("rejects malformed todos (missing id / bad status / bad priority) via schema validation", async () => {
    const missingId = await registry.execute(
      "TodoWrite",
      { todos: [{ content: "no id", status: "pending", priority: "high" }] },
      runtimeFor(),
    );
    assert.equal(missingId.ok, false);
    assert.equal((missingId.error as { code: string }).code, "invalid_arguments");

    const badStatus = await registry.execute(
      "TodoWrite",
      { todos: [{ id: "x", content: "bad", status: "bogus", priority: "high" }] },
      runtimeFor(),
    );
    assert.equal(badStatus.ok, false);
    assert.equal((badStatus.error as { code: string }).code, "invalid_arguments");

    const badPriority = await registry.execute(
      "TodoWrite",
      { todos: [{ id: "x", content: "bad", status: "pending", priority: "urgent" }] },
      runtimeFor(),
    );
    assert.equal(badPriority.ok, false);
    assert.equal((badPriority.error as { code: string }).code, "invalid_arguments");

    const nonObject = await registry.execute(
      "TodoWrite",
      { todos: ["nope", 42] },
      runtimeFor(),
    );
    assert.equal(nonObject.ok, false);
    assert.equal((nonObject.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects a missing required argument via schema validation", async () => {
    const result = await registry.execute("TodoWrite", {} as Record<string, unknown>, runtimeFor());
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects todos over the maximum count", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => ({
      id: String(i),
      content: `todo ${i}`,
      status: "pending",
      priority: "low",
    }));
    const result = await registry.execute("TodoWrite", { todos: tooMany }, runtimeFor());
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("handles a missing todo runtime gracefully (still returns the normalized list)", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("TodoWrite", { todos: sampleTodos }, ctx);
    assert.equal(result.ok, true);
    assert.deepEqual((result.data as { todos: TodoItem[] }).todos, sampleTodos);
  });

  it("exposes a clear UI label", () => {
    assert.equal(todoWriteTool.label({ todos: sampleTodos }), "Write Todos (2)");
  });
});