import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { memorySearchTool } from "./memory_search.js";
import { createMemoryRuntime } from "../memory.js";
import type { MemoryFile, ToolContext } from "./types.js";

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

describe("memory_search tool", () => {
  const registry = new ToolRegistry().registerAll([memorySearchTool]);

  function ctxFor(initial: MemoryFile[] = []) {
    const runtime = createMemoryRuntime(initial);
    const ctx: ToolContext = {
      workspaceRoot: "/workspace",
      shellTimeoutMs: 10_000,
      memory: runtime,
    };
    return { ctx, runtime };
  }

  const USER = [
    "# User", // 1
    "", // 2
    "Name: Ada", // 3
    "Prefers TypeScript and concise answers.", // 4
    "Works on the mythgram project.", // 5
  ].join("\n");

  const PROJECT = [
    "# mythgram", // 1
    "", // 2
    "A local-first agent.", // 3
    "TypeScript everywhere.", // 4
  ].join("\n");

  it("is registered with a single required `query` string param", () => {
    assert.ok(registry.has("memory_search"));
    const schema = registry.schemas.find((s) => s.function.name === "memory_search");
    assert.ok(schema, "memory_search must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.query);
    assert.deepEqual(schema!.function.parameters.required as string[], ["query"]);
  });

  it("returns paths, line numbers and the matching line content", async () => {
    const { ctx } = ctxFor([
      { path: "USER.md", content: USER },
      { path: "projects/mythgram.md", content: PROJECT },
    ]);
    const res = await registry.execute("memory_search", { query: "typescript" }, ctx);
    assert.equal(res.ok, true);
    const data = res.data as SearchData;
    assert.deepEqual(data.results, [
      {
        path: "memory/USER.md",
        lines: [4],
        matches: [{ line: 4, content: "Prefers TypeScript and concise answers." }],
        preview: "LINE 4: Prefers TypeScript and concise answers.",
      },
      {
        path: "memory/projects/mythgram.md",
        lines: [4],
        matches: [{ line: 4, content: "TypeScript everywhere." }],
        preview: "LINE 4: TypeScript everywhere.",
      },
    ]);
    assert.equal(data.result_count, 2);
    assert.equal(data.match_count, 2);
  });

  it("matches case-insensitively and by individual terms of a multi-word query", async () => {
    const { ctx } = ctxFor([{ path: "USER.md", content: USER }]);
    const res = await registry.execute("memory_search", { query: "Ada Project" }, ctx);
    const data = res.data as SearchData;
    // line 3 has "ada", line 5 has "project"
    assert.deepEqual(data.results, [
      {
        path: "memory/USER.md",
        lines: [3, 5],
        matches: [
          { line: 3, content: "Name: Ada" },
          { line: 5, content: "Works on the mythgram project." },
        ],
        preview: "LINE 3: Name: Ada\nLINE 5: Works on the mythgram project.",
      },
    ]);
  });

  it("returns an empty result set (not an error) when nothing matches", async () => {
    const { ctx } = ctxFor([{ path: "USER.md", content: USER }]);
    const res = await registry.execute("memory_search", { query: "kubernetes" }, ctx);
    assert.equal(res.ok, true);
    const data = res.data as SearchData;
    assert.deepEqual(data.results, []);
    assert.equal(data.result_count, 0);
  });

  it("rejects an empty query with a structured error", async () => {
    const { ctx } = ctxFor([{ path: "USER.md", content: USER }]);
    const res = await registry.execute("memory_search", { query: "" }, ctx);
    assert.equal(res.ok, false);
    assert.equal((res.error as { code: string }).code, "memory_search_query_required");
  });

  it("errors when the memory runtime is absent (sub-agent context)", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const res = await registry.execute("memory_search", { query: "typescript" }, ctx);
    assert.equal((res.error as { code: string }).code, "memory_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(memorySearchTool.label({ query: "typescript" }), 'Memory: search "typescript"');
  });
});
