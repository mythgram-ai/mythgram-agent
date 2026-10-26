/**
 * Shared type definitions for the built-in web scraper. The scraper is a free,
 * keyless alternative to fetching a single URL or crawling a site. It fetches a
 * page, parses it (HTML -> Markdown, JSON, or plain text), and extracts useful
 * structured data (metadata, links, images) -- all with no external library or
 * API key.
 */

/** A single resource link found on a page. */
export interface ResourceLink {
  /** Absolute URL (resolved against the page base URL). */
  url: string;
  /** Anchor text of the link, if any. */
  text?: string;
  /** The link's `title` attribute, if any. */
  title?: string;
}

/** An image reference found on a page. */
export interface ExtractedImage {
  /** Absolute image URL (resolved against the page base URL). */
  url: string;
  /** Alt text of the image, if any. */
  alt?: string;
  /** The `title` attribute or surrounding container title, if any. */
  title?: string;
}

/** Best-effort metadata extracted from a page (OpenGraph, Twitter, HTML meta). */
export interface PageMetadata {
  title?: string;
  description?: string;
  /** Canonical URL, if declared. */
  canonical_url?: string;
  /** Declared page language, e.g. "en". */
  lang?: string;
  author?: string;
  /** Posting / published time from meta, ISO string. */
  published_time?: string;
  modifiers?: string;
  keywords?: string;
  /** OpenGraph image URL (absolute). */
  og_image?: string;
  twitter_image?: string;
  /** Raw OpenGraph / meta properties kept for completeness. */
  properties?: Record<string, string>;
}

/** The raw response produced by the fetcher before parsing. */
export interface FetchResult {
  /** Final URL after following redirects. */
  url: string;
  /** HTTP status code. */
  status: number;
  /** Content-Type header (without parameters), e.g. "text/html". */
  contentType: string;
  contentEncoding?: string;
  /** Decoded body text for text-ish types; empty for binary (e.g. images). */
  text: string;
  /** Key headers (lowercased) for downstream consumers. */
  headers: Record<string, string>;
}

/** Options controlling a single page scrape. */
export interface ScrapeOptions {
  url: string;
  /** Timeout for the fetch in milliseconds. Default 60_000. */
  timeoutMs?: number;
  /** External abort signal so the scrape stops when its turn is cancelled. */
  signal?: AbortSignal;
  /**
   * Which format to produce: "markdown" (default), "text", or "json".
   * When "autodetect", the content type decides (JSON -> parse JSON, else markdown).
   */
  format?: "markdown" | "text" | "json" | "autodetect";
  /** Max characters of content to retain. Default 200_000. */
  maxChars?: number;
  /** Custom headers to send with the request. */
  headers?: Record<string, string>;
  /**
   * When true, also scan the raw HTML for JSON-LD and return links/images/metadata.
   * These extractions are always performed for HTML pages.
   */
  extractImages?: boolean;
  extractLinks?: boolean;
}

/** A single page of a crawl. */
export interface CrawledPage {
  url: string;
  status: number;
  title?: string;
  description?: string;
  lang?: string;
  /** Markdown (or plain text for non-HTML) content of the page. */
  content: string;
  /** Links found on the page (absolute). */
  links: ResourceLink[];
  /** Images found on the page (absolute). */
  images: ExtractedImage[];
}

/** Options controlling a multi-page crawl. */
export interface CrawlOptions {
  seedUrl: string;
  /** Maximum number of pages to fetch. Default 8. */
  maxPages?: number;
  /** Max link depth relative to the seed. Default 2. */
  depth?: number;
  /** Restrict crawling to the same origin. Default true. */
  sameOrigin?: boolean;
  timeoutMs?: number;
  maxChars?: number;
  headers?: Record<string, string>;
  /** Abort signal to stop the crawl early. */
  signal?: AbortSignal;
}

/** The normalized, final result of scraping a single page. */
export interface ScrapeResult {
  url: string;
  /** The format the content is produced in (after autodetect resolution). */
  format: "markdown" | "text" | "json";
  /** Scraped status code. */
  status: number;
  contentType: string;
  /** The scraped content in the requested format. */
  content: string;
  title?: string;
  description?: string;
  lang?: string;
  canonical_url?: string;
  /** Absolute links found on the page (when extracted). */
  links: ResourceLink[];
  /** Absolute image URLs found on the page (when extracted). */
  images: ExtractedImage[];
  /** Full best-effort metadata object. */
  metadata: PageMetadata;
  /** When the source was HTML/JSON, the raw body text is also available here. */
  rawText?: string;
}