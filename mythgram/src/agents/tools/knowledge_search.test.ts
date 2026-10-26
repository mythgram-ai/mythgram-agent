import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { knowledgeSearchTool } from "./knowledge_search.js";
import { createKnowledgeRuntime } from "../knowledge.js";
import type { KnowledgeFile, ToolContext } from "./types.js";

interface SearchMatch {
  line: number;
  content: string;
}

interface SearchResult {
  path: string;
  lines: number[];
  matches: SearchMatch[];
  preview: string;
}

interface SearchData {
  query: string;
  result_count: number;
  match_count: number;
  results: SearchResult[];
  message: string;
}

function ctxFor(initial: KnowledgeFile[] = []) {
  const runtime = createKnowledgeRuntime(initial);
  const ctx: ToolContext = {
    workspaceRoot: "/workspace",
    shellTimeoutMs: 10_000,
    knowledge: runtime,
  };
  return { ctx, runtime };
}

const ARCH = [
  "# Architecture", // 1
  "", // 2
  "The system uses a message bus for events.", // 3
  "Each service publishes to the bus.", // 4
  "The bus guarantees ordering.", // 5
].join("\n");

const MEMORY_DOC = [
  "# Memory tool", // 1
  "", // 2
  "Memory is stored in the browser.", // 3
  "The bus is unrelated here.", // 4
].join("\n");

describe("knowledge_search tool", () => {
  const registry = new ToolRegistry().registerAll([knowledgeSearchTool]);

  it("is registered with a single required `query` string param", () => {
    assert.ok(registry.has("knowledge_search"));
    const schema = registry.schemas.find((s) => s.function.name === "knowledge_search");
    assert.ok(schema, "knowledge_search must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.query);
    assert.deepEqual(schema!.function.parameters.required as string[], ["query"]);
  });

  it("returns paths, line numbers and the matching line content", async () => {
    const { ctx } = ctxFor([
      { path: "architecture.md", content: ARCH },
      { path: "tools/memory.md", content: MEMORY_DOC },
    ]);
    const res = await registry.execute("knowledge_search", { query: "bus" }, ctx);
    assert.equal(res.ok, true);
    const data = res.data as SearchData;
    assert.deepEqual(data.results, [
      {
        path: "knowledge/architecture.md",
        lines: [3, 4, 5],
        matches: [
          { line: 3, content: "The system uses a message bus for events." },
          { line: 4, content: "Each service publishes to the bus." },
          { line: 5, content: "The bus guarantees ordering." },
        ],
        preview:
          "LINE 3: The system uses a message bus for events.\n" +
          "LINE 4: Each service publishes to the bus.\n" +
          "LINE 5: The bus guarantees ordering.",
      },
      {
        path: "knowledge/tools/memory.md",
        lines: [4],
        matches: [{ line: 4, content: "The bus is unrelated here." }],
        preview: "LINE 4: The bus is unrelated here.",
      },
    ]);
    assert.equal(data.result_count, 2);
    assert.equal(data.match_count, 4);
  });

  it("matches case-insensitively and by individual terms of a multi-word query", async () => {
    const { ctx } = ctxFor([{ path: "architecture.md", content: ARCH }]);
    const res = await registry.execute("knowledge_search", { query: "Message Ordering" }, ctx);
    const data = res.data as SearchData;
    // line 3 has "message", line 5 has "ordering"
    assert.deepEqual(data.results, [
      {
        path: "knowledge/architecture.md",
        lines: [3, 5],
        matches: [
          { line: 3, content: "The system uses a message bus for events." },
          { line: 5, content: "The bus guarantees ordering." },
        ],
        preview:
          "LINE 3: The system uses a message bus for events.\n" +
          "LINE 5: The bus guarantees ordering.",
      },
    ]);
  });

  it("returns an empty result set (not an error) when nothing matches", async () => {
    const { ctx } = ctxFor([{ path: "architecture.md", content: ARCH }]);
    const res = await registry.execute("knowledge_search", { query: "kubernetes" }, ctx);
    assert.equal(res.ok, true);
    const data = res.data as SearchData;
    assert.deepEqual(data.results, []);
    assert.equal(data.result_count, 0);
  });

  it("rejects an empty query with a structured error", async () => {
    const { ctx } = ctxFor([{ path: "a.md", content: ARCH }]);
    const res = await registry.execute("knowledge_search", { query: "   " }, ctx);
    assert.equal(res.ok, false);
    assert.equal((res.error as { code: string }).code, "knowledge_search_query_required");
  });

  it("errors when the knowledge runtime is absent (sub-agent context)", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const res = await registry.execute("knowledge_search", { query: "bus" }, ctx);
    assert.equal((res.error as { code: string }).code, "knowledge_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(knowledgeSearchTool.label({ query: "bus" }), 'Knowledge: search "bus"');
  });
});
