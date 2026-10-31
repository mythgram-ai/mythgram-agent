import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/**
 * Live image search that supports DuckDuckGo (free, no API key — the default) plus the
 * project's paid web-search providers: Tavily, Exa and SerpAPI. The provider is chosen from
 * ctx.web.searchProvider (falling back to free DuckDuckGo so image search never breaks),
 * mirroring the web_search tool's provider selection. Every image URL returned is a real,
 * live URL supplied by the provider — nothing is fabricated.
 *
 * Provider support:
 *  - DuckDuckGo : free image search via the keyless `vqd`-token flow
 *                 (https://duckduckgo.com/i.js?q=...&vqd=...) -> results[] with direct image.
 *  - Tavily     : POST /search with include_images=true -> query-level `images` array plus
 *                 source-linked `results[].images`.
 *  - Exa        : POST /search results carry an `image` (hero) URL; requesting
 *                 `contents.extras.imageLinks` also extracts page images per result.
 *  - SerpAPI    : GET /search.json?engine=google_images -> images_results with direct `original`.
 */

const MAX_IMAGE_RESULTS = 20;
const REQUEST_TIMEOUT_MS = 30_000;

export const IMAGE_SEARCH_PROVIDER_DUCKDUCKGO = "duckduckgo";
export const IMAGE_SEARCH_PROVIDER_TAVILY = "tavily";
export const IMAGE_SEARCH_PROVIDER_EXA = "exa";
export const IMAGE_SEARCH_PROVIDER_SERPAPI = "serpapi";
/** Keyed image search providers (require an API key); DuckDuckGo is free and keyless. */
const KEYED_IMAGE_SEARCH_PROVIDERS: readonly string[] = [
  IMAGE_SEARCH_PROVIDER_TAVILY,
  IMAGE_SEARCH_PROVIDER_EXA,
  IMAGE_SEARCH_PROVIDER_SERPAPI,
] as const;
export const IMAGE_SEARCH_PROVIDERS: readonly string[] = [
  IMAGE_SEARCH_PROVIDER_DUCKDUCKGO,
  ...KEYED_IMAGE_SEARCH_PROVIDERS,
] as const;

const schema = z
  .object({
    query: z.string().min(1).describe("The search query used to find relevant images."),
  })
  .strict();

interface ImageSearchResult {
  title?: string;
  image_url: string;
  source_url?: string;
}

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

/** POST a JSON body and return the parsed JSON on a 2xx response; throws otherwise. */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const { signal, cleanup } = timeoutSignal(ctx);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text.slice(0, 500) };
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    }
    return parsed;
  } finally {
    cleanup();
  }
}

/** GET a URL and return the parsed JSON on a 2xx response; throws otherwise. */
async function fetchJson(url: string, init: RequestInit, ctx: ToolContext): Promise<unknown> {
  const { signal, cleanup } = timeoutSignal(ctx);
  try {
    const response = await fetch(url, { ...init, signal });
    const text = await response.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text.slice(0, 500) };
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    }
    return parsed;
  } finally {
    cleanup();
  }
}

interface TavilyResult {
  title?: string;
  url?: string;
  images?: Array<{ url?: string; description?: string }>;
}

/** Tavily Search with include_images -> top-level query images plus per-result source-linked images. */
async function searchTavilyImages(
  query: string,
  apiKey: string,
  ctx: ToolContext,
): Promise<ImageSearchResult[]> {
  const data = (await postJson(
    "https://api.tavily.com/search",
    { "Content-Type": "application/json" },
    {
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: MAX_IMAGE_RESULTS,
      include_images: true,
      include_image_descriptions: true,
    },
    ctx,
  )) as {
    images?: Array<{ url?: string; description?: string }>;
    results?: TavilyResult[];
  };

  const results: ImageSearchResult[] = [];

  // Source-linked images: each page's own images, keyed to the result URL.
  for (const result of data.results ?? []) {
    for (const image of result.images ?? []) {
      if (!image.url) continue;
      results.push({
        title: image.description ?? result.title ?? undefined,
        image_url: image.url,
        source_url: result.url ?? undefined,
      });
    }
  }

  // Query-level images (no attached source page).
  for (const image of data.images ?? []) {
    if (!image.url) continue;
    results.push({
      title: image.description ?? undefined,
      image_url: image.url,
    });
  }

  return results.slice(0, MAX_IMAGE_RESULTS);
}

interface ExaResult {
  title?: string;
  url?: string;
  image?: string;
  extras?: { imageLinks?: string[] | string };
}

/** Exa search returning each result's hero image plus any extracted page image links. */
async function searchExaImages(
  query: string,
  apiKey: string,
  ctx: ToolContext,
): Promise<ImageSearchResult[]> {
  const data = (await postJson(
    "https://api.exa.ai/search",
    { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    {
      query,
      numResults: MAX_IMAGE_RESULTS,
      contents: { extras: { imageLinks: 1 } },
    },
    ctx,
  )) as { results?: ExaResult[] };

  const seen = new Set<string>();
  const results: ImageSearchResult[] = [];

  const push = (imageUrl: string, result: ExaResult) => {
    if (!imageUrl || seen.has(imageUrl)) return;
    seen.add(imageUrl);
    results.push({
      title: result.title ?? undefined,
      image_url: imageUrl,
      source_url: result.url ?? undefined,
    });
  };

  for (const result of data.results ?? []) {
    if (result.image) push(result.image, result);
    const links = result.extras?.imageLinks;
    const imageLinks = Array.isArray(links) ? links : links ? [links] : [];
    for (const link of imageLinks) push(link, result);
  }

  return results.slice(0, MAX_IMAGE_RESULTS);
}

/** Fetch the raw text of a URL, throwing on a non-2xx response. */
async function fetchText(url: string, init: RequestInit, ctx: ToolContext): Promise<string> {
  const { signal, cleanup } = timeoutSignal(ctx);
  try {
    const response = await fetch(url, { ...init, signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    }
    return text;
  } finally {
    cleanup();
  }
}

interface SerpApiImageItem {
  title?: string;
  link?: string;
  original?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string }>;
}

/**
 * DuckDuckGo image search — completely free, no API key required. It uses the same
 * keyless `vqd`-token flow that DuckDuckGo's own image page uses: first it loads the
 * image search page to obtain a session token, then it hits the public
 * `https://duckduckgo.com/i.js` JSON endpoint. Every `image` URL returned is a real
 * direct image URL supplied by DuckDuckGo — nothing is fabricated.
 */
async function searchDuckDuckGoImages(query: string, ctx: ToolContext): Promise<ImageSearchResult[]> {
  const results: ImageSearchResult[] = [];

  const extractVqd = (page: string): string | null => {
    const m = page.match(/vqd="([0-9-]+)"/) || page.match(/vqd='([0-9-]+)'/);
    return m ? m[1] : null;
  };

  // 1) Obtain a DuckDuckGo session token (vqd) from the image search page.
  let vqd: string | null = null;
  try {
    const page = await fetchText(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
      {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MythgramAI/1.0)" },
      },
      ctx,
    );
    vqd = extractVqd(page);
  } catch {
    // Continue without a vqd token — i.js may still answer.
  }

  // 2) Query the public JSON image endpoint.
  try {
    const url = new URL("https://duckduckgo.com/i.js");
    url.searchParams.set("q", query);
    url.searchParams.set("o", "json");
    url.searchParams.set("l", "us-en");
    url.searchParams.set("p", "1");
    url.searchParams.set("f", ",,,,,");
    if (vqd) url.searchParams.set("vqd", vqd);

    const data = (await fetchJson(
      url.toString(),
      {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MythgramAI/1.0)" },
      },
      ctx,
    )) as {
      results?: Array<{
        image?: string;
        thumbnail?: string;
        title?: string;
        url?: string;
      }>;
    };

    for (const item of (data.results ?? []).slice(0, MAX_IMAGE_RESULTS)) {
      const imageUrl = item.image ?? item.thumbnail ?? "";
      if (!imageUrl) continue;
      results.push({
        title: item.title ?? undefined,
        image_url: imageUrl,
        source_url: item.url ?? undefined,
      });
    }
  } catch {
    // No DuckDuckGo image results available — return whatever we have.
  }

  return results.slice(0, MAX_IMAGE_RESULTS);
}

/** Run a live Google Images search through SerpAPI and return up to MAX_IMAGE_RESULTS images. */
async function searchSerpApiImages(
  query: string,
  apiKey: string,
  ctx: ToolContext,
): Promise<ImageSearchResult[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("num", String(MAX_IMAGE_RESULTS));

  const { signal, cleanup } = timeoutSignal(ctx);
  try {
    const response = await fetch(url.toString(), { method: "GET", signal });
    const text = await response.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    }

    const items = (data as { images_results?: SerpApiImageItem[] }).images_results ?? [];
    return items
      .slice(0, MAX_IMAGE_RESULTS)
      .map((item) => {
        const imageUrl = item.original ?? item.thumbnail ?? item.thumbnails?.[0]?.url ?? "";
        return {
          title: item.title,
          image_url: imageUrl,
          source_url: item.link,
        };
      })
      .filter((result) => Boolean(result.image_url))
      .slice(0, MAX_IMAGE_RESULTS);
  } finally {
    cleanup();
  }
}

export const imageSearchTool = defineTool({
  name: "image_search",
  description:
    "Search the web for images using a search query. The tool performs a live image search " +
    "and returns image results with direct live image URLs and source URLs. Use this tool " +
    "whenever the agent needs to find images or visual references.",
  schema,
  label: (args) => `Image Search: ${args.query}`,
  async execute(args, ctx): Promise<ToolResult> {
    const query = args.query.trim();
    if (!query) {
      return {
        ok: false,
        error: { code: "missing_query", message: "No search query provided." },
      };
    }

    const keys: Record<string, string | undefined> = {
      [IMAGE_SEARCH_PROVIDER_DUCKDUCKGO]: undefined,
      [IMAGE_SEARCH_PROVIDER_TAVILY]: ctx.web?.tavilyApiKey,
      [IMAGE_SEARCH_PROVIDER_EXA]: ctx.web?.exaApiKey,
      [IMAGE_SEARCH_PROVIDER_SERPAPI]: ctx.web?.serpapiApiKey,
    };

    // Resolve the active provider, falling back to free DuckDuckGo so image
    // search works out of the box without any API key.
    const selected = ctx.web?.searchProvider;
    let provider: string;
    let apiKey: string | undefined;
    if (selected === IMAGE_SEARCH_PROVIDER_DUCKDUCKGO) {
      // Free, keyless provider selected.
      provider = IMAGE_SEARCH_PROVIDER_DUCKDUCKGO;
    } else if (keys[selected ?? ""]) {
      // Selected keyed provider has a key set.
      provider = selected as string;
      apiKey = keys[selected as string];
    } else {
      // Selected keyed provider lacks a key: fall to the first keyed provider
      // with a key, else to free DuckDuckGo so image search never breaks.
      const keyedFallback = KEYED_IMAGE_SEARCH_PROVIDERS.find((p) => keys[p]);
      if (keyedFallback) {
        provider = keyedFallback;
        apiKey = keys[keyedFallback];
      } else {
        provider = IMAGE_SEARCH_PROVIDER_DUCKDUCKGO;
      }
    }

    // DuckDuckGo is free and needs no key; the keyed providers all require one.
    if (provider !== IMAGE_SEARCH_PROVIDER_DUCKDUCKGO && !apiKey) {
      return {
        ok: false,
        error: {
          code: "missing_api_key",
          message:
            "No search API key configured for image search. " +
            "Use the free DuckDuckGo provider (no key needed) or add a Tavily, Exa or SerpAPI key in Settings.",
          provider,
        },
      };
    }

    try {
      const results =
        provider === IMAGE_SEARCH_PROVIDER_DUCKDUCKGO
          ? await searchDuckDuckGoImages(query, ctx)
          : provider === IMAGE_SEARCH_PROVIDER_EXA
            ? await searchExaImages(query, apiKey!, ctx)
            : provider === IMAGE_SEARCH_PROVIDER_SERPAPI
              ? await searchSerpApiImages(query, apiKey!, ctx)
              : await searchTavilyImages(query, apiKey!, ctx);

      return {
        ok: true,
        data: {
          query,
          provider,
          result_count: results.length,
          results,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "image_search_failed",
          provider,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});