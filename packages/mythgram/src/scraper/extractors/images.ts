/**
 * Image extraction. Collects every <img src> on the page plus common lazy-load
 * data attributes (data-src, data-original, data-lazy-src) and picture <source>
 * candidates, resolving relative URLs to absolute and deduplicating.
 */
import type { HtmlRoot } from "../html.js";
import { findAll } from "../html.js";
import type { ExtractedImage } from "../types.js";

const LAZY_ATTRS = ["src", "data-src", "data-original", "data-lazy-src", "data-url", "data-srcset"];

/** First non-empty attribute value in priority order. */
function firstSrc(attrs: Record<string, string>): string {
  for (const key of LAZY_ATTRS) {
    const v = attrs[key];
    if (v) {
      // srcset entries may be "url 1x, url 2x" -- take the first URL.
      return v.split(",")[0]?.trim().split(/\s+/)[0] ?? "";
    }
  }
  return "";
}

/** Extract and normalize all image references from a parsed HTML root. */
export function extractImages(root: HtmlRoot): ExtractedImage[] {
  const images: ExtractedImage[] = [];

  const add = (src: string, alt: string, title: string) => {
    if (!src) return;
    const candidates = src.split(",").map((s) => s.trim().split(/\s+/)[0] ?? "").filter(Boolean);
    for (const candidate of candidates) {
      images.push({ url: candidate, alt: alt || undefined, title: title || undefined });
    }
  };

  for (const img of findAll(root, "img")) {
    add(firstSrc(img.attrs), img.attrs.alt ?? "", img.attrs.title ?? "");
  }

  // <source srcset> inside <picture>.
  for (const source of findAll(root, "source")) {
    const srcset = source.attrs.srcset ?? source.attrs.src ?? "";
    add(srcset, "", "");
  }

  return images;
}

/**
 * Resolve + dedupe raw (possibly relative) images against a base URL. Exposed
 * separately because images may come from metadata (og:image) in addition to the
 * DOM.
 */
export { normalizeImages } from "../fetcher.js";