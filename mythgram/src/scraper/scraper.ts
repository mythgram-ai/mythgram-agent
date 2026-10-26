/**
 * The main public entry point for the built-in scraper. `scrapePage` fetches a
 * single URL and returns a normalized, structured ScrapeResult (Markdown, plain
 * text, or JSON as requested, plus metadata, links, images). `crawlSite` runs
 * the bounded crawler. Everything is free and keyless.
 */
import { fetchUrl } from "./fetcher.js";
import { parseContent } from "./parser.js";
import { crawlWebpage } from "./crawler.js";
import type { CrawlOptions, CrawledPage, ScrapeOptions, ScrapeResult } from "./types.js";

/**
 * Scrape a single URL and return a normalized result. This never throws for
 * network/content issues -- it returns a ScrapeResult carrying the HTTP status
 * so callers can decide how to react.
 */
export async function scrapePage(options: ScrapeOptions): Promise<ScrapeResult> {
  const fetchResult = await fetchUrl(options.url.trim(), {
    timeoutMs: options.timeoutMs,
    headers: options.headers,
    signal: options.signal,
  });
  return parseContent(fetchResult, {
    format: options.format,
    maxChars: options.maxChars,
  });
}

/** Crawl a site breadth-first with bounded page count and depth. */
export async function crawlSite(options: CrawlOptions): Promise<CrawledPage[]> {
  return crawlWebpage(options);
}

export { crawlWebpage } from "./crawler.js";
export type { CrawledPage };