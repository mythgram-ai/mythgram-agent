import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { memoryDeleteTool } from "./memory_delete.js";
import { memoryListTool } from "./memory_list.js";
import { createMemoryRuntime } from "../memory.js";
import type { MemoryFile, ToolContext } from "./types.js";

describe("memory_delete tool", () => {
  const registry = new ToolRegistry().registerAll([memoryDeleteTool, memoryListTool]);

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

  it("is registered with path required", () => {
    assert.ok(registry.has("memory_delete"));
    const schema = registry.schemas.find((s) => s.function.name === "memory_delete");
    assert.ok(schema, "memory_delete must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.path);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required, ["path"]);
  });

  it("deletes a custom file and emits memory_updated", async () => {
    const { ctx, events } = ctxFor([{ path: "notes.md", content: "temp" }]);
    const deleted = await registry.execute("memory_delete", { path: "notes.md" }, ctx);
    assert.equal(deleted.ok, true);
    assert.equal((deleted.data as { deleted: boolean }).deleted, true);
    assert.equal(events.at(-1)!.event, "memory_updated");

    const list = await registry.execute("memory_list", {}, ctx);
    const paths = (list.data as { files: Array<{ path: string }> }).files.map((f) => f.path);
    assert.ok(!paths.includes("notes.md"));
  });

  it("refuses to delete a pre-added file with a structured error", async () => {
    const { ctx } = ctxFor();
    const forbidden = await registry.execute("memory_delete", { path: "MEMORY.md" }, ctx);
    assert.equal(forbidden.ok, false);
    assert.equal((forbidden.error as { code: string }).code, "memory_delete_forbidden");
  });

  it("returns a structured not-found error for an unknown file", async () => {
    const { ctx } = ctxFor();
    const result = await registry.execute("memory_delete", { path: "ghost.md" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_not_found");
  });

  it("rejects path traversal", async () => {
    const { ctx } = ctxFor();
    const result = await registry.execute("memory_delete", { path: "../secrets.md" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_invalid_path");
  });

  it("errors when the memory runtime is absent (e.g. sub-agent context)", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("memory_delete", { path: "notes.md" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "memory_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(memoryDeleteTool.label({ path: "notes.md" }), "Memory: delete notes.md");
  });
});
