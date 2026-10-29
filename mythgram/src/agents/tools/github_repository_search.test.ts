import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createToolRegistry, githubRepositorySearchTool } from "./index.js";
import { SUB_AGENT_RESTRICTED_TOOLS } from "./subAgentRestrictedTools.js";
import type { ToolContext } from "./types.js";

function baseCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, ...overrides };
}

interface RepoItem {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics: string[];
  updated_at: string;
  pushed_at: string;
  owner: { login: string };
  license: { spdx_id: string } | null;
}

function makeItem(i: number): RepoItem {
  return {
    full_name: `owner/repo-${i}`,
    html_url: `https://github.com/owner/repo-${i}`,
    description: `Repository number ${i}`,
    stargazers_count: 100 - i,
    forks_count: 10,
    open_issues_count: 3,
    language: "TypeScript",
    topics: ["ai", "agent"],
    updated_at: "2026-01-01T00:00:00Z",
    pushed_at: "2026-01-02T00:00:00Z",
    owner: { login: "owner" },
    license: { spdx_id: "MIT" },
  };
}

describe("github_repository_search tool", () => {
  let registry: ReturnType<typeof createToolRegistry>;
  let savedToken: string | undefined;

  before(() => {
    savedToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    registry = createToolRegistry();
  });

  after(() => {
    mock.restoreAll();
    if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedToken;
  });

  it("is registered and exposed to the LLM as a native function tool", () => {
    assert.ok(registry.has("github_repository_search"));
    const schema = registry.schemas.find((s) => s.function.name === "github_repository_search");
    assert.ok(schema, "github_repository_search must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.match(schema!.function.description, /GitHub/i);
    const params = schema!.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties?: boolean;
    };
    assert.equal(params.type, "object");
    assert.ok(params.properties.query, "query property must be declared");
    assert.deepEqual(params.required, ["query"]);
    assert.equal(params.additionalProperties, false);
  });

  it("is restricted from sub-agents (main/custom/team/CEO only)", () => {
    assert.ok(SUB_AGENT_RESTRICTED_TOOLS.includes("github_repository_search"));
  });

  it("rejects a missing or blank query via schema validation", async () => {
    const missing = await registry.execute("github_repository_search", {}, baseCtx());
    assert.equal(missing.ok, false);
    assert.equal((missing.error as { code: string }).code, "invalid_arguments");

    const blank = await registry.execute("github_repository_search", { query: "   " }, baseCtx());
    assert.equal(blank.ok, false);
    assert.equal((blank.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects extra properties because the schema is strict", async () => {
    const result = await registry.execute(
      "github_repository_search",
      { query: "agents", limit: 5 },
      baseCtx(),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("queries the GitHub search API and maps the results (capped at 30)", async () => {
    let calledUrl = "";
    let calledInit: RequestInit | undefined;
    mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
      calledUrl = String(input);
      calledInit = init;
      const items = Array.from({ length: 40 }, (_v, i) => makeItem(i));
      return new Response(
        JSON.stringify({ total_count: 1234, incomplete_results: false, items }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await registry.execute("github_repository_search", { query: "ai agent" }, baseCtx());
    assert.equal(result.ok, true, JSON.stringify(result.error));

    const url = new URL(calledUrl);
    assert.equal(url.origin + url.pathname, "https://api.github.com/search/repositories");
    assert.equal(url.searchParams.get("q"), "ai agent");
    assert.equal(url.searchParams.get("per_page"), "30");
    assert.equal((calledInit?.headers as Record<string, string>).Accept, "application/vnd.github+json");

    const data = result.data as {
      query: string;
      result_count: number;
      total_count: number;
      results: Array<Record<string, unknown>>;
    };
    assert.equal(data.query, "ai agent");
    assert.equal(data.results.length, 30);
    assert.equal(data.result_count, 30);
    assert.equal(data.total_count, 1234);
    assert.equal(data.results[0].full_name, "owner/repo-0");
    assert.equal(data.results[0].url, "https://github.com/owner/repo-0");
    assert.equal(data.results[0].stars, 100);
    assert.equal(data.results[0].language, "TypeScript");
    assert.equal(data.results[0].license, "MIT");
  });

  it("sends a bearer token when GITHUB_TOKEN is configured", async () => {
    process.env.GITHUB_TOKEN = "secret-token";
    let headers: Record<string, string> = {};
    mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
      headers = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({ total_count: 0, items: [] }), { status: 200 });
    });

    const result = await registry.execute("github_repository_search", { query: "x" }, baseCtx());
    assert.equal(result.ok, true);
    assert.equal(headers.Authorization, "Bearer secret-token");
    delete process.env.GITHUB_TOKEN;
  });

  it("returns a clear rate-limit error on HTTP 403", async () => {
    mock.method(globalThis, "fetch", async () =>
      new Response(JSON.stringify({ message: "API rate limit exceeded for 1.2.3.4." }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await registry.execute("github_repository_search", { query: "x" }, baseCtx());
    assert.equal(result.ok, false);
    const error = result.error as { code: string; status?: number };
    assert.equal(error.code, "github_rate_limited");
    assert.equal(error.status, 403);
  });

  it("returns a structured failure on other non-2xx responses", async () => {
    mock.method(globalThis, "fetch", async () =>
      new Response(JSON.stringify({ message: "Validation Failed" }), { status: 422 }),
    );

    const result = await registry.execute("github_repository_search", { query: "x" }, baseCtx());
    assert.equal(result.ok, false);
    const error = result.error as { code: string; status?: number };
    assert.equal(error.code, "github_search_failed");
    assert.equal(error.status, 422);
  });

  it("handles a network failure without throwing", async () => {
    mock.method(globalThis, "fetch", async () => {
      throw new Error("network down");
    });

    const result = await registry.execute("github_repository_search", { query: "x" }, baseCtx());
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "github_search_failed");
  });

  it("aborts cleanly when the turn signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });

    const result = await registry.execute(
      "github_repository_search",
      { query: "x" },
      baseCtx({ signal: controller.signal }),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "aborted");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      githubRepositorySearchTool.label({ query: "react" }),
      "GitHub Repository Search: react",
    );
  });
});
