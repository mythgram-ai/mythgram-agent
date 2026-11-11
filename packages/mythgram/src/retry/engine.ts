import type { RetryEvent, RetrySettings } from "./types.js";
import { normalizeRetrySettings, resolveRetryDelay, retryMaxAttempts } from "./settings.js";

/** Options controlling a single retried operation. */
export interface RetryOptions {
  /** The retry policy. Undefined/absent → the default policy (retry ON). */
  settings?: Partial<RetrySettings> | RetrySettings;
  /**
   * Called right before each retry is scheduled. Fires only AFTER the first
   * failure (the initial attempt never triggers it). May return a value or a
   * promise; its resolution is awaited so callers can flush UI/SSE events.
   */
  onRetry?: (event: RetryEvent) => unknown;
  /** Abort signal. Once aborted the engine stops retrying and rethrows. */
  signal?: AbortSignal;
  /** Extra abort check (e.g. a shared cancellation flag) in addition to `signal`. */
  isAborted?: () => boolean;
  /**
   * Override the wait between attempts. Defaults to a real, abortable timer.
   * Primarily used by tests to run the schedule without real delays.
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** An error thrown when an in-flight retried operation is aborted. */
export function createAbortError(message = "Retry aborted"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function aborted(options: RetryOptions): boolean {
  return options.signal?.aborted === true || options.isAborted?.() === true;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Sleep for `ms`, resolving early (with an AbortError) when the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run an async operation with retries. Every failure is retried after the
 * configured delay; by default the policy retries indefinitely so a persistent
 * provider outage never kills the agent loop. The last error is rethrown only
 * when the policy is exhausted (`infinite: false`) or the operation is aborted.
 */
export async function runWithRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const settings = normalizeRetrySettings(options.settings);
  if (!settings.enabled) return operation();

  const wait = options.sleep ?? sleep;
  const maxAttempts = retryMaxAttempts(settings);
  let attempt = 0;

  for (;;) {
    if (aborted(options)) throw createAbortError();
    try {
      return await operation();
    } catch (error) {
      if (aborted(options)) throw error;
      attempt += 1;
      const delayMs = resolveRetryDelay(settings, attempt);
      if (delayMs === null) throw error;
      if (options.onRetry) {
        await options.onRetry({ attempt, maxAttempts, delayMs, error: toError(error), partial: false });
      }
      await wait(delayMs, options.signal);
    }
  }
}

/**
 * Run an async generator with retries while streaming its items through.
 *
 * Items are yielded to the consumer AS THEY ARRIVE (live streaming is preserved
 * for the common case, where the provider fails before emitting anything). On
 * failure the whole request is re-issued after the configured delay. When the
 * failed attempt had already emitted items AND `restartOnPartialStream` is
 * false, the error is surfaced instead of retried (a stream cannot un-emit).
 */
export async function* streamWithRetry<T>(
  factory: () => AsyncGenerator<T, void, unknown>,
  options: RetryOptions = {},
): AsyncGenerator<T, void, unknown> {
  const settings = normalizeRetrySettings(options.settings);
  if (!settings.enabled) {
    yield* factory();
    return;
  }

  const wait = options.sleep ?? sleep;
  const maxAttempts = retryMaxAttempts(settings);
  let attempt = 0;

  for (;;) {
    if (aborted(options)) throw createAbortError();
    let partial = false;
    try {
      for await (const item of factory()) {
        partial = true;
        yield item;
      }
      return;
    } catch (error) {
      if (aborted(options)) throw error;
      if (partial && !settings.restartOnPartialStream) throw error;
      attempt += 1;
      const delayMs = resolveRetryDelay(settings, attempt);
      if (delayMs === null) throw error;
      if (options.onRetry) {
        await options.onRetry({ attempt, maxAttempts, delayMs, error: toError(error), partial });
      }
      await wait(delayMs, options.signal);
    }
  }
}

/**
 * Serialize a {@link RetryEvent} into a plain, JSON-safe payload for an SSE
 * `retry` event (or a log line). `scope` names the agent type that is retrying
 * (e.g. "main", "chat", "team", "ceo", "promptagent", "memoryagent").
 */
export function retryEventPayload(event: RetryEvent, scope?: string): Record<string, unknown> {
  return {
    attempt: event.attempt,
    max_attempts: event.maxAttempts,
    delay_ms: event.delayMs,
    error: event.error.message,
    partial: event.partial,
    ...(scope ? { scope } : {}),
  };
}
