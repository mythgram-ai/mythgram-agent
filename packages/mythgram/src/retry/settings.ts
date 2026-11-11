import type { RetryAttemptSetting, RetrySettings } from "./types.js";

/**
 * The factory-default retry schedule, in milliseconds. Matches the product
 * specification exactly:
 *
 *   attempt 1 → wait 5s,   attempt 2 → wait 10s, attempt 3 → wait 15s,
 *   attempt 4 → wait 25s,  attempt 5 → wait 30s, attempt 6 → wait 1 min,
 *   attempt 7 → wait 2 min.
 *
 * After the 7th attempt the default policy keeps the 2-minute cadence forever
 * (`infinite: true`), so an autonomous turn never gives up on a provider that
 * keeps failing.
 */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [
  5_000, 10_000, 15_000, 25_000, 30_000, 60_000, 120_000,
];

/** Smallest/largest delay a user may configure (1 second … 1 hour). */
const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 3_600_000;
/** Upper bound on the number of configurable attempts (guards against abuse). */
const MAX_ATTEMPTS = 100;
/** Fallback delay used when the user removes every attempt but keeps retrying on. */
const FALLBACK_DELAY_MS = 120_000;

/** A fresh mutable copy of the default retry settings (deep-cloned schedule). */
export function defaultRetrySettings(): RetrySettings {
  return {
    enabled: true,
    attempts: DEFAULT_RETRY_DELAYS_MS.map((delayMs) => ({ delayMs })),
    infinite: true,
    restartOnPartialStream: true,
  };
}

/** Boolean coercion that understands the frontend's "yes"/"no" settings shape. */
function toBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "yes" || value === "on" || value === 1 || value === "true") return true;
  if (value === false || value === "no" || value === "off" || value === 0 || value === "false") return false;
  return fallback;
}

/** Coerce one delay value (number of ms, or seconds when it looks like seconds). */
function coerceDelayMs(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.round(n)));
}

/**
 * Parse the (untrusted) attempts payload. Accepts a list of numbers
 * (`[5000, 10000]`), a list of `{ delayMs }` / `{ delay_ms }` / `{ delay }`
 * objects, or a comma-separated string ("5000,10000"). Invalid entries are
 * dropped; an empty result falls back to the default schedule.
 */
function coerceAttempts(raw: unknown): RetryAttemptSetting[] {
  let items: unknown[] = [];
  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    items = raw.split(",");
  }
  const out: RetryAttemptSetting[] = [];
  for (const item of items) {
    let candidate: unknown = item;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      candidate = record.delayMs ?? record.delay_ms ?? record.delay ?? record.ms;
    }
    const delayMs = coerceDelayMs(candidate);
    if (delayMs !== null) out.push({ delayMs });
    if (out.length >= MAX_ATTEMPTS) break;
  }
  if (out.length === 0) return DEFAULT_RETRY_DELAYS_MS.map((delayMs) => ({ delayMs }));
  return out;
}

/**
 * Defensively normalize a retry payload from the wire (or persisted state) into
 * a valid {@link RetrySettings}. Never throws; absent fields fall back to the
 * defaults (retry ON). This is the single source of truth for the retry policy
 * on the server.
 */
export function sanitizeRetrySettings(raw: unknown): RetrySettings {
  const defaults = defaultRetrySettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const record = raw as Record<string, unknown>;
  return {
    enabled: toBoolean(record.enabled, defaults.enabled),
    attempts: "attempts" in record ? coerceAttempts(record.attempts) : defaults.attempts,
    infinite: toBoolean(record.infinite, defaults.infinite),
    restartOnPartialStream: toBoolean(
      record.restartOnPartialStream ?? record.restart_on_partial_stream,
      defaults.restartOnPartialStream,
    ),
  };
}

/**
 * Normalize a possibly-partial policy for internal engine use. Guarantees an
 * `attempts` array with at least one entry whenever retries are enabled.
 */
export function normalizeRetrySettings(raw: Partial<RetrySettings> | RetrySettings | undefined): RetrySettings {
  if (!raw) return defaultRetrySettings();
  return sanitizeRetrySettings(raw);
}

/**
 * Resolve the delay (ms) to wait before retry `attempt` (1-based). Returns null
 * when the policy has been exhausted and is not set to retry indefinitely.
 */
export function resolveRetryDelay(settings: RetrySettings, attempt: number): number | null {
  const attempts = settings.attempts.length > 0 ? settings.attempts : [{ delayMs: FALLBACK_DELAY_MS }];
  if (attempt >= 1 && attempt <= attempts.length) {
    return attempts[attempt - 1]!.delayMs;
  }
  if (settings.infinite) {
    return attempts[attempts.length - 1]!.delayMs;
  }
  return null;
}

/** Total configured attempts, or null when the policy retries indefinitely. */
export function retryMaxAttempts(settings: RetrySettings): number | null {
  return settings.infinite ? null : settings.attempts.length;
}
