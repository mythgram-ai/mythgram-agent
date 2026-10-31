/**
 * Minimal HTTP client for the TTS engine.
 *
 * Every outbound request goes through the global `fetch` with an
 * `AbortController` timeout and a typed error. The fetch implementation is
 * injectable so tests run entirely without network access. Redirects are
 * followed automatically by `fetch` (KittenML relies on this — a capacity
 * redirect must not be treated as a final response).
 */

/** Default per-request timeout for listing calls (models / voices). */
export const TTS_LIST_TIMEOUT_MS = 30_000;

/** Default per-request timeout for a synthesis call (may generate long audio). */
export const TTS_SYNTHESIS_TIMEOUT_MS = 300_000;

/** A fetch-compatible function (defaults to the global `fetch`). */
export type TtsFetch = typeof fetch;

/** Error with a stable code and, when available, the upstream HTTP status. */
export class TtsError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "TtsError";
    this.code = code;
    this.status = status;
  }
}

export interface TtsRequestOptions {
  fetchFn?: TtsFetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Link an external abort signal to a timeout controller. */
function abortController(options: TtsRequestOptions): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? TTS_LIST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const external = options.signal;
  const onAbort = (): void => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener("abort", onAbort, { once: true });
  }
  return {
    controller,
    clear: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    const trimmed = text.trim();
    // Error bodies are usually JSON envelopes; extract a readable message.
    try {
      const message = errorDetail(JSON.parse(trimmed));
      if (message) return message.slice(0, 500);
    } catch {
      // not JSON — fall through to the raw text
    }
    return trimmed.slice(0, 500);
  } catch {
    return "";
  }
}

async function performFetch(url: string, init: RequestInit, options: TtsRequestOptions): Promise<Response> {
  const fetchFn = options.fetchFn ?? fetch;
  const { controller, clear } = abortController(options);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TtsError("tts_network_error", `Could not reach the TTS provider: ${reason}`);
  } finally {
    // The response body is read after this returns; only the connection
    // establishment is bounded by the timeout, so clearing here is safe.
    clear();
  }
}

/** Perform a request whose successful body is JSON; throws `TtsError` otherwise. */
export async function ttsRequestJson<T>(
  url: string,
  init: RequestInit,
  options: TtsRequestOptions = {},
): Promise<T> {
  const response = await performFetch(url, init, options);
  let payload: unknown = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const detail = errorDetail(payload) || `HTTP ${response.status}`;
    throw new TtsError("tts_upstream_error", `${detail}`, response.status);
  }
  return payload as T;
}

/** Perform a request whose successful body is raw audio bytes; throws otherwise. */
export async function ttsRequestAudio(
  url: string,
  init: RequestInit,
  options: TtsRequestOptions = {},
): Promise<{ bytes: Uint8Array; contentType: string; headers: Headers }> {
  const response = await performFetch(url, init, options);
  if (!response.ok) {
    // Error responses are JSON (or text) envelopes, never audio.
    const detail = await readErrorBody(response);
    throw new TtsError(
      "tts_upstream_error",
      detail || `TTS provider returned HTTP ${response.status}.`,
      response.status,
    );
  }
  const contentType = response.headers.get("content-type") ?? "audio/mpeg";
  const buffer = await response.arrayBuffer();
  return { bytes: new Uint8Array(buffer), contentType, headers: response.headers };
}

/** Best-effort human message from a provider error envelope. */
function errorDetail(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const nested = record.error;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
    if (nested && typeof nested === "object") {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    for (const key of ["message", "detail", "msg"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value && typeof value === "object") {
        const param = (value as Record<string, unknown>).message;
        if (typeof param === "string" && param.trim()) return param.trim();
      }
    }
  }
  return "";
}
