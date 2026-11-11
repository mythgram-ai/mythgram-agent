/**
 * Fallback system — shared types.
 *
 * The fallback system is the resilience layer ABOVE the retry engine. Where the
 * retry engine keeps re-issuing a failed request against the SAME provider, the
 * fallback system switches to a DIFFERENT target once every retry attempt of the
 * current target has failed:
 *
 *  - `provider`: switch to a different model provider and/or model (any built-in,
 *    local, or user-defined custom provider).
 *  - `api`: switch to another API key of the SAME provider (same provider/model,
 *    different credential).
 *
 * Once a fallback target takes over it becomes the ACTIVE target for every later
 * request, so the previously failing provider is never used again for that
 * primary configuration (see the state store in `state.ts`).
 *
 * Like the retry engine the fallback system is deliberately error-agnostic:
 * there is NO error classification; any thrown error counts as a failure.
 */

/** Which fallback strategy is active: switch provider or switch API key. */
export type FallbackMethod = "provider" | "api";

/**
 * One fallback target. The same shape is used for both methods:
 *  - `provider` method: `provider`/`model`/`apiKey`/`baseUrl` fully describe the
 *    destination provider and model.
 *  - `api` method: `provider`/`model` usually mirror the primary, while `apiKey`
 *    (and optionally `baseUrl`) carry the alternate credential.
 */
export interface FallbackTarget {
  /** Stable id (used to key/remove entries in the UI). */
  id: string;
  /** Provider id: a built-in id, `"local"`, or a `"custom_"`-prefixed id. */
  provider: string;
  /** Model id to use for this target. Empty falls back to the primary model. */
  model: string;
  /** API key for this target (may be empty for local servers). */
  apiKey: string;
  /** Optional base URL override for this target. */
  baseUrl?: string;
  /** Full custom-provider config, present when `provider` is a `custom_` id. */
  customProvider?: unknown;
}

/** User-configurable fallback policy. Travels with each turn from the frontend. */
export interface FallbackSettings {
  /** Master on/off switch. Defaults to false (fallback OFF). */
  enabled: boolean;
  /** Selected strategy. Defaults to `"api"`. */
  method: FallbackMethod;
  /** Ordered fallback chain used when `method === "provider"`. */
  providers: FallbackTarget[];
  /** Ordered fallback chain used when `method === "api"`. */
  apis: FallbackTarget[];
}

/** Info about a fallback activation, passed to the optional callback. */
export interface FallbackEvent {
  /** The strategy that activated. */
  method: FallbackMethod;
  /** 1-based number of the fallback target that took over (primary is not a fallback). */
  index: number;
  /** Total number of configured fallback targets. */
  total: number;
  /** Provider id of the target that took over. */
  provider: string;
  /** Model id of the target that took over. */
  model: string;
  /** The error that exhausted the previous target. */
  error: Error;
  /** Agent scope that triggered the fallback (e.g. "main", "chat", "team"). */
  scope?: string;
}
