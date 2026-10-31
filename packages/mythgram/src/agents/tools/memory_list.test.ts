import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { memoryListTool } from "./memory_list.js";
import { createMemoryRuntime } from "../memory.js";
import type { MemoryFile, ToolContext } from "./types.js";

describe("memory_list tool", () => {
  const registry = new ToolRegistry().registerAll([memoryListTool]);

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

  it("is registered and selectable by the LLM with an empty-object schema", () => {
    assert.ok(registry.has("memory_list"));
    const schema = registry.schemas.find((s) => s.function.name === "memory_list");
    assert.ok(schema, "memory_list must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.deepEqual(Object.keys(props), []);
    const required = (schema!.function.parameters.required as string[] | undefined) ?? [];
    assert.deepEqual(required, []);
  });

  it("always includes the three pre-added files with their limits", async () => {
    const { ctx } = ctxFor();
    const result = await registry.execute("memory_list", {}, ctx);
    assert.equal(result.ok, true);
    const data = result.data as {
      count: number;
      files: Array<{ path: string; char_limit?: number; preadded: boolean }>;
    };
    const byPath = Object.fromEntries(data.files.map((f) => [f.path, f]));
    assert.ok(byPath["MEMORY.md"] && byPath["SOUL.md"] && byPath["USER.md"]);
    assert.equal(byPath["MEMORY.md"]!.char_limit, 8000);
    assert.equal(byPath["SOUL.md"]!.char_limit, 2000);
    assert.equal(byPath["USER.md"]!.char_limit, 2000);
    assert.equal(byPath["MEMORY.md"]!.preadded, true);
  });

  it("returns a tree and a count reflecting custom files", async () => {
    const { ctx } = ctxFor([{ path: "projects/app.md", content: "x" }]);
    const result = await registry.execute("memory_list", {}, ctx);
    const data = result.data as { count: number; tree: string };
    assert.equal(data.count, 5); // 4 pre-added + 1 custom
    assert.ok(data.tree.includes("memory/"));
    assert.ok(data.tree.includes("app.md"));
  });

  it("errors when the memory runtime is absent (e.g. sub-agent context)", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("memory_list", {}, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(memoryListTool.label({}), "Memory: list");
  });
});
