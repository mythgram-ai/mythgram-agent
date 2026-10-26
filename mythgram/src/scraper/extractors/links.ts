/**
 * Link extraction. Collects every <a href> on the page, resolving relative URLs
 * to absolute and filtering out pure fragments / non-navigable schemes. Also
 * gathers each link's visible anchor text and title attribute.
 */
import type { HtmlRoot, HtmlElementNode } from "../html.js";
import { findAll, textContent } from "../html.js";
import { normalizeLinks } from "../fetcher.js";
import type { ResourceLink } from "../types.js";

/** Extract and normalize all navigable links from a parsed HTML root. */
export function extractLinks(root: HtmlRoot, baseUrl: string): ResourceLink[] {
  const anchors = findAll(root, "a", (attrs) => Boolean(attrs.href));
  const links: ResourceLink[] = anchors.map((a: HtmlElementNode) => ({
    url: a.attrs.href ?? "",
    text: textContent(a).replace(/\s+/g, " ").trim() || undefined,
    title: a.attrs.title || undefined,
  }));
  return normalizeLinks(links, baseUrl);
}