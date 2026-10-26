/**
 * Robust HTTP fetcher for the scraper. Handles redirects, keeps a realistic
 * User-Agent, sends/agrees to common content-encodings, and detects the charset
 * so Unicode pages decode correctly regardless of how the server declares it.
 *
 * Relies on Node/undici's global fetch (which follows redirects and transparently
 * decompresses gzip/deflate/br), so we only layer on charset detection, a timeout,
 * and metadata capture.
 */
import type { FetchResult, ResourceLink, ExtractedImage } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

/** A reasonably representative browser User-Agent so sites don't reject us. */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Decode a BufferSource using an explicit encoding. Throws when the encoder is
 * unknown -- the caller falls back to utf-8.
 */
function decodeWith(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    throw new Error(`Unsupported charset: ${encoding}`);
  }
}

/**
 * Determine the charset to use. Priority: HTTP Content-Type header, then an
 * HTML `<meta charset>` (first 1024 bytes), then utf-8.
 */
function detectCharset(bytes: Uint8Array, contentTypeHeader: string): string {
  const fromHeader = /charset=([^;\s]+)/i.exec(contentTypeHeader);
  if (fromHeader?.[1]) return fromHeader[1];

  const head = new TextDecoder("utf-8").decode(bytes.slice(0, 1024));
  const meta = /<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9_-]+)/i.exec(head);
  if (meta?.[1]) return meta[1];

  return "utf-8";
}

function normalizeContentType(raw: string): string {
  return raw.split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Fetch a URL and return a decoded FetchResult. Binary content (images, PDFs,
 * etc.) yields an empty `text` but a correct contentType so callers can act on
 * the MIME type.
 */
export async function fetchUrl(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/json,text/markdown,text/plain,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        ...opts.headers,
      },
    });

    const finalUrl = response.url || url;
    const contentTypeHeader = response.headers.get("content-type") ?? "";
    const contentType = normalizeContentType(contentTypeHeader);
    const status = response.status;

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Only decode text-ish bodies; skip binary (images, pdf, audio, video, zip...).
    if (
      contentType.startsWith("text/") ||
      contentType.includes("javascript") ||
      contentType.includes("json") ||
      contentType.includes("xml") ||
      contentType.includes("markdown")
    ) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      let text = "";
      try {
        text = decodeWith(bytes, detectCharset(bytes, contentTypeHeader));
      } catch {
        text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      }
      return { url: finalUrl, status, contentType, text, headers };
    }

    // Non-text body: consume (so the connection can be reused) but return no text.
    await response.arrayBuffer().catch(() => undefined);
    return { url: finalUrl, status, contentType, text: "", headers };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Resolve a possibly-relative URL against a base URL; returns "" when invalid. */
export function absolutize(href: string, baseUrl: string): string {
  const clean = href.trim();
  if (!clean) return "";
  // Allow protocol-relative (//host/...) and absolute URLs.
  try {
    return new URL(clean, baseUrl).href;
  } catch {
    return "";
  }
}

/** True when a resolved URL is same-origin with `baseUrl`. */
export function isSameOrigin(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Drop links that are navigation-only / non-navigable (javascript:, mailto:,
 * tel:, data:, bare hashes, empty). Also deduplicates by URL.
 */
export function normalizeLinks(links: ResourceLink[], baseUrl: string): ResourceLink[] {
  const seen = new Set<string>();
  const out: ResourceLink[] = [];
  for (const link of links) {
    const href = link.url.trim();
    if (!href) continue;
    // Pure in-page anchors (e.g. "#section") are navigation-only, not links.
    if (href.startsWith("#")) continue;

    const abs = absolutize(href, baseUrl);
    if (!abs) continue;
    const url = new URL(abs);
    const noHash = abs.replace(url.hash, "").replace(/#$/, "");
    if (!noHash) continue; // pure fragment
    const scheme = url.protocol.toLowerCase();
    if (!/^https?:$/.test(scheme)) continue;
    // A link resolving to the page itself is navigation, not a link.
    if (noHash === baseUrl) continue;
    if (seen.has(noHash)) continue;
    seen.add(noHash);
    out.push({ ...link, url: noHash });
  }
  return out;
}

/** Normalize image URLs: absolutize, keep http(s)/data, dedupe. */
export function normalizeImages(images: ExtractedImage[], baseUrl: string): ExtractedImage[] {
  const seen = new Set<string>();
  const out: ExtractedImage[] = [];
  for (const image of images) {
    const abs = absolutize(image.url, baseUrl);
    if (!abs) continue;
    const scheme = new URL(abs).protocol.toLowerCase();
    if (scheme !== "https:" && scheme !== "http:") {
      // Allow data URIs for inline images.
      if (!image.url.startsWith("data:")) continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ ...image, url: abs });
  }
  return out;
}