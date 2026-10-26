import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { parseHtml } from "./html.js";
import { htmlToMarkdown } from "./parsers/html.js";
import { extractMetadata } from "./extractors/metadata.js";
import { extractLinks } from "./extractors/links.js";
import { extractImages } from "./extractors/images.js";
import { scrapePage } from "./scraper.js";
import { createToolRegistry } from "../agents/tools/index.js";
import type { ToolContext } from "../agents/tools/types.js";

const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Mythgram AI Test Page</title>
  <meta name="description" content="A test page for the scraper." />
  <meta property="og:title" content="Mythgram AI Test Page" />
  <meta property="og:image" content="https://example.com/og.png" />
  <link rel="canonical" href="https://example.com/articles/test" />
</head>
<body>
  <h1>Welcome</h1>
  <p>This is a <strong>bold</strong> and <em>italic</em> <a href="/about">about</a> page.</p>
  <ul>
    <li>Item one</li>
    <li>Item two with <a href="https://external.example/x">link</a></li>
  </ul>
  <pre><code>const x = 1;</code></pre>
  <img src="/images/hero.png" alt="Hero" />
  <img data-src="/images/lazy.jpg" alt="Lazy" />
  <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
</body>
</html>`;

function baseCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, ...overrides };
}

describe("scraper: html parsing & markdown", () => {
  it("parses html into a tree and renders readable markdown", () => {
    const root = parseHtml(SAMPLE_HTML);
    const md = htmlToMarkdown(root);
    assert.match(md, /# Welcome/);
    assert.match(md, /This is a \*\*bold\*\* and \*italic\* \[about\]\(\/about\) page\./);
    assert.match(md, /- Item one/);
    assert.match(md, /- Item two with \[link\]\(https:\/\/external\.example\/x\)/);
    assert.match(md, /```/);
    assert.match(md, /const x = 1;/);
    assert.match(md, /!\[Hero\]\(\/images\/hero\.png\)/);
  });

  it("extracts metadata, links and images from a parsed page", () => {
    const root = parseHtml(SAMPLE_HTML);
    const meta = extractMetadata(root, "https://example.com/articles/test");
    assert.equal(meta.title, "Mythgram AI Test Page");
    assert.equal(meta.description, "A test page for the scraper.");
    assert.equal(meta.lang, "en");
    assert.equal(meta.canonical_url, "https://example.com/articles/test");
    assert.equal(meta.og_image, "https://example.com/og.png");

    const links = extractLinks(root, "https://example.com/articles/test");
    assert.ok(links.some((l) => l.url === "https://example.com/about"));
    assert.ok(links.some((l) => l.url === "https://external.example/x"));

    const images = extractImages(root);
    assert.ok(images.some((i) => i.url === "/images/hero.png" && i.alt === "Hero"));
    assert.ok(images.some((i) => i.url === "/images/lazy.jpg"));
  });
});

describe("scraper: fetcher & normalization", () => {
  it("skips javascript:/mailto:/fragment links and dedupes", async () => {
    const root = parseHtml(
      `<a href="/a">A</a>
       <a href="https://x.com/a">A external</a>
       <a href="/a">A dup</a>
       <a href="javascript:void(0)">js</a><a href="mailto:a@b.c">mail</a><a href="#frag">frag</a>
       <a href="https://example.com/base">self</a>`,
    );
    const links = extractLinks(root, "https://example.com/base");
    assert.deepEqual(links.map((l) => l.url), ["https://example.com/a", "https://x.com/a"]);
  });
});

describe("scraper: scrapePage (free, keyless)", () => {
  it("fetches and parses an HTML page with a live title/description", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response(SAMPLE_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
    const result = await scrapePage({
      url: "https://example.com/articles/test",
      format: "markdown",
    });
    assert.equal(result.status, 200);
    assert.equal(result.title, "Mythgram AI Test Page");
    assert.equal(result.description, "A test page for the scraper.");
    assert.equal(result.format, "markdown");
    assert.match(result.content, /# Welcome/);
    assert.equal(result.contentType, "text/html");
    assert.ok(result.images.length > 0);
    assert.ok(result.links.length > 0);
    mock.restoreAll();
  });

  it("returns plain text for the text format", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response(SAMPLE_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    });
    const result = await scrapePage({ url: "https://example.com/", format: "text" });
    assert.equal(result.format, "text");
    assert.doesNotMatch(result.content, /# Welcome/);
    assert.match(result.content, /Welcome/);
    mock.restoreAll();
  });
});

describe("scraper: integration with the web tools", () => {
  let registry: ReturnType<typeof createToolRegistry>;

  before(() => {
    registry = createToolRegistry();
  });

  after(() => {
    mock.restoreAll();
  });

  it("fatch_web_urls is the single web fetch tool (scrape_webpage removed)", () => {
    assert.equal(registry.has("fatch_web_urls"), true);
    assert.equal(registry.has("scrape_webpage"), false);
  });

  it("fatch_web_urls uses the built-in free scraper for a single page", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response(SAMPLE_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    });
    const ctx = baseCtx({ web: { fetchProvider: "builtin", searchProvider: "duckduckgo" } });
    const result = await registry.execute("fatch_web_urls", { url: "https://example.com/", format: "markdown" }, ctx);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as { provider: string; mode: string; title: string };
    assert.equal(data.provider, "builtin");
    assert.equal(data.mode, "single");
    assert.equal(data.title, "Mythgram AI Test Page");
    mock.restoreAll();
  });

  it("fatch_web_urls supports the built-in crawl mode", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response(SAMPLE_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    });
    const ctx = baseCtx({ web: { fetchProvider: "builtin", searchProvider: "duckduckgo" } });
    const result = await registry.execute("fatch_web_urls", { url: "https://example.com/", crawl: true, maxPages: 2, maxDepth: 1 }, ctx);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as { provider: string; mode: string; page_count: number; pages: Array<{ title: string }> };
    assert.equal(data.provider, "builtin");
    assert.equal(data.mode, "crawl");
    assert.ok(data.page_count >= 1);
    assert.equal(data.pages[0]?.title, "Mythgram AI Test Page");
    mock.restoreAll();
  });

  it("fatch_web_urls falls back to the built-in scraper (free) when no Firecrawl key is set", async () => {
    const calls: string[] = [];
    mock.method(globalThis, "fetch", async (input: unknown) => {
      calls.push(String(input));
      return new Response(SAMPLE_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    });
    // Firecrawl explicitly selected but no key -> must use the built-in scraper.
    const ctx = baseCtx({ web: { fetchProvider: "firecrawl", searchProvider: "duckduckgo" } });
    const result = await registry.execute("fatch_web_urls", { url: "https://example.com/" }, ctx);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as { provider: string; title: string };
    assert.equal(data.provider, "builtin");
    assert.equal(data.title, "Mythgram AI Test Page");
    assert.equal(calls.length, 1);
    mock.restoreAll();
  });

  it("fatch_web_urls uses Firecrawl when it is selected and a key exists", async () => {
    const calls: string[] = [];
    mock.method(globalThis, "fetch", async (input: unknown) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({ success: true, data: { markdown: "# Via Firecrawl", url: "https://example.com/" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const ctx = baseCtx({ web: { fetchProvider: "firecrawl", firecrawlApiKey: "fc-key", searchProvider: "duckduckgo" } });
    const result = await registry.execute("fatch_web_urls", { url: "https://example.com/" }, ctx);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as { provider: string; content: string };
    assert.equal(data.provider, "firecrawl");
    assert.match(data.content, /Via Firecrawl/);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /api.firecrawl.dev/);
    mock.restoreAll();
  });
});