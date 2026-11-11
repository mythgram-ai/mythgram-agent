import type { FallbackSettings } from "./types.js";

/**
 * Process-wide memory of which fallback target is currently ACTIVE for a given
 * primary configuration. Once a provider/api fallback takes over, every later
 * request for the same primary configuration must use that fallback — the
 * previously failing provider is never used again (the required resilience
 * behavior). State naturally resets when the primary configuration, method, or
 * target chain changes, because those all contribute to the state key.
 *
 * This is intentionally in-memory: it is a runtime resilience layer, not user
 * configuration. A process restart re-tries the primary.
 */
interface ActiveState {
  key: string;
  /** Index into the candidate array (0 = primary, 1.. = fallback targets). */
  index: number;
}

const MAX_ENTRIES = 500;
const states = new Map<string, ActiveState>();

/** Build the stable state key for one primary configuration + fallback chain. */
export function fallbackStateKey(
  providerId: string,
  model: string,
  baseUrl: string,
  settings: FallbackSettings,
  /** The candidate signatures (provider/model/baseUrl/apiKey-presence), in order. */
  candidates: Array<{ providerId: string; model: string; baseUrl: string; hasKey: boolean }>,
): string {
  return JSON.stringify({
    p: providerId,
    m: model,
    b: baseUrl,
    method: settings.method,
    chain: candidates.map((c) => [c.providerId, c.model, c.baseUrl, c.hasKey]),
  });
}

/** The active candidate index for a state key (0 = primary when unknown). */
export function getActiveFallbackIndex(key: string): number {
  const state = states.get(key);
  return state ? state.index : 0;
}

/** Remember that `index` is the active candidate for a state key. */
export function setActiveFallbackIndex(key: string, index: number): void {
  if (index <= 0) {
    states.delete(key);
    return;
  }
  if (states.size >= MAX_ENTRIES && !states.has(key)) {
    // Cheap bound: drop the oldest entry (Map preserves insertion order).
    const oldest = states.keys().next().value;
    if (oldest !== undefined) states.delete(oldest);
  }
  states.set(key, { key, index });
}

/** Drop the active-fallback memory for a key (or all keys when omitted). */
export function resetActiveFallback(key?: string): void {
  if (key === undefined) states.clear();
  else states.delete(key);
}

/** Build the candidate signature list used by {@link fallbackStateKey}. */
export function candidateSignature(
  providerId: string,
  model: string,
  baseUrl: string,
  apiKey: string,
): { providerId: string; model: string; baseUrl: string; hasKey: boolean } {
  return { providerId, model, baseUrl, hasKey: apiKey.trim().length > 0 };
}
