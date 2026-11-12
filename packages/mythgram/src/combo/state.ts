import type { ComboEntry, ComboSettings } from "./types.js";

/**
 * Process-wide memory of which combo entry is currently ACTIVE for a given combo.
 * Once an entry fails it is never used again for that combo — every later request
 * starts at the next entry (the required combo behavior). The active index only
 * moves forward while the combo's entry chain is unchanged; editing the combo (or
 * switching combos) changes the state key and resets to the first entry.
 *
 * This is intentionally in-memory: it is a runtime resilience layer, not user
 * configuration. A process restart re-tries the first provider.
 */
interface ActiveState {
  key: string;
  /** Index into the entry array (0 = first entry). */
  index: number;
}

const MAX_ENTRIES = 500;
const states = new Map<string, ActiveState>();

/** Build the stable state key for one combo configuration. */
export function comboStateKey(
  settings: ComboSettings,
  entries: Array<Pick<ComboEntry, "provider" | "model" | "baseUrl" | "apiKey">>,
): string {
  return JSON.stringify({
    c: settings.comboId ?? settings.name ?? "",
    chain: entries.map((entry) => [entry.provider, entry.model, entry.baseUrl ?? "", entry.apiKey.trim().length > 0]),
  });
}

/** The active entry index for a combo state key (0 = first entry when unknown). */
export function getActiveComboIndex(key: string): number {
  const state = states.get(key);
  return state ? state.index : 0;
}

/** Remember that `index` is the active entry for a combo state key. */
export function setActiveComboIndex(key: string, index: number): void {
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

/** Drop the active-combo memory for a key (or all keys when omitted). */
export function resetActiveCombo(key?: string): void {
  if (key === undefined) states.clear();
  else states.delete(key);
}
