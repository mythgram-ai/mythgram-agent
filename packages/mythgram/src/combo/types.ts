/**
 * Provider combo system — shared types.
 *
 * A "provider combo" is a user-created, ordered list of provider+model pairs that
 * keeps a turn alive when a provider throws. Unlike the fallback system (which
 * retries the SAME provider until its retry budget is exhausted, then switches),
 * the combo system moves to the NEXT provider the moment the current one fails —
 * there is NO retry on any provider except the LAST one in the combo:
 *
 *  - The FIRST entry is the provider/model active for chat.
 *  - If an entry throws, it is never reused for later calls in this combo; the
 *    system switches straight to the next entry (the core combo behavior).
 *  - Only the LAST entry runs with the full retry policy — retry is the very last
 *    resort, once every combo provider has already failed.
 *
 * A combo requires at least two entries. When a combo is active the fallback
 * system is NOT used (no fallback provider, no fallback API key): the combo is the
 * resilience layer for that turn.
 *
 * Like retry and fallback, the combo layer is deliberately error-agnostic: there
 * is NO error classification — any thrown error counts as a failure and advances
 * the combo.
 */

/**
 * One entry in a provider combo: a provider id plus the model (and optional
 * credentials) to use. `provider` is a built-in id, `"local"`, or a
 * `"custom_"`-prefixed id carrying its full config in `customProvider`.
 */
export interface ComboEntry {
  /** Stable id (used to key/remove entries in the UI). */
  id: string;
  /** Provider id: a built-in id, `"local"`, or a `"custom_"`-prefixed id. */
  provider: string;
  /** Model id to use for this entry (required for a combo to be usable). */
  model: string;
  /** API key for this entry (may be empty for local servers). */
  apiKey: string;
  /** Optional base URL override for this entry. */
  baseUrl?: string;
  /** Full custom-provider config, present when `provider` is a `custom_` id. */
  customProvider?: unknown;
}

/**
 * The active combo payload that travels with a turn (from the frontend Settings).
 * A combo is "active" when `enabled` is true and it has at least two entries.
 */
export interface ComboSettings {
  /** Whether combo mode is on for this turn. Defaults to false. */
  enabled: boolean;
  /** Id of the active combo (for the active-index state key). */
  comboId?: string;
  /** Display name of the active combo (for events/labels). */
  name?: string;
  /** Ordered combo entries: the first is primary, the last is the retry endpoint. */
  entries: ComboEntry[];
}

/** Info about a combo switch, passed to the optional callback. */
export interface ComboEvent {
  /** Id of the active combo. */
  comboId?: string;
  /** Display name of the active combo. */
  comboName?: string;
  /** 1-based number of the combo entry that took over (entry 1 is the primary). */
  index: number;
  /** Total number of entries in the combo. */
  total: number;
  /** Provider id of the entry that took over. */
  provider: string;
  /** Model id of the entry that took over. */
  model: string;
  /** The error that exhausted the previous entry. */
  error: Error;
  /** Agent scope that triggered the switch (e.g. "main", "chat", "team"). */
  scope?: string;
}
