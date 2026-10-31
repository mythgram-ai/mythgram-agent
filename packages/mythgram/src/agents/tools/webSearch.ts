import { z } from "zod";
import { defineTool, type SearchProvider, type ToolContext, type ToolResult } from "./types.js";

const MAX_SEARCH_RESULTS = 15;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_DESCRIPTION_WORDS = 30;
const TRUNCATION_MARKER = "........";

export const SEARCH_PROVIDER_DUCKDUCKGO = "duckduckgo";
export const SEARCH_PROVIDER_TAVILY = "tavily";
export const SEARCH_PROVIDER_EXA = "exa";
export const SEARCH_PROVIDER_SERPAPI = "serpapi";
/**
 * Keyed search providers (require an API key). DuckDuckGo is intentionally not
 * part of this list — it is free and needs no key, so it is always available
 * and acts as the final fallback so search never breaks.
 */
const KEYED_SEARCH_PROVIDERS: readonly Exclude<SearchProvider, "duckduckgo">[] = [
  SEARCH_PROVIDER_TAVILY,
  SEARCH_PROVIDER_EXA,
  SEARCH_PROVIDER_SERPAPI,
] as const;

export const SEARCH_PROVIDERS: readonly SearchProvider[] = [
  SEARCH_PROVIDER_DUCKDUCKGO,
  ...KEYED_SEARCH_PROVIDERS,
] as const;

const schema = z.object({
  query: z.string().describe("The search query"),
});

interface SearchResult {
  title: string;
  url: string;
  Description: string;
}

/**
 * Clean excessive whitespace, then enforce a hard word limit on result text.
 * Returns text of up to `maxWords` words; longer text is cut to the first
 * `maxWords` words followed by the truncation marker. Empty/null-safe.
 */
function truncateDescription(text: string, maxWords = MAX_DESCRIPTION_WORDS): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return cleaned;
  const words = cleaned.split(" ");
  if (words.length <= maxWords) return cleaned;
  return `${words.slice(0, maxWords).join(" ")} ${TRUNCATION_MARKER}`;
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

async function fetchJson(url: string, init: RequestInit, ctx: ToolContext): Promise<unknown> {
  const { signal, cleanup } = timeoutSignal(ctx);
  try {
    const response = await fetch(url, { ...init, signal });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    }
    return body;
  } finally {
    cleanup();
  }
}

/** Fetch and return the raw text body, throwing on a non-2xx response. */
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

/** Decode common HTML entities so titles/snippets read as plain text. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#\d+;/g, "");
}

/** Strip HTML tags from a raw title/snippet fragment. */
function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, " ");
}

/**
 * Decode a DuckDuckGo result href. Organic results are redirect links of the
 * form `//duckduckgo.com/l/?uddg=<url-encoded>&rut=...` — we pull out the real
 * target from the `uddg` query param. A plain URL is passed through as-is.
 */
function decodeRedirectUrl(href: string): string {
  const trimmed = href.trim().replace(/^\s+/, "");
  if (!trimmed) return "";
  try {
    const match = trimmed.match(/[?&]uddg=([^&]+)/);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
    if (trimmed.startsWith("//")) {
      return `https:${trimmed}`;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

interface DuckDuckGoHtmlResult {
  title?: string;
  url?: string;
  snippet?: string;
}

/** Parse organic results out of DuckDuckGo's HTML search endpoint. */
function parseDuckDuckGoHtml(html: string): DuckDuckGoHtmlResult[] {
  const results: DuckDuckGoHtmlResult[] = [];
  // Split into per-result blocks ("result" or "result result--mouse").
  const blocks = html.split(/<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>/).slice(1);
  for (const block of blocks) {
    const hrefMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
    const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

    const title = titleMatch
      ? decodeEntities(stripTags(titleMatch[1])).replace(/\s+/g, " ").trim()
      : "";
    const url = hrefMatch ? decodeRedirectUrl(hrefMatch[1]) : "";
    const snippet = snippetMatch
      ? decodeEntities(stripTags(snippetMatch[1])).replace(/\s+/g, " ").trim()
      : "";
    if (title || url) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

/**
 * DuckDuckGo web search — completely free, no API key required. It uses
 * DuckDuckGo's public, keyless Instant Answer API (clean JSON) as a reliable
 * baseline, then supplements with organic results parsed from the HTML search
 * endpoint when available. Every returned URL is a real URL supplied by
 * DuckDuckGo — nothing is fabricated.
 */
async function searchDuckDuckGo(query: string, ctx: ToolContext): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  // 1) Organic results from the free HTML endpoint (title + url + snippet).
  try {
    const html = await fetchText(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; MythgramAI/1.0; +https://github.com/anomalyco/opencode)",
        },
      },
      ctx,
    );
    for (const item of parseDuckDuckGoHtml(html)) {
      if (!item.url) continue;
      const description = truncateDescription(item.snippet ?? "");
      if (!results.some((r) => r.url === item.url)) {
        results.push({
          title: item.title ?? item.url,
          url: item.url,
          Description: description,
        });
      }
    }
  } catch {
    // Fall through to the Instant Answer API — DuckDuckGo search still works.
  }

  // 2) Instant Answer baseline from the keyless JSON API (abstract + related topics).
  if (results.length === 0) {
    try {
      const data = (await fetchJson(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=mythgram`,
        { method: "GET" },
        ctx,
      )) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<
          | { Text?: string; FirstURL?: string }
          | { Topics?: Array<{ Text?: string; FirstURL?: string }> }
        >;
        Results?: Array<{ Text?: string; FirstURL?: string }>;
      };

      const push = (title: string, url: string, text: string) => {
        if (!url) return;
        const description = truncateDescription(text);
        if (!results.some((r) => r.url === url)) {
          results.push({ title: title || url, url, Description: description });
        }
      };

      if (data.AbstractText && data.AbstractURL) {
        push(data.Heading ?? query, data.AbstractURL, data.AbstractText);
      }

      const collect = (
        topic:
          | { Text?: string; FirstURL?: string }
          | { Topics?: Array<{ Text?: string; FirstURL?: string }> },
      ): void => {
        if ("Topics" in topic && Array.isArray(topic.Topics)) {
          for (const item of topic.Topics) collect(item);
          return;
        }
        const single = topic as { Text?: string; FirstURL?: string };
        if (single.FirstURL) push("", single.FirstURL, single.Text ?? "");
      };

      for (const topic of data.RelatedTopics ?? []) {
        collect(topic);
      }
    } catch {
      // No results available from either endpoint — report an empty result set.
    }
  }

  return results.slice(0, MAX_SEARCH_RESULTS);
}

async function searchTavily(query: string, apiKey: string, ctx: ToolContext): Promise<SearchResult[]> {
  const data = (await fetchJson(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: MAX_SEARCH_RESULTS }),
    },
    ctx,
  )) as { results?: Array<{ title?: string; url?: string; content?: string; description?: string }> };

  return (data.results ?? []).slice(0, MAX_SEARCH_RESULTS).map((item) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    Description: truncateDescription(item.content ?? item.description ?? ""),
  }));
}

async function searchExa(query: string, apiKey: string, ctx: ToolContext): Promise<SearchResult[]> {
  const data = (await fetchJson(
    "https://api.exa.ai/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        numResults: MAX_SEARCH_RESULTS,
        contents: { highlights: true },
      }),
    },
    ctx,
  )) as {
    results?: Array<{
      title?: string;
      url?: string;
      highlights?: string[];
      text?: string;
    }>;
  };

  return (data.results ?? []).slice(0, MAX_SEARCH_RESULTS).map((item) => ({
    title: item.title ?? "",
    url: item.url ?? "",
    Description: truncateDescription(
      item.highlights && item.highlights.length > 0
        ? item.highlights.join(" ")
        : item.text ?? "",
    ),
  }));
}

async function searchSerpApi(query: string, apiKey: string, ctx: ToolContext): Promise<SearchResult[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("engine", "google");
  url.searchParams.set("num", String(MAX_SEARCH_RESULTS));

  const data = (await fetchJson(url.toString(), { method: "GET" }, ctx)) as {
    organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
  };

  return (data.organic_results ?? []).slice(0, MAX_SEARCH_RESULTS).map((item) => ({
    title: item.title ?? "",
    url: item.link ?? "",
    Description: truncateDescription(item.snippet ?? ""),
  }));
}

/** Resolve which provider + key to use, falling back to free DuckDuckGo. */
function resolveProvider(
  ctx: ToolContext,
  keys: Record<SearchProvider, string | undefined>,
): { provider: SearchProvider; apiKey?: string } {
  const selected: SearchProvider = ctx.web?.searchProvider ?? SEARCH_PROVIDER_DUCKDUCKGO;

  // DuckDuckGo is free and keyless — always usable, acts as the final fallback.
  if (selected === SEARCH_PROVIDER_DUCKDUCKGO) {
    return { provider: SEARCH_PROVIDER_DUCKDUCKGO };
  }

  // Selected keyed provider has a key — use it.
  if (keys[selected]) {
    return { provider: selected, apiKey: keys[selected] };
  }

  // Selected keyed provider lacks a key: fall back to the first keyed provider
  // that has one, then to free DuckDuckGo so search never breaks.
  const fallback = KEYED_SEARCH_PROVIDERS.find((p) => keys[p]);
  if (fallback) {
    return { provider: fallback, apiKey: keys[fallback] };
  }
  return { provider: SEARCH_PROVIDER_DUCKDUCKGO };
}

export const webSearchTool = defineTool({
  name: "web_search",
  description:
    "Search the web for up-to-date information, news, and general knowledge. " +
    "Returns up to 15 results with titles, URLs, and descriptions. The free DuckDuckGo " +
    "provider (no API key needed) is used by default; Tavily, Exa or SerpAPI are used " +
    "when a key is configured and selected.",
  schema,
  label: (args) => `Web Search: ${args.query}`,
  async execute(args, ctx): Promise<ToolResult> {
    const query = args.query.trim();
    if (!query) {
      return { ok: false, error: { code: "missing_query", message: "No search query provided." } };
    }

    const keys: Record<SearchProvider, string | undefined> = {
      [SEARCH_PROVIDER_DUCKDUCKGO]: undefined,
      [SEARCH_PROVIDER_TAVILY]: ctx.web?.tavilyApiKey,
      [SEARCH_PROVIDER_EXA]: ctx.web?.exaApiKey,
      [SEARCH_PROVIDER_SERPAPI]: ctx.web?.serpapiApiKey,
    };

    const { provider, apiKey } = resolveProvider(ctx, keys);

    // DuckDuckGo is free and needs no key; the keyed providers all require one.
    if (provider !== SEARCH_PROVIDER_DUCKDUCKGO && !apiKey) {
      return {
        ok: false,
        error: {
          code: "missing_api_key",
          message:
            `No search API key configured for ${provider}. ` +
            "Select DuckDuckGo (free, no key needed) or add a key for Tavily, Exa or SerpAPI in Settings.",
        },
      };
    }

    try {
      const results =
        provider === SEARCH_PROVIDER_DUCKDUCKGO
          ? await searchDuckDuckGo(query, ctx)
          : provider === SEARCH_PROVIDER_EXA
            ? await searchExa(query, apiKey!, ctx)
            : provider === SEARCH_PROVIDER_SERPAPI
              ? await searchSerpApi(query, apiKey!, ctx)
              : await searchTavily(query, apiKey!, ctx);

      return {
        ok: true,
        data: {
          query,
          provider,
          results,
          result_count: results.length,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "web_search_failed",
          provider,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});