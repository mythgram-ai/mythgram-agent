/**
 * Content parsing orchestrator. Given a FetchResult, detects the content type
 * and routes to the appropriate parser (HTML -> Markdown, JSON, Markdown, or
 * plain text), then runs the extractors (metadata / links / images) for HTML.
 *
 * Every public function is defensive: an unparseable body never throws, it
 * yields a structured result with as much as we could recover.
 */
import { parseHtml } from "./html.js";
import type { FetchResult, ScrapeOptions, ScrapeResult } from "./types.js";
import { htmlToMarkdown } from "./parsers/html.js";
import { stringifyJson } from "./parsers/json.js";
import { extractMetadata } from "./extractors/metadata.js";
import { extractLinks } from "./extractors/links.js";
import { extractImages, normalizeImages } from "./extractors/images.js";
import { extractText, truncate } from "./extractors/text.js";

function looksLikeHtml(contentType: string, text: string): boolean {
  if (contentType.includes("html") || contentType.includes("xhtml")) return true;
  return /^\s*<!doctype\s+html/i.test(text) || /<html[\s>]/i.test(text.slice(0, 2000));
}

function looksLikeJson(contentType: string, text: string): boolean {
  if (contentType.includes("json") || contentType.includes("jsonld")) return true;
  const t = text.trim();
  return t.startsWith("{") && t.endsWith("}");
}

function looksLikeXml(contentType: string): boolean {
  return contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom");
}

/**
 * Parse a fetched document into a ParsedDocument (markdown/text plus metadata
 * and extractors). Applies the requested output format and maxChars limit.
 */
export function parseContent(
  result: FetchResult,
  options: Pick<ScrapeOptions, "format" | "maxChars">,
): ScrapeResult {
  const contentType = result.contentType;
  const text = result.text;
  const maxChars = options.maxChars ?? 200_000;

  // --- HTML ---
  if (looksLikeHtml(contentType, text) || /\.html?$/i.test(result.url.split("?")[0] ?? "")) {
    const root = parseHtml(text);
    const markdown = htmlToMarkdown(root);
    const metadata = extractMetadata(root, result.url);
    const links = extractLinks(root, result.url);
    const images = normalizeImages(extractImages(root), result.url);
    const plainText = extractText(markdown);

    const format = resolveFormat(options.format, "markdown", contentType);
    const structured = {
      url: result.url,
      title: metadata.title ?? undefined,
      description: metadata.description ?? undefined,
      lang: metadata.lang ?? undefined,
      author: metadata.author ?? undefined,
      published_time: metadata.published_time ?? undefined,
      canonical_url: metadata.canonical_url ?? undefined,
      content: truncate(markdown, maxChars),
      links: links.slice(0, 200),
      images: images.slice(0, 200),
    };

    let content: string;
    if (format === "json") content = stringifyJson(structured, maxChars);
    else if (format === "text") content = truncate(plainText, maxChars);
    else content = truncate(markdown, maxChars);

    return {
      url: result.url,
      format,
      status: result.status,
      contentType,
      content,
      title: metadata.title,
      description: metadata.description,
      lang: metadata.lang,
      canonical_url: metadata.canonical_url,
      links,
      images,
      metadata,
      rawText: text,
    };
  }

  // --- JSON ---
  if (looksLikeJson(contentType, text)) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    const format = resolveFormat(options.format, "json", contentType);
    const markdown = stringifyJson(parsed, maxChars);
    const plainText = extractText(markdown);

    let content: string;
    if (format === "markdown") content = `\`\`\`json\n${markdown}\n\`\`\``;
    else if (format === "text") content = truncate(plainText, maxChars);
    else content = markdown;

    return {
      url: result.url,
      format: format === "markdown" ? "json" : format,
      status: result.status,
      contentType,
      content,
      links: [],
      images: [],
      metadata: {},
      rawText: text,
    };
  }

  // --- XML / RSS / Atom ---
  if (looksLikeXml(contentType)) {
    const format = resolveFormat(options.format, "markdown", contentType);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1] ?? undefined;
    const markdown = stringifyJson({ url: result.url, title, body: text.slice(0, maxChars) }, maxChars);
    return {
      url: result.url,
      format,
      status: result.status,
      contentType,
      content: format === "text" ? truncate(text, maxChars) : truncate(markdown, maxChars),
      title,
      links: [],
      images: [],
      metadata: {},
      rawText: text,
    };
  }

  // --- Markdown ---
  if (contentType.includes("markdown")) {
    const format = resolveFormat(options.format, "markdown", contentType);
    const content = format === "text" ? truncate(extractText(text), maxChars) : truncate(text, maxChars);
    return {
      url: result.url,
      format: format === "text" ? "text" : "markdown",
      status: result.status,
      contentType,
      content,
      links: [],
      images: [],
      metadata: {},
      rawText: text,
    };
  }

  // --- Plain text (and everything else text-ish) ---
  const format = resolveFormat(options.format, "text", contentType);
  const content = truncate(format === "markdown" ? text : extractText(text), maxChars);
  return {
    url: result.url,
    format,
    status: result.status,
    contentType,
    content,
    links: [],
    images: [],
    metadata: {},
    rawText: text,
  };
}

/** Resolve the effective output format (autodetect included). */
function resolveFormat(
  requested: ScrapeOptions["format"],
  fallback: "markdown" | "text" | "json",
  contentType: string,
): "markdown" | "text" | "json" {
  if (requested && requested !== "autodetect") return requested;
  if (requested === "autodetect") {
    if (contentType.includes("json")) return "json";
    if (contentType.includes("markdown")) return "markdown";
    if (contentType.includes("html")) return "markdown";
    return "text";
  }
  return fallback;
}