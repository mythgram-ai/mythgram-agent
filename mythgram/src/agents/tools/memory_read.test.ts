import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { memoryReadTool } from "./memory_read.js";
import { createMemoryRuntime } from "../memory.js";
import type { MemoryFile, ToolContext } from "./types.js";

describe("memory_read tool", () => {
  const registry = new ToolRegistry().registerAll([memoryReadTool]);

  function ctxFor(initial: MemoryFile[] = []) {
    const runtime = createMemoryRuntime(initial);
    const ctx: ToolContext = {
      workspaceRoot: "/workspace",
      shellTimeoutMs: 10_000,
      memory: runtime,
    };
    return { ctx, runtime };
  }

  it("is registered with path required and limit/offset/return_line_number optional", () => {
    assert.ok(registry.has("memory_read"));
    const schema = registry.schemas.find((s) => s.function.name === "memory_read");
    assert.ok(schema, "memory_read must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.path && props.limit && props.offset && props.return_line_number);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required, ["path"]);
  });

  it("reads a file's full contents by exact path", async () => {
    const { ctx } = ctxFor([{ path: "MEMORY.md", content: "line1\nline2\nline3" }]);
    const read = await registry.execute("memory_read", { path: "MEMORY.md" }, ctx);
    assert.equal(read.ok, true);
    const data = read.data as { content: string; total_lines: number; truncated: boolean };
    assert.equal(data.content, "line1\nline2\nline3");
    assert.equal(data.total_lines, 3);
    assert.equal(data.truncated, false);
  });

  it("supports incremental reads with limit and offset", async () => {
    const { ctx } = ctxFor([{ path: "notes.md", content: "a\nb\nc\nd\ne" }]);
    const read = await registry.execute("memory_read", { path: "notes.md", offset: 2, limit: 2 }, ctx);
    const data = read.data as {
      content: string;
      line_count: number;
      first_line: number;
      last_line: number;
      truncated: boolean;
    };
    assert.equal(data.content, "b\nc");
    assert.equal(data.line_count, 2);
    assert.equal(data.first_line, 2);
    assert.equal(data.last_line, 3);
    assert.equal(data.truncated, true);
  });

  it("prefixes line numbers when return_line_number is true", async () => {
    const { ctx } = ctxFor([{ path: "notes.md", content: "x\ny" }]);
    const read = await registry.execute("memory_read", { path: "notes.md", return_line_number: true }, ctx);
    const data = read.data as { content: string };
    assert.equal(data.content, "1\tx\n2\ty");
  });

  it("reading an over-limit file works without error", async () => {
    // Simulates a legacy/over-limit file arriving from the browser; reads must never fail.
    const { ctx } = ctxFor([{ path: "SOUL.md", content: "z".repeat(5000) }]);
    const read = await registry.execute("memory_read", { path: "SOUL.md" }, ctx);
    assert.equal(read.ok, true);
    assert.equal((read.data as { content: string }).content.length, 5000);
  });

  it("returns a structured not-found error listing available paths", async () => {
    const { ctx } = ctxFor();
    const result = await registry.execute("memory_read", { path: "ghost.md" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_not_found");
    assert.ok(Array.isArray((result.error as unknown as { available_paths: string[] }).available_paths));
  });

  it("rejects path traversal", async () => {
    const { ctx } = ctxFor();
    const result = await registry.execute("memory_read", { path: "../secrets.md" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_invalid_path");
  });

  it("errors when the memory runtime is absent (e.g. sub-agent context)", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("memory_read", { path: "MEMORY.md" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      memoryReadTool.label({ path: "USER.md", return_line_number: false }),
      "Memory: read USER.md",
    );
  });
});
