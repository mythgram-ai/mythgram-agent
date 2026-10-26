/**
 * Metadata extraction. Reads the page's <head> and body-level meta information
 * (HTML meta tags + OpenGraph + Twitter Card) and returns a normalized
 * PageMetadata object. Falls back to the rendered content (e.g. first heading)
 * when no explicit metadata is declared.
 */
import type { HtmlRoot, HtmlElementNode } from "../html.js";
import { findFirst, findAll, attr, textContent } from "../html.js";
import { absolutize } from "../fetcher.js";
import { cleanText } from "../parsers/markdown.js";
import type { PageMetadata } from "../types.js";

/** Collect every <meta> tag's (property/name, content) into a map. */
function collectMeta(root: HtmlRoot): Record<string, string> {
  const props: Record<string, string> = {};
  const metas = findAll(root, "meta");
  for (const meta of metas) {
    const key = meta.attrs.property || meta.attrs.name || meta.attrs.itemprop;
    if (key) props[key.toLowerCase()] = meta.attrs.content ?? "";
  }
  return props;
}

/** Extract metadata from a parsed HTML root and its source URL. */
export function extractMetadata(root: HtmlRoot, baseUrl: string): PageMetadata {
  const raw = collectMeta(root);

  const htmlEl = findFirst(root, (e) => e.tag === "html");
  const titleTag = findFirst(root, (e) => e.tag === "title");
  const ogUrl = raw["og:url"] ?? "";
  const canonicalEl = findFirst(root, (e) => e.tag === "link" && (e.attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"));

  const resolve = (href: string): string | undefined => {
    const abs = absolutize(href, baseUrl);
    return abs || undefined;
  };

  const description =
    cleanText(raw["description"] || raw["og:description"] || raw["twitter:description"] || "") ||
    undefined;
  const title =
    cleanText(raw["og:title"] || raw["twitter:title"] || (titleTag ? textContent(titleTag) : "")) ||
    undefined;

  const metadata: PageMetadata = {
    title,
    description,
    canonical_url: canonicalEl ? resolve(attr(canonicalEl as HtmlElementNode, "href")) ?? resolve(ogUrl) : resolve(ogUrl),
    lang: (htmlEl && htmlEl.attrs.lang) || (root.attrs.lang as string | undefined),
    author: cleanText(raw["author"] || raw["article:author"] || raw["twitter:creator"] || "") || undefined,
    published_time: raw["article:published_time"] || raw["date"] || undefined,
    keywords: raw["keywords"] ? cleanText(raw["keywords"]) : undefined,
    og_image: raw["og:image"] ? resolve(raw["og:image"]) || raw["og:image"] : undefined,
    twitter_image: raw["twitter:image"] ? resolve(raw["twitter:image"]) || raw["twitter:image"] : undefined,
    properties: Object.keys(raw).length > 0 ? raw : undefined,
  };

  return metadata;
}