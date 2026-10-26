import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { scrapePage, crawlSite } from "../../scraper/scraper.js";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CONTENT_CHARS = 200_000;
const MAX_CRAWL_PAGES = 10;
const MAX_CRAWL_DEPTH = 3;

const schema = z.object({
  url: z.string().describe("The URL to fetch or scrape."),
  format: z
    .enum(["markdown", "text", "json", "autodetect"])
    .default("markdown")
    .describe("Output format for the extracted content (default markdown)."),
  crawl: z
    .boolean()
    .default(false)
    .describe("When true, crawl linked pages on the same site (bounded, default false)."),
  maxPages: z
    .number()
    .int()
    .min(1)
    .max(MAX_CRAWL_PAGES)
    .default(6)
    .describe("Max pages to fetch when crawling. Ignored unless crawl is true."),
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(MAX_CRAWL_DEPTH)
    .default(2)
    .describe("Max link depth when crawling. Ignored unless crawl is true."),
  extractImages: z
    .boolean()
    .default(true)
    .describe("Include extracted image URLs in the result (HTML pages)."),
  extractLinks: z
    .boolean()
    .default(true)
    .describe("Include extracted link URLs in the result (HTML pages)."),
});

function timeoutSignal(ctx: ToolContext): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  ctx.signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
    },
  };
}

/** Fetch a page through the Firecrawl API (requires an API key). */
async function scrapeWithFirecrawl(url: string, apiKey: string, ctx: ToolContext) {
  const { signal, cleanup } = timeoutSignal(ctx);
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
      signal,
    });
    const text = await response.text();
    const data = JSON.parse(text || "{}") as {
      success?: boolean;
      data?: { markdown?: string | null; rawHtml?: string | null; url?: string | null };
    };
    if (!response.ok || data.success === false) {
      return { ok: false, error: { code: "fetch_failed", message: `Firecrawl HTTP ${response.status}: ${text.slice(0, 500)}`, url } };
    }
    const content = data.data?.markdown ?? data.data?.rawHtml ?? "";
    return { ok: true, data: { provider: "firecrawl", url: data.data?.url ?? url, content: truncate(content) } };
  } catch (error) {
    return { ok: false, error: { code: "fetch_failed", message: error instanceof Error ? error.message : String(error), url } };
  } finally {
    cleanup();
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_CONTENT_CHARS) return text;
  return text.slice(0, MAX_CONTENT_CHARS) + `\n... [truncated ${text.length - MAX_CONTENT_CHARS} chars]`;
}

/**
 * The single web fetch/scrape tool. It serves both the free, keyless built-in scraper
 * (the default) and the paid Firecrawl API when the user selects Firecrawl and configures
 * a key. Single-page markdown fetches can be routed through Firecrawl; crawls and
 * non-markdown formats always use the built-in scraper.
 */
export const fetchWebUrlsTool = defineTool({
  name: "fatch_web_urls",
  description:
    "Fetch and extract clean content from a URL — a single page or a full site crawl. " +
    "Uses the free built-in scraper by default (no API key needed): returns clean " +
    "Markdown (or text/JSON), title, description, language, links, and images. Set " +
    "crawl=true to also fetch linked pages on the same site (bounded by maxPages/maxDepth). " +
    "When a Firecrawl API key is configured and selected, single-page fetches use " +
    "Firecrawl instead.",
  schema,
  label: (args) => (args.crawl ? `Crawl: ${args.url}` : `Fetch: ${args.url}`),
  async execute(args, ctx): Promise<ToolResult> {
    const url = args.url.trim();
    if (!url) {
      return { ok: false, error: { code: "missing_url", message: "No URL provided." } };
    }

    const apiKey = ctx.web?.firecrawlApiKey;
    const fetchProvider: "builtin" | "firecrawl" = ctx.web?.fetchProvider ?? "builtin";

    // Use Firecrawl only for a single-page markdown fetch when it is explicitly selected
    // AND a key is configured; everything else falls back to the free built-in scraper.
    if (!args.crawl && fetchProvider === "firecrawl" && apiKey) {
      const res = await scrapeWithFirecrawl(url, apiKey, ctx);
      if (res.ok) return res as ToolResult;
    }

    try {
      if (args.crawl) {
        const pages = await crawlSite({
          seedUrl: url,
          maxPages: args.maxPages,
          depth: args.maxDepth,
          sameOrigin: true,
          signal: ctx.signal,
          maxChars: MAX_CONTENT_CHARS,
        });
        return {
          ok: true,
          data: {
            provider: "builtin",
            mode: "crawl",
            url,
            page_count: pages.length,
            pages: pages.map((page) => ({
              url: page.url,
              status: page.status,
              title: page.title,
              description: page.description,
              lang: page.lang,
              content: truncate(page.content),
              links: args.extractLinks ? page.links.slice(0, 200) : undefined,
              images: args.extractImages ? page.images.slice(0, 200) : undefined,
            })),
          },
        };
      }

      const result = await scrapePage({
        url,
        format: args.format,
        maxChars: MAX_CONTENT_CHARS,
        signal: ctx.signal,
      });

      return {
        ok: true,
        data: {
          provider: "builtin",
          mode: "single",
          url: result.url,
          status: result.status,
          format: result.format,
          title: result.title,
          description: result.description,
          lang: result.lang,
          canonical_url: result.canonical_url,
          content: truncate(result.content),
          links: args.extractLinks ? result.links.slice(0, 200) : undefined,
          images: args.extractImages ? result.images.slice(0, 200) : undefined,
          metadata: result.metadata,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "fetch_failed",
          message: error instanceof Error ? error.message : String(error),
          url,
        },
      };
    }
  },
});
