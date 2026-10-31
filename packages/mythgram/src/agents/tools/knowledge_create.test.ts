import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { knowledgeCreateTool } from "./knowledge_create.js";
import { knowledgeReadTool } from "./knowledge_read.js";
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

describe("knowledge_create tool", () => {
  const registry = new ToolRegistry().registerAll([knowledgeCreateTool, knowledgeReadTool]);

  it("is registered with the documented required schema", () => {
    assert.ok(registry.has("knowledge_create"));
    const schema = registry.schemas.find((s) => s.function.name === "knowledge_create");
    assert.ok(schema);
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.knowledge_path && props.content);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual([...required].sort(), ["content", "knowledge_path"]);
  });

  it("creates a file, emits knowledge_updated, and reads it back", async () => {
    const { ctx, events } = ctxFor();
    const create = await registry.execute(
      "knowledge_create",
      { knowledge_path: "docs/api.md", content: "# API\nendpoints" },
      ctx,
    );
    assert.equal(create.ok, true);
    assert.equal((create.data as { created: boolean }).created, true);
    assert.equal(events.at(-1)!.event, "knowledge_updated");

    const read = await registry.execute("knowledge_read", { knowledge_path: "docs/api.md" }, ctx);
    assert.equal((read.data as { content: string }).content, "# API\nendpoints");
  });

  it("normalizes a /knowledge/-prefixed path", async () => {
    const { ctx } = ctxFor();
    const create = await registry.execute(
      "knowledge_create",
      { knowledge_path: "/knowledge/guide.md", content: "hi" },
      ctx,
    );
    assert.equal((create.data as { path: string }).path, "guide.md");
  });

  it("refuses to overwrite an existing file", async () => {
    const { ctx } = ctxFor([{ path: "a.md", content: "original" }]);
    const create = await registry.execute(
      "knowledge_create",
      { knowledge_path: "a.md", content: "new" },
      ctx,
    );
    assert.equal(create.ok, false);
    assert.equal((create.error as { code: string }).code, "knowledge_already_exists");
    // Original content is untouched.
    const read = await registry.execute("knowledge_read", { knowledge_path: "a.md" }, ctx);
    assert.equal((read.data as { content: string }).content, "original");
  });

  it("rejects path traversal", async () => {
    const { ctx } = ctxFor();
    const create = await registry.execute(
      "knowledge_create",
      { knowledge_path: "../escape.md", content: "x" },
      ctx,
    );
    assert.equal(create.ok, false);
    assert.equal((create.error as { code: string }).code, "knowledge_invalid_path");
  });

  it("has no default/pre-added files (base starts empty)", () => {
    const { runtime } = ctxFor();
    assert.equal(runtime.files.length, 0);
    assert.equal(runtime.firstMessageContext(), "");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      knowledgeCreateTool.label({ knowledge_path: "docs/x.md", content: "y" }),
      "Knowledge: create docs/x.md",
    );
  });
});
