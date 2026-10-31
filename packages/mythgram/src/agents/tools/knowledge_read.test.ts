import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { knowledgeReadTool } from "./knowledge_read.js";
import { createKnowledgeRuntime } from "../knowledge.js";
import type { KnowledgeFile, ToolContext } from "./types.js";

function ctxFor(initial: KnowledgeFile[] = []) {
  const runtime = createKnowledgeRuntime(initial);
  const ctx: ToolContext = {
    workspaceRoot: "/workspace",
    shellTimeoutMs: 10_000,
    knowledge: runtime,
  };
  return { ctx, runtime };
}

const SAMPLE = ["line1", "line2", "line3", "line4", "line5"].join("\n");

describe("knowledge_read tool", () => {
  const registry = new ToolRegistry().registerAll([knowledgeReadTool]);

  it("is registered with knowledge_path required and limit/offset/return_line_number optional", () => {
    const schema = registry.schemas.find((s) => s.function.name === "knowledge_read");
    assert.ok(schema);
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.knowledge_path && props.limit && props.offset && props.return_line_number);
    assert.deepEqual(schema!.function.parameters.required as string[], ["knowledge_path"]);
  });

  it("reads the full file by default", async () => {
    const { ctx } = ctxFor([{ path: "a.md", content: SAMPLE }]);
    const read = await registry.execute("knowledge_read", { knowledge_path: "a.md" }, ctx);
    assert.equal(read.ok, true);
    const data = read.data as { content: string; total_lines: number; line_count: number };
    assert.equal(data.content, SAMPLE);
    assert.equal(data.total_lines, 5);
    assert.equal(data.line_count, 5);
  });

  it("honors offset + limit for an incremental read", async () => {
    const { ctx } = ctxFor([{ path: "a.md", content: SAMPLE }]);
    const read = await registry.execute(
      "knowledge_read",
      { knowledge_path: "a.md", offset: 2, limit: 2 },
      ctx,
    );
    const data = read.data as { content: string; first_line: number; last_line: number; truncated: boolean };
    assert.equal(data.content, "line2\nline3");
    assert.equal(data.first_line, 2);
    assert.equal(data.last_line, 3);
    assert.equal(data.truncated, true);
  });

  it("prefixes line numbers when return_line_number is true", async () => {
    const { ctx } = ctxFor([{ path: "a.md", content: SAMPLE }]);
    const read = await registry.execute(
      "knowledge_read",
      { knowledge_path: "a.md", offset: 3, limit: 1, return_line_number: true },
      ctx,
    );
    assert.equal((read.data as { content: string }).content, "3\tline3");
  });

  it("returns a structured not-found error listing available paths", async () => {
    const { ctx } = ctxFor([{ path: "a.md", content: "x" }]);
    const read = await registry.execute("knowledge_read", { knowledge_path: "ghost.md" }, ctx);
    assert.equal(read.ok, false);
    assert.equal((read.error as { code: string }).code, "knowledge_not_found");
    assert.deepEqual((read.error as unknown as { available_paths: string[] }).available_paths, ["a.md"]);
  });

  it("errors when the knowledge runtime is absent", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const read = await registry.execute("knowledge_read", { knowledge_path: "a.md" }, ctx);
    assert.equal((read.error as { code: string }).code, "knowledge_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(knowledgeReadTool.label({ knowledge_path: "a.md" }), "Knowledge: read a.md");
  });
});
