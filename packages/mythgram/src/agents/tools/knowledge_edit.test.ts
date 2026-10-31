import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { knowledgeEditTool } from "./knowledge_edit.js";
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

describe("knowledge_edit tool", () => {
  const registry = new ToolRegistry().registerAll([knowledgeEditTool, knowledgeReadTool]);

  it("is registered with the documented required schema", () => {
    const schema = registry.schemas.find((s) => s.function.name === "knowledge_edit");
    assert.ok(schema);
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.knowledge_path && props.old_str && props.new_str);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual([...required].sort(), ["knowledge_path", "new_str", "old_str"]);
  });

  it("edits with an exact match and emits knowledge_updated", async () => {
    const { ctx, events } = ctxFor([{ path: "a.md", content: "one two three" }]);
    const edit = await registry.execute(
      "knowledge_edit",
      { knowledge_path: "a.md", old_str: "two", new_str: "TWO" },
      ctx,
    );
    assert.equal(edit.ok, true);
    assert.equal(events.at(-1)!.event, "knowledge_updated");
    const read = await registry.execute("knowledge_read", { knowledge_path: "a.md" }, ctx);
    assert.equal((read.data as { content: string }).content, "one TWO three");
  });

  it("removes matched text when new_str is empty", async () => {
    const { ctx } = ctxFor([{ path: "a.md", content: "keep DROP keep" }]);
    const edit = await registry.execute(
      "knowledge_edit",
      { knowledge_path: "a.md", old_str: " DROP", new_str: "" },
      ctx,
    );
    assert.equal(edit.ok, true);
    const read = await registry.execute("knowledge_read", { knowledge_path: "a.md" }, ctx);
    assert.equal((read.data as { content: string }).content, "keep keep");
  });

  it("errors clearly on not-found and not-unique matches", async () => {
    const { ctx } = ctxFor([{ path: "a.md", content: "x y y z" }]);
    const notFound = await registry.execute(
      "knowledge_edit",
      { knowledge_path: "a.md", old_str: "q", new_str: "1" },
      ctx,
    );
    assert.equal((notFound.error as { code: string }).code, "knowledge_old_str_not_found");

    const notUnique = await registry.execute(
      "knowledge_edit",
      { knowledge_path: "a.md", old_str: "y", new_str: "1" },
      ctx,
    );
    assert.equal((notUnique.error as { code: string }).code, "knowledge_old_str_not_unique");
    assert.equal((notUnique.error as unknown as { occurrences: number }).occurrences, 2);
  });

  it("errors when editing a file that does not exist", async () => {
    const { ctx } = ctxFor();
    const edit = await registry.execute(
      "knowledge_edit",
      { knowledge_path: "missing.md", old_str: "a", new_str: "b" },
      ctx,
    );
    assert.equal((edit.error as { code: string }).code, "knowledge_not_found");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      knowledgeEditTool.label({ knowledge_path: "a.md", old_str: "x", new_str: "y" }),
      "Knowledge: edit a.md",
    );
  });
});
