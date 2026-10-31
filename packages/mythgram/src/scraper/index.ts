/**
 * Free, keyless web scraper / crawler. This is the built-in alternative to
 * paid scraping services (like Firecrawl): fetch a page, convert HTML to clean
 * Markdown (or extract plain text / JSON), and pull out metadata, links, and
 * images -- all with no external library and no API key.
 *
 *   scrapePage({ url, format: "markdown" }) -> ScrapeResult
 *   crawlSite({ seedUrl, maxPages: 8, depth: 2 }) -> CrawledPage[]
 */

export { scrapePage, crawlSite, crawlWebpage } from "./scraper.js";
export { fetchUrl, absolutize } from "./fetcher.js";
export { parseHtml } from "./html.js";
export type {
  FetchResult,
  CrawlOptions,
  CrawledPage,
  ExtractedImage,
  PageMetadata,
  ResourceLink,
  ScrapeOptions,
  ScrapeResult,
} from "./types.js";