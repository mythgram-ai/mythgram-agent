import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { knowledgeDeleteTool } from "./knowledge_delete.js";
import { knowledgeListTool } from "./knowledge_list.js";
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

describe("knowledge_delete tool", () => {
  const registry = new ToolRegistry().registerAll([knowledgeDeleteTool, knowledgeListTool]);

  it("is registered with knowledge_path required", () => {
    const schema = registry.schemas.find((s) => s.function.name === "knowledge_delete");
    assert.ok(schema);
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.knowledge_path);
    assert.deepEqual(schema!.function.parameters.required as string[], ["knowledge_path"]);
  });

  it("deletes an existing file, emits knowledge_updated, and drops it from the list", async () => {
    const { ctx, events } = ctxFor([
      { path: "a.md", content: "x" },
      { path: "b.md", content: "y" },
    ]);
    const del = await registry.execute("knowledge_delete", { knowledge_path: "a.md" }, ctx);
    assert.equal(del.ok, true);
    assert.equal((del.data as { deleted: boolean }).deleted, true);
    assert.equal(events.at(-1)!.event, "knowledge_updated");

    const list = await registry.execute("knowledge_list", {}, ctx);
    const paths = (list.data as { files: Array<{ path: string }> }).files.map((f) => f.path);
    assert.deepEqual(paths, ["b.md"]);
  });

  it("errors with a structured not-found when the file is missing", async () => {
    const { ctx } = ctxFor([{ path: "a.md", content: "x" }]);
    const del = await registry.execute("knowledge_delete", { knowledge_path: "ghost.md" }, ctx);
    assert.equal(del.ok, false);
    assert.equal((del.error as { code: string }).code, "knowledge_not_found");
  });

  it("rejects an invalid/traversing path", async () => {
    const { ctx } = ctxFor();
    const del = await registry.execute("knowledge_delete", { knowledge_path: "../../etc/passwd" }, ctx);
    assert.equal((del.error as { code: string }).code, "knowledge_invalid_path");
  });

  it("errors when the knowledge runtime is absent", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const del = await registry.execute("knowledge_delete", { knowledge_path: "a.md" }, ctx);
    assert.equal((del.error as { code: string }).code, "knowledge_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(knowledgeDeleteTool.label({ knowledge_path: "a.md" }), "Knowledge: delete a.md");
  });
});
