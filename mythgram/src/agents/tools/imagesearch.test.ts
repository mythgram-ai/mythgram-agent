import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_SEARCH_PROVIDER_DUCKDUCKGO,
  IMAGE_SEARCH_PROVIDER_EXA,
  IMAGE_SEARCH_PROVIDER_SERPAPI,
  IMAGE_SEARCH_PROVIDER_TAVILY,
} from "./imagesearch.js";
import { createToolRegistry, webSearchTool } from "./index.js";
import type { ToolContext } from "./types.js";

function baseCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, ...overrides };
}

interface CallLog {
  url: string;
  init?: RequestInit;
}

describe("image_search tool", () => {
  let registry: ReturnType<typeof createToolRegistry>;

  before(() => {
    registry = createToolRegistry();
  });

  after(() => {
    mock.restoreAll();
  });

  it("is registered in the default tool registry and discoverable by the LLM", () => {
    assert.equal(registry.has("image_search"), true);
    const schemas = registry.schemas;
    const schema = schemas.find((s) => s.function.name === "image_search");
    assert.ok(schema, "image_search schema missing from registry");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.name, "image_search");
    assert.match(schema!.function.description, /image/i);
    const params = schema!.function.parameters as Record<string, unknown>;
    assert.equal(params.type, "object");
    const properties = params.properties as Record<string, unknown>;
    assert.ok(properties.query, "query property missing");
    assert.equal((params.required as string[]).includes("query"), true);
    assert.equal((params.additionalProperties ?? true), false);
  });

  it("keeps web_search alongside image_search without clobbering it", () => {
    assert.equal(registry.has("web_search"), true);
    assert.equal(registry.get("web_search"), webSearchTool);
  });

  it("rejects an empty query with a structured error (no crash)", async () => {
    const ctx = baseCtx({ web: { searchProvider: "serpapi", serpapiApiKey: "k" } });
    const result = await registry.execute("image_search", { query: "   " }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "missing_query");
  });

  it("rejects a missing query argument via zod safely (invalid_arguments)", async () => {
    const ctx = baseCtx({ web: { searchProvider: "serpapi", serpapiApiKey: "k" } });
    const result = await registry.execute("image_search", {}, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects extra properties because the schema is strict", async () => {
    const ctx = baseCtx({ web: { searchProvider: "serpapi", serpapiApiKey: "k" } });
    const result = await registry.execute(
      "image_search",
      { query: "cats", bogus_param: true },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("falls back to the free DuckDuckGo provider when no search API key is configured", async () => {
    const calls: CallLog[] = [];
    mock.method(globalThis, "fetch", async (input: unknown) => {
      calls.push({ url: String(input) });
      const url = String(input);
      // First call: the DuckDuckGo image page (extracts vqd). Next: the i.js JSON endpoint.
      if (url.includes("i.js")) {
        return new Response(
          JSON.stringify({
            results: [{ image: "https://cdn.example.com/ddg-1.jpg", title: "Ddg", url: "https://example.com/p" }],
          }),
          { status: 200 },
        );
      }
      return new Response('<html>vqd="42-123456789"</html>', { status: 200 });
    });

    const ctx = baseCtx({ web: { searchProvider: "serpapi" } });
    const result = await registry.execute("image_search", { query: "dogs" }, ctx);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as { provider: string; results: Array<{ image_url: string }> };
    assert.equal(data.provider, IMAGE_SEARCH_PROVIDER_DUCKDUCKGO);
    assert.equal(data.results[0].image_url, "https://cdn.example.com/ddg-1.jpg");
    mock.restoreAll();
  });

  it("performs a live image search and returns real direct image URLs", async () => {
    const calls: CallLog[] = [];
    const title = "A Cute Cat";
    const link = "https://example.com/cat-page";
    const original = "https://cdn.example.com/images/cat.jpg";

    mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const body = JSON.stringify({
        images_results: [
          { title, link, original },
          { title: "Thumbnail Only", link: "https://example.com/t", thumbnail: "https://cdn.example.com/t.webp" },
          { title: "No Image", link: "https://example.com/no-image" },
        ],
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const ctx = baseCtx({ web: { searchProvider: "serpapi", serpapiApiKey: "test-key" } });
    const result = await registry.execute("image_search", { query: "cute cat images" }, ctx);

    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as {
      query: string;
      provider: string;
      result_count: number;
      results: Array<{ title?: string; image_url?: string; source_url?: string }>;
    };
    assert.equal(data.query, "cute cat images");
    assert.equal(data.provider, IMAGE_SEARCH_PROVIDER_SERPAPI);
    assert.equal(data.result_count, 2); // the "No Image" result is filtered out
    assert.equal(data.results.length, 2);

    assert.equal(data.results[0].title, title);
    assert.equal(data.results[0].image_url, original);
    assert.equal(data.results[0].source_url, link);

    assert.equal(data.results[1].image_url, "https://cdn.example.com/t.webp");

    assert.equal(calls.length, 1);
    const parsed = new URL(calls[0]!.url);
    assert.equal(parsed.searchParams.get("engine"), "google_images");
    assert.equal(parsed.searchParams.get("q"), "cute cat images");
    assert.equal(parsed.searchParams.get("api_key"), "test-key");

    mock.restoreAll();
  });

  it("searches through the Tavily provider and returns real image URLs", async () => {
    const calls: CallLog[] = [];
    mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const body = JSON.stringify({
        images: [{ url: "https://cdn.example.com/q1.jpg", description: "Query image" }],
        results: [
          {
            title: "Cat Blog",
            url: "https://example.com/cats",
            images: [
              { url: "https://cdn.example.com/s1.jpg", description: "Site kitten" },
              { url: "https://cdn.example.com/s2.webp" },
            ],
          },
          { title: "No Images Page", url: "https://example.com/none" },
        ],
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const ctx = baseCtx({ web: { searchProvider: "tavily", tavilyApiKey: "tv-key" } });
    const result = await registry.execute("image_search", { query: "cute cats" }, ctx);

    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as {
      provider: string;
      result_count: number;
      results: Array<{ image_url: string; source_url?: string; title?: string }>;
    };
    assert.equal(data.provider, IMAGE_SEARCH_PROVIDER_TAVILY);
    assert.equal(data.result_count, 3);
    assert.deepEqual(
      data.results.map((r) => r.image_url),
      [
        "https://cdn.example.com/s1.jpg",
        "https://cdn.example.com/s2.webp",
        "https://cdn.example.com/q1.jpg",
      ],
    );
    assert.equal(data.results[0].source_url, "https://example.com/cats");
    assert.equal(data.results[0].title, "Site kitten");

    assert.equal(calls.length, 1);
    const init = calls[0]!.init;
    const body = JSON.parse(String(init?.body)) as {
      api_key: string;
      query: string;
      include_images: boolean;
    };
    assert.equal(body.api_key, "tv-key");
    assert.equal(body.query, "cute cats");
    assert.equal(body.include_images, true);

    mock.restoreAll();
  });

  it("searches through the Exa provider using hero images and page image links", async () => {
    const calls: CallLog[] = [];
    mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const body = JSON.stringify({
        results: [
          {
            title: "Cute Cat Gallery",
            url: "https://example.com/gallery",
            image: "https://cdn.example.com/hero.jpg",
            extras: { imageLinks: ["https://cdn.example.com/one.png"] },
          },
          {
            title: "No Hero",
            url: "https://example.com/plain",
            extras: { imageLinks: ["https://cdn.example.com/two.gif"] },
          },
          { title: "No Images", url: "https://example.com/none" },
        ],
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const ctx = baseCtx({ web: { searchProvider: "exa", exaApiKey: "exa-key" } });
    const result = await registry.execute("image_search", { query: "cat photos" }, ctx);

    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as {
      provider: string;
      result_count: number;
      results: Array<{ image_url: string; source_url?: string; title?: string }>;
    };
    assert.equal(data.provider, IMAGE_SEARCH_PROVIDER_EXA);
    assert.equal(data.result_count, 3);
    assert.deepEqual(
      data.results.map((r) => r.image_url),
      [
        "https://cdn.example.com/hero.jpg",
        "https://cdn.example.com/one.png",
        "https://cdn.example.com/two.gif",
      ],
    );
    assert.equal(data.results[0].source_url, "https://example.com/gallery");
    assert.equal(data.results[0].title, "Cute Cat Gallery");

    assert.equal(calls.length, 1);
    const init = calls[0]!.init;
    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers && headers["Authorization"], "Bearer exa-key");
    const body = JSON.parse(String(init?.body)) as {
      numResults: number;
      contents: { extras: { imageLinks: number } };
    };
    assert.equal(body.numResults, 20);
    assert.equal(body.contents.extras.imageLinks, 1);

    mock.restoreAll();
  });

  it("performs a free DuckDuckGo image search (vqd token flow) without any API key", async () => {
    const calls: CallLog[] = [];
    mock.method(globalThis, "fetch", async (input: unknown) => {
      calls.push({ url: String(input) });
      const url = String(input);
      if (url.includes("i.js")) {
        const parsed = new URL(url);
        assert.equal(parsed.searchParams.get("q"), "cute cats");
        assert.equal(parsed.searchParams.get("vqd"), "42-123456789");
        return new Response(
          JSON.stringify({
            results: [
              {
                image: "https://cdn.example.com/ddg-cat.jpg",
                thumbnail: "https://cdn.example.com/ddg-cat-thumb.jpg",
                title: "Cute Cat",
                url: "https://example.com/cat",
              },
              { thumbnail: "https://cdn.example.com/ddg-cat-thumb2.jpg", title: "No Full" },
              { title: "No Image", url: "https://example.com/none" },
            ],
          }),
          { status: 200 },
        );
      }
      // Image results page used to obtain the vqd token.
      return new Response('<html>vqd="42-123456789"</html>', { status: 200 });
    });

    const ctx = baseCtx({ web: { searchProvider: "duckduckgo" } });
    const result = await registry.execute("image_search", { query: "cute cats" }, ctx);

    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as {
      provider: string;
      result_count: number;
      results: Array<{ image_url: string; source_url?: string; title?: string }>;
    };
    assert.equal(data.provider, IMAGE_SEARCH_PROVIDER_DUCKDUCKGO);
    assert.equal(data.result_count, 2); // "No Image" filtered out
    assert.equal(data.results[0].image_url, "https://cdn.example.com/ddg-cat.jpg");
    assert.equal(data.results[0].source_url, "https://example.com/cat");
    assert.equal(data.results[1].image_url, "https://cdn.example.com/ddg-cat-thumb2.jpg");
    assert.equal(calls.length, 2); // page token fetch + i.js
    mock.restoreAll();
  });

  it("performs a free DuckDuckGo web search without any API key", async () => {
    const calls: CallLog[] = [];
    mock.method(globalThis, "fetch", async (input: unknown) => {
      calls.push({ url: String(input) });
      const url = String(input);
      if (url.includes("html.duckduckgo.com")) {
        return new Response(
          `<html>
            <div class="result">
              <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://example.com/widgets")}&rut=xyz">The &amp; Great Widget</a>
              <a class="result__snippet">Here is a short widget description.</a>
            </div>
            <div class="result result--mouse">
              <a rel="nofollow" class="result__a" href="https://example.org/plain">Plain Site</a>
            </div>
          </html>`,
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ AbstractText: "", RelatedTopics: [] }), { status: 200 });
    });

    const ctx = baseCtx({ web: { searchProvider: "duckduckgo" } });
    const result = await registry.execute("web_search", { query: "widgets" }, ctx);

    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as {
      provider: string;
      result_count: number;
      results: Array<{ title: string; url: string; Description: string }>;
    };
    assert.equal(data.provider, "duckduckgo");
    assert.equal(data.result_count, 2);
    assert.equal(data.results[0].url, "https://example.com/widgets"); // redirect decoded
    assert.equal(data.results[0].title, "The & Great Widget"); // entity decoded
    assert.equal(data.results[1].url, "https://example.org/plain");
    assert.equal(calls.length, 1); // only the HTML endpoint (no need for the fallback API)
    mock.restoreAll();
  });

  it("uses DuckDuckGo (free) as the web search fallback when a keyed provider lacks a key", async () => {
    const calls: CallLog[] = [];
    mock.method(globalThis, "fetch", async (input: unknown) => {
      calls.push({ url: String(input) });
      return new Response(`<html><div class="result"><a rel="nofollow" class="result__a" href="https://example.com/x">X</a></div></html>`, { status: 200 });
    });

    // Selected exa, but exa has no key and no other keyed provider is configured.
    const ctx = baseCtx({ web: { searchProvider: "exa" } });
    const result = await registry.execute("web_search", { query: "test" }, ctx);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as { provider: string };
    assert.equal(data.provider, "duckduckgo");
    assert.equal(calls.length, 1);
    mock.restoreAll();
  });

  it("falls back to the first configured keyed provider when the selected one lacks a key", async () => {
    const calls: CallLog[] = [];
    mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          results: [{ title: "T", url: "https://example.com/x", image: "https://cdn.example.com/x.jpg" }],
        }),
        { status: 200 },
      );
    });

    // Selected provider is serpapi but no serpapi key is set; only tavily and exa keys exist.
    const ctx = baseCtx({
      web: { searchProvider: "serpapi", tavilyApiKey: "tv", exaApiKey: "ex" },
    });
    const result = await registry.execute("image_search", { query: "test" }, ctx);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as { provider: string };
    assert.equal(data.provider, IMAGE_SEARCH_PROVIDER_TAVILY); // tavily is the first configured
    assert.equal(calls.length, 1);
    mock.restoreAll();
  });

  it("returns a structured tool error on API/network failure instead of crashing", async () => {
    mock.method(globalThis, "fetch", async () => {
      throw new Error("ECONNRESET");
    });

    const ctx = baseCtx({ web: { searchProvider: "serpapi", serpapiApiKey: "k" } });
    const result = await registry.execute("image_search", { query: "landscapes" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "image_search_failed");
    assert.match((result.error as { message: string }).message, /ECONNRESET/);
    mock.restoreAll();
  });

  it("returns a structured tool error when the provider responds with a non-2xx status", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response("invalid key", { status: 401 });
    });

    const ctx = baseCtx({ web: { searchProvider: "serpapi", serpapiApiKey: "bad" } });
    const result = await registry.execute("image_search", { query: "cats" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "image_search_failed");
    assert.match((result.error as { message: string }).message, /401/);
    mock.restoreAll();
  });

  it("never throws and always returns a structured result", async () => {
    const calls: CallLog[] = [];
    mock.method(globalThis, "fetch", async (input: unknown) => {
      calls.push({ url: String(input) });
      if (String(input).includes("i.js")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response('<html></html>', { status: 200 });
    });
    for (const args of [{ query: "a" }, {}, { query: "" }]) {
      const ctx = baseCtx({ web: { searchProvider: "serpapi" } });
      const result = await registry.execute("image_search", args, ctx);
      assert.equal(typeof result.ok, "boolean");
      if (!result.ok) assert.ok(result.error);
    }
    mock.restoreAll();
  });
});