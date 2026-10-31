import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import { scrapePage } from "../scraper/scraper.js";

/**
 * URL → knowledge fetch endpoint. The Knowledge popup's "URL" method calls this to fetch a page's
 * content with the free, keyless built-in scraper before the user names and saves it as a knowledge
 * file. Supports optional custom headers / API key and a pasted `curl` command (from which the URL
 * and headers are parsed). This is a read-only fetch — nothing is persisted server-side; the browser
 * owns the resulting knowledge file.
 */
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_CONTENT_CHARS = 500_000;

interface ScrapeBody {
  url?: unknown;
  /** HTTP method label — only GET-style content fetches are supported by the scraper. */
  method?: unknown;
  /** Output format: markdown (default), text, json, or autodetect. */
  format?: unknown;
  /** Custom request headers, as an object or an array of {key,value} pairs. */
  headers?: unknown;
  /** Optional API key; sent as `Authorization: Bearer <key>` unless a header already sets it. */
  apiKey?: unknown;
  /** Optional pasted curl command; its URL + `-H` headers override the fields above. */
  curl?: unknown;
}

type Format = "markdown" | "text" | "json" | "autodetect";

function toFormat(value: unknown): Format {
  return value === "text" || value === "json" || value === "autodetect" ? value : "markdown";
}

/** Coerce a headers value (object or [{key,value}]) into a flat, non-empty header record. */
function normalizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const key = typeof rec.key === "string" ? rec.key.trim() : "";
      const value = typeof rec.value === "string" ? rec.value : "";
      if (key) out[key] = value;
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key.trim() && typeof value === "string") out[key.trim()] = value;
    }
  }
  return out;
}

/**
 * Minimal, defensive parser for a pasted `curl` command. Extracts the first URL, any `-H`/`--header`
 * headers, and a bearer token from `--oauth2-bearer`. Never throws; unknown flags are ignored.
 */
export function parseCurl(curl: string): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  let url = "";

  // Tokenize respecting single/double quotes.
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(curl)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "-H" || token === "--header") {
      const header = tokens[++i];
      if (header) {
        const idx = header.indexOf(":");
        if (idx > 0) headers[header.slice(0, idx).trim()] = header.slice(idx + 1).trim();
      }
    } else if (token === "--oauth2-bearer") {
      const bearer = tokens[++i];
      if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    } else if (token === "--url") {
      const explicit = tokens[++i];
      if (explicit) url = explicit;
    } else if (token === "-X" || token === "--request" || token === "-d" || token === "--data") {
      // Skip the following value (method / body) — content-only fetch ignores it.
      i++;
    } else if (/^https?:\/\//i.test(token) && !url) {
      url = token;
    }
  }

  return { url, headers };
}

function timeoutSignal(): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

export function buildScrapeRouter(_config: AppConfig): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ScrapeBody;

    let url = typeof body.url === "string" ? body.url.trim() : "";
    let headers = normalizeHeaders(body.headers);

    // A pasted curl command overrides the URL and merges its headers on top.
    const curl = typeof body.curl === "string" ? body.curl.trim() : "";
    if (curl) {
      const parsed = parseCurl(curl);
      if (parsed.url) url = parsed.url;
      headers = { ...headers, ...parsed.headers };
    }

    // An explicit API key becomes an Authorization header unless one is already set.
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (apiKey && !Object.keys(headers).some((h) => h.toLowerCase() === "authorization")) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    if (!url || !/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: "A valid http(s) URL is required (or a curl command containing one)." });
      return;
    }

    const { signal, cleanup } = timeoutSignal();
    try {
      const result = await scrapePage({
        url,
        format: toFormat(body.format),
        maxChars: MAX_CONTENT_CHARS,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal,
      });

      res.json({
        ok: true,
        url: result.url,
        status: result.status,
        format: result.format,
        title: result.title ?? "",
        description: result.description ?? "",
        content: result.content,
        content_type: result.contentType,
      });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      cleanup();
    }
  });

  return router;
}
