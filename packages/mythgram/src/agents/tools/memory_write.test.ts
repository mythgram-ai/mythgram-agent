import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { memoryWriteTool } from "./memory_write.js";
import { memoryReadTool } from "./memory_read.js";
import { createMemoryRuntime } from "../memory.js";
import type { MemoryFile, ToolContext } from "./types.js";

describe("memory_write tool", () => {
  const registry = new ToolRegistry().registerAll([memoryWriteTool, memoryReadTool]);

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

  it("is registered and selectable with path + content required", () => {
    assert.ok(registry.has("memory_write"));
    const schema = registry.schemas.find((s) => s.function.name === "memory_write");
    assert.ok(schema, "memory_write must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.path && props.content);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required.sort(), ["content", "path"]);
  });

  it("writes a memory file, emits memory_updated, and reads it back", async () => {
    const { ctx, events } = ctxFor();
    const write = await registry.execute("memory_write", { path: "USER.md", content: "Name: Ada" }, ctx);
    assert.equal(write.ok, true);
    assert.equal(events.at(-1)!.event, "memory_updated");

    const read = await registry.execute("memory_read", { path: "USER.md" }, ctx);
    assert.equal(read.ok, true);
    assert.equal((read.data as { content: string }).content, "Name: Ada");
  });

  it("canonicalizes pre-added file case (memory.md -> MEMORY.md)", async () => {
    const { ctx } = ctxFor();
    const write = await registry.execute("memory_write", { path: "/memory/memory.md", content: "hi" }, ctx);
    assert.equal((write.data as { path: string }).path, "MEMORY.md");
  });

  it("creates custom nested files with no char limit", async () => {
    const { ctx } = ctxFor();
    const big = "x".repeat(20_000);
    const write = await registry.execute("memory_write", { path: "projects/app.md", content: big }, ctx);
    assert.equal(write.ok, true);
    assert.equal((write.data as { char_limit?: number }).char_limit, undefined);
  });

  it("rejects a write that exceeds a pre-added file's char limit without applying it", async () => {
    const { ctx } = ctxFor();
    const tooBig = "a".repeat(2001);
    const result = await registry.execute("memory_write", { path: "SOUL.md", content: tooBig }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_char_limit_exceeded");
    assert.equal((result.error as unknown as { over_by: number }).over_by, 1);

    // The file must remain unchanged (empty).
    const read = await registry.execute("memory_read", { path: "SOUL.md" }, ctx);
    assert.equal((read.data as { content: string }).content, "");
  });

  it("rejects path traversal", async () => {
    const { ctx } = ctxFor();
    const result = await registry.execute("memory_write", { path: "../secrets.md", content: "x" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_invalid_path");
  });

  it("errors when the memory runtime is absent (e.g. sub-agent context)", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("memory_write", { path: "USER.md", content: "x" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(memoryWriteTool.label({ path: "USER.md", content: "x" }), "Memory: write USER.md");
  });
});
