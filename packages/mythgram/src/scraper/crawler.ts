/**
 * Bounded web crawler. Starting from a seed URL it breadth-first fetches pages
 * (same-origin by default), extracts their links/images, and returns them in
 * discovery order. Concurrency is capped, and both page count and link depth
 * are bounded so a crawl can never runaway or hammer a server.
 */
import { fetchUrl, isSameOrigin } from "./fetcher.js";
import { parseContent } from "./parser.js";
import type { CrawlOptions, CrawledPage } from "./types.js";

const DEFAULT_MAX_PAGES = 8;
const DEFAULT_DEPTH = 2;
const CONCURRENCY = 4;
const WANTED_CONTENT = /html|json|markdown|text|xml|rss|atom/i;

interface WorkItem {
  url: string;
  depth: number;
}

/**
 * Crawl a site breadth-first. Returns pages in discovery order. Never throws:
 * individual page/network failures are skipped, and an aborted signal stops the
 * crawl early. The total page budget is `maxPages`.
 */
export async function crawlWebpage(options: CrawlOptions): Promise<CrawledPage[]> {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, 50));
  const maxDepth = Math.max(0, options.depth ?? DEFAULT_DEPTH);
  const sameOrigin = options.sameOrigin ?? true;
  const { timeoutMs, headers, maxChars, signal } = options;

  let origin: string;
  try {
    origin = new URL(options.seedUrl.trim()).origin;
  } catch {
    return [];
  }

  const seen = new Set<string>([options.seedUrl.trim()]);
  const pages: CrawledPage[] = [];
  let frontier: WorkItem[] = [{ url: options.seedUrl.trim(), depth: 0 }];

  while (frontier.length > 0 && pages.length < maxPages && !signal?.aborted) {
    const currentLevel = frontier;
    const nextLevel: WorkItem[] = [];
    // Dedupe seeds discovered within this same BFS level (concurrent producers).
    const seenThisLevel = new Set<string>();

    // Process the whole current level with bounded concurrency.
    let idx = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (true) {
          const item = currentLevel[idx++];
          if (!item) break;
          if (signal?.aborted) break;
          await fetchAndQueue(item, seenThisLevel, nextLevel);
        }
      }),
    );

    frontier = nextLevel;
  }

  return pages;

  async function fetchAndQueue(
    item: WorkItem,
    seenThisLevel: Set<string>,
    nextLevel: WorkItem[],
  ): Promise<void> {
    let fetchResult;
    try {
      fetchResult = await fetchUrl(item.url, { timeoutMs, headers });
    } catch {
      return;
    }
    try {
      if (!WANTED_CONTENT.test(fetchResult.contentType)) return;
      const parsed = parseContent(fetchResult, { format: "markdown", maxChars });
      if (signal?.aborted) return;

      pages.push({
        url: parsed.url,
        status: parsed.status,
        title: parsed.title,
        description: parsed.description,
        lang: parsed.lang,
        content: parsed.content,
        links: parsed.links,
        images: parsed.images,
      });

      if (item.depth + 1 > maxDepth) return;
      for (const link of parsed.links) {
        if (seen.has(link.url) || seenThisLevel.has(link.url)) continue;
        if (sameOrigin && !isSameOrigin(link.url, origin)) continue;
        if (pages.length + nextLevel.length >= maxPages) return;
        seen.add(link.url);
        seenThisLevel.add(link.url);
        nextLevel.push({ url: link.url, depth: item.depth + 1 });
      }
    } catch {
      // Non-fatal: a broken page must not abort the whole crawl.
    }
  }
}