/**
 * Centralized connectivity primitives shared by every network path (main agent, every
 * sub-agent stream, tool/API calls, background reconnects).
 *
 * The single guiding rule: a SLOW network is never a failure. Only a fully-disconnected
 * device is "offline". We never impose a client-side request timeout — a request waits as
 * long as the connection stays alive, however slow. `AbortController` is reserved strictly
 * for explicit user cancellation.
 */

/** True when the browser believes it has a network interface with connectivity. */
export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/** Sleep for `ms`, resolving early (rejecting) if `signal` aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resolve as soon as the device reports it is back online. If already online, resolves on the
 * next tick. Rejects (AbortError) if `signal` aborts while waiting. This is how we "patiently
 * wait for the connection to recover" instead of failing — the agent keeps running server-side.
 */
export function waitUntilOnline(signal?: AbortSignal): Promise<void> {
  if (isOnline()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("online", onOnline);
      signal?.removeEventListener("abort", onAbort);
    };
    const onOnline = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    window.addEventListener("online", onOnline);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Whether an error represents an explicit abort (user pressed Stop / component teardown). */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (error instanceof Error && error.name === "AbortError");
}

/**
 * Capped exponential backoff between reconnect attempts, so we neither hammer the server nor
 * give up. This is a pause between attempts — NOT a timeout on any single request.
 */
export function reconnectBackoff(attempt: number): number {
  const base = 400;
  const max = 4000;
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.min(max, base * 2 ** Math.min(attempt, 4)) * jitter;
}

/**
 * Fetch a same-origin `/api/*` route with resilient semantics: retries on transient network
 * failures for a bounded number of attempts, waiting for connectivity to return when offline,
 * and NEVER applying a timeout to a request that is making progress. Used for non-streaming
 * JSON endpoints (providers, models, files, scrape). Streaming uses the dedicated engine.
 */
export async function resilientFetch(
  input: string,
  init: RequestInit = {},
  options: { retries?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  const retries = options.retries ?? 3;
  const signal = options.signal;
  let attempt = 0;

  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      // Wait for connectivity before even attempting, if we know we're offline.
      if (!isOnline()) await waitUntilOnline(signal);
      return await fetch(input, { ...init, signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      // A thrown fetch is a genuine connection failure (DNS/refused/dropped), not a slow one.
      if (attempt >= retries) throw error;
      if (!isOnline()) {
        await waitUntilOnline(signal);
      } else {
        await delay(reconnectBackoff(attempt), signal);
      }
      attempt += 1;
    }
  }
}
