import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { memoryEditTool } from "./memory_edit.js";
import { createMemoryRuntime } from "../memory.js";
import type { MemoryFile, ToolContext } from "./types.js";

describe("memory_edit tool", () => {
  const registry = new ToolRegistry().registerAll([memoryEditTool]);

  function ctxFor(initial: MemoryFile[] = []) {
    const runtime = createMemoryRuntime(initial);
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const ctx: ToolContext = {
      workspaceRoot: "/workspace",
      shellTimeoutMs: 10_000,
      memory: runtime,
      emit: (event, data) => events.push({ event, data }),
    };
    return { ctx, events, runtime };
  }

  it("is registered with path + old_str + new_str required", () => {
    assert.ok(registry.has("memory_edit"));
    const schema = registry.schemas.find((s) => s.function.name === "memory_edit");
    assert.ok(schema, "memory_edit must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.path && props.old_str && props.new_str);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required.sort(), ["new_str", "old_str", "path"]);
  });

  it("edits with an exact match and emits memory_updated", async () => {
    const { ctx, events } = ctxFor([{ path: "MEMORY.md", content: "one two two" }]);
    const ok = await registry.execute("memory_edit", { path: "MEMORY.md", old_str: "one", new_str: "1" }, ctx);
    assert.equal(ok.ok, true);
    assert.equal((ok.data as { chars: number }).chars, "1 two two".length);
    assert.equal(events.at(-1)!.event, "memory_updated");
  });

  it("errors clearly on not-found and not-unique old_str", async () => {
    const { ctx } = ctxFor([{ path: "MEMORY.md", content: "one two two" }]);
    const notFound = await registry.execute("memory_edit", { path: "MEMORY.md", old_str: "three", new_str: "x" }, ctx);
    assert.equal((notFound.error as { code: string }).code, "memory_old_str_not_found");

    const notUnique = await registry.execute("memory_edit", { path: "MEMORY.md", old_str: "two", new_str: "x" }, ctx);
    assert.equal((notUnique.error as { code: string }).code, "memory_old_str_not_unique");
  });

  it("removes matched text when new_str is empty", async () => {
    const { ctx } = ctxFor([{ path: "notes.md", content: "keep DROP" }]);
    const ok = await registry.execute("memory_edit", { path: "notes.md", old_str: " DROP", new_str: "" }, ctx);
    assert.equal(ok.ok, true);
    assert.equal((ok.data as { chars: number }).chars, "keep".length);
  });

  it("rejects an edit that would push the file over its limit", async () => {
    const { ctx } = ctxFor([{ path: "SOUL.md", content: "a".repeat(1990) }]);
    const result = await registry.execute(
      "memory_edit",
      { path: "SOUL.md", old_str: "a".repeat(1990), new_str: "b".repeat(2001) },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_char_limit_exceeded");
  });

  it("returns a structured not-found error when the file does not exist", async () => {
    const { ctx } = ctxFor();
    const result = await registry.execute("memory_edit", { path: "ghost.md", old_str: "a", new_str: "b" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_not_found");
  });

  it("errors when the memory runtime is absent (e.g. sub-agent context)", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("memory_edit", { path: "MEMORY.md", old_str: "a", new_str: "b" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      memoryEditTool.label({ path: "MEMORY.md", old_str: "a", new_str: "b" }),
      "Memory: edit MEMORY.md",
    );
  });
});
