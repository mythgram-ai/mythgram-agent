/**
 * Minimal HTTP client for the image generation engine.
 *
 * Every outbound request goes through the global `fetch` with an
 * `AbortController` timeout and a typed error. The fetch implementation is
 * injectable so tests run entirely without network access. Redirects are
 * followed automatically by `fetch`.
 */

/** Default per-request timeout for listing calls (models). */
export const IMAGE_LIST_TIMEOUT_MS = 30_000;

/** Default per-request timeout for a generation call (image rendering can be slow). */
export const IMAGE_GENERATION_TIMEOUT_MS = 240_000;

/** A fetch-compatible function (defaults to the global `fetch`). */
export type ImageFetch = typeof fetch;

/** Error with a stable code and, when available, the upstream HTTP status. */
export class ImageGenError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "ImageGenError";
    this.code = code;
    this.status = status;
  }
}

export interface ImageRequestOptions {
  fetchFn?: ImageFetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Link an external abort signal to a timeout controller. */
function abortController(options: ImageRequestOptions): {
  controller: AbortController;
  clear: () => void;
} {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? IMAGE_LIST_TIMEOUT_MS;
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

async function performFetch(
  url: string,
  init: RequestInit,
  options: ImageRequestOptions,
): Promise<Response> {
  const fetchFn = options.fetchFn ?? fetch;
  const { controller, clear } = abortController(options);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ImageGenError("image_network_error", `Could not reach the image provider: ${reason}`);
  } finally {
    // Only connection establishment is bounded by the timeout; the body is read
    // after this returns, so clearing here is safe.
    clear();
  }
}

/** Perform a request whose successful body is JSON; throws `ImageGenError` otherwise. */
export async function imageRequestJson<T>(
  url: string,
  init: RequestInit,
  options: ImageRequestOptions = {},
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
    throw new ImageGenError("image_upstream_error", detail, response.status);
  }
  return payload as T;
}

/** Perform a request whose successful body is raw image bytes; throws otherwise. */
export async function imageRequestBinary(
  url: string,
  init: RequestInit,
  options: ImageRequestOptions = {},
): Promise<{ bytes: Uint8Array; contentType: string; headers: Headers }> {
  const response = await performFetch(url, init, options);
  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new ImageGenError(
      "image_upstream_error",
      detail || `Image provider returned HTTP ${response.status}.`,
      response.status,
    );
  }
  const contentType = response.headers.get("content-type") ?? "image/png";
  const buffer = await response.arrayBuffer();
  return { bytes: new Uint8Array(buffer), contentType, headers: response.headers };
}

/** Best-effort human message from a provider error envelope. */
export function errorDetail(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const nested = record.error;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
    if (nested && typeof nested === "object") {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    for (const key of ["message", "detail", "msg", "error_message"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value && typeof value === "object") {
        const param = (value as Record<string, unknown>).message;
        if (typeof param === "string" && param.trim()) return param.trim();
      }
    }
    // MiniMax-style envelope: base_resp.status_msg
    const baseResp = record.base_resp;
    if (baseResp && typeof baseResp === "object") {
      const msg = (baseResp as Record<string, unknown>).status_msg;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    }
  }
  return "";
}
