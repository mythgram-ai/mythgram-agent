import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { knowledgeListTool } from "./knowledge_list.js";
import { knowledgeCreateTool } from "./knowledge_create.js";
import { createKnowledgeRuntime } from "../knowledge.js";
import type { KnowledgeFile, ToolContext } from "./types.js";

function ctxFor(initial: KnowledgeFile[] = []) {
  const runtime = createKnowledgeRuntime(initial);
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const ctx: ToolContext = {
    workspaceRoot: "/workspace",
    shellTimeoutMs: 10_000,
    knowledge: runtime,
    emit: (event, data) => events.push({ event, data }),
  };
  return { ctx, events, runtime };
}

describe("knowledge_list tool", () => {
  const registry = new ToolRegistry().registerAll([knowledgeListTool, knowledgeCreateTool]);

  it("is registered and selectable by the LLM with an empty-object schema", () => {
    assert.ok(registry.has("knowledge_list"));
    const schema = registry.schemas.find((s) => s.function.name === "knowledge_list");
    assert.ok(schema, "knowledge_list must appear in the OpenAI tools array");
    const params = schema!.function.parameters as { properties?: Record<string, unknown>; required?: string[] };
    assert.deepEqual(params.properties ?? {}, {});
    assert.ok(!params.required || params.required.length === 0);
  });

  it("returns an empty base with a helpful message when there are no files", async () => {
    const { ctx } = ctxFor();
    const result = await registry.execute("knowledge_list", {}, ctx);
    assert.equal(result.ok, true);
    const data = result.data as { count: number; files: unknown[]; message: string };
    assert.equal(data.count, 0);
    assert.equal(data.files.length, 0);
    assert.match(data.message, /empty/i);
  });

  it("lists files with sizes and an ASCII tree", async () => {
    const { ctx } = ctxFor([
      { path: "docs/intro.md", content: "hello\nworld" },
      { path: "notes.md", content: "a" },
    ]);
    const result = await registry.execute("knowledge_list", {}, ctx);
    const data = result.data as {
      count: number;
      files: Array<{ path: string; chars: number; lines: number }>;
      tree: string;
    };
    assert.equal(data.count, 2);
    const byPath = Object.fromEntries(data.files.map((f) => [f.path, f]));
    assert.equal(byPath["docs/intro.md"]!.chars, "hello\nworld".length);
    assert.equal(byPath["docs/intro.md"]!.lines, 2);
    assert.ok(data.tree.includes("knowledge/"));
    assert.ok(data.tree.includes("docs/"));
  });

  it("reflects a freshly created file in a subsequent list", async () => {
    const { ctx } = ctxFor();
    await registry.execute("knowledge_create", { knowledge_path: "a.md", content: "x" }, ctx);
    const result = await registry.execute("knowledge_list", {}, ctx);
    const data = result.data as { count: number };
    assert.equal(data.count, 1);
  });

  it("errors when the knowledge runtime is absent (e.g. sub-agent context)", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("knowledge_list", {}, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "knowledge_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(knowledgeListTool.label({}), "Knowledge: list");
  });
});
