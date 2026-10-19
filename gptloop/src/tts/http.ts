/**
 * Shared HTTP helpers for the TTS provider adapters: fetch with a hard timeout
 * (plus the caller's abort signal), small JSON/binary readers, and one error
 * format that surfaces the provider's own message whenever possible.
 */
import type { TtsRequestContext } from "./types.js";

/** Hard timeout for a single TTS HTTP request (synthesis can be slow; 3 min). */
export const TTS_HTTP_TIMEOUT_MS = 180_000;

export class TtsHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(body ? `HTTP ${status}: ${body.slice(0, 600)}` : `HTTP ${status}`);
    this.name = "TtsHttpError";
    this.status = status;
    this.body = body;
  }
}

/** fetch() bounded by both the hard timeout and the caller's abort signal. */
export async function ttsFetch(
  url: string,
  init: RequestInit,
  ctx: TtsRequestContext | undefined,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_HTTP_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  ctx?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    ctx?.signal?.removeEventListener("abort", onAbort);
  }
}

/** Read the response body as text (bounded), for error reporting. */
async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** GET a JSON resource; throws TtsHttpError on any non-2xx. */
export async function ttsGetJson<T>(
  url: string,
  headers: Record<string, string>,
  ctx: TtsRequestContext | undefined,
): Promise<T> {
  const response = await ttsFetch(url, { method: "GET", headers }, ctx);
  const text = await readBody(response);
  if (!response.ok) throw new TtsHttpError(response.status, text);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TtsHttpError(response.status, `Invalid JSON response: ${text.slice(0, 300)}`);
  }
}

/** POST a JSON body and parse the JSON response; throws TtsHttpError on any non-2xx. */
export async function ttsPostJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  ctx: TtsRequestContext | undefined,
): Promise<T> {
  const response = await ttsFetch(
    url,
    { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) },
    ctx,
  );
  const text = await readBody(response);
  if (!response.ok) throw new TtsHttpError(response.status, text);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TtsHttpError(response.status, `Invalid JSON response: ${text.slice(0, 300)}`);
  }
}

/** POST a JSON body and return the raw binary audio response; throws on any non-2xx. */
export async function ttsPostForBinary(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  ctx: TtsRequestContext | undefined,
): Promise<{ audio: Buffer; contentType: string }> {
  const response = await ttsFetch(
    url,
    { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) },
    ctx,
  );
  if (!response.ok) throw new TtsHttpError(response.status, await readBody(response));
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) throw new TtsHttpError(response.status, "Provider returned an empty audio response.");
  return { audio, contentType };
}

/** POST raw text (SSML etc.) and return the raw binary audio response; throws on any non-2xx. */
export async function ttsPostRawForBinary(
  url: string,
  headers: Record<string, string>,
  body: string,
  ctx: TtsRequestContext | undefined,
): Promise<{ audio: Buffer; contentType: string }> {
  const response = await ttsFetch(url, { method: "POST", headers, body }, ctx);
  if (!response.ok) throw new TtsHttpError(response.status, await readBody(response));
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) throw new TtsHttpError(response.status, "Provider returned an empty audio response.");
  return { audio, contentType };
}

/**
 * Extract the most useful message from a provider error body — providers use
 * many shapes (OpenAI envelopes, {detail}, {message}, plain text).
 */
export function messageFromBody(body: string): string {
  const text = body.trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const error = record.error;
      if (typeof error === "string") return error;
      if (error && typeof error === "object") {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === "string" && message.trim()) return message;
      }
      for (const key of ["message", "detail", "status_msg", "msg"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value;
      }
    }
  } catch {
    // Plain-text body — use it verbatim below.
  }
  return text.slice(0, 400);
}

/** Throw a descriptive Error for a failed TTS provider call. */
export function throwTtsProviderError(provider: string, error: unknown): never {
  if (error instanceof TtsHttpError) {
    const message = messageFromBody(error.body);
    throw new Error(
      `${provider} TTS request failed (HTTP ${error.status})${message ? `: ${message}` : "."}`,
    );
  }
  if (error instanceof Error && error.name === "AbortError") {
    throw new Error(`${provider} TTS request timed out or was cancelled.`);
  }
  throw error instanceof Error ? error : new Error(String(error));
}

/** Normalize a base URL: trim, strip trailing slashes. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Normalize an OpenAI-compatible speech base URL: the user may paste the bare
 * origin ("http://127.0.0.1:8000") or the full API root (".../v1"). The speech
 * endpoint is always `{root}/audio/speech`, so ensure the root ends with `/v1`
 * when the URL has no path (or a root-level path only).
 */
export function normalizeOpenAiSpeechBaseUrl(raw: string): string {
  const base = normalizeBaseUrl(raw);
  if (!base) return base;
  try {
    const parsed = new URL(base);
    const path = parsed.pathname.replace(/\/+$/, "");
    if (path === "" || path === "/") parsed.pathname = "/v1";
    return normalizeBaseUrl(parsed.toString());
  } catch {
    return base;
  }
}
