/**
 * Shared helpers for the reasoning-effort control that every provider honors.
 *
 * The frontend lets the user pick a reasoning effort — one of the four presets
 * (`low`, `medium`, `high`, `max`) or a custom string their model understands.
 * That value travels with each request and is applied to the outgoing
 * chat/completions body here so behavior is identical across all providers.
 *
 * Portability notes:
 *  - The OpenAI-compatible `reasoning_effort` field officially accepts
 *    `minimal | low | medium | high`. `max` is our UI alias for "the strongest
 *    reasoning tier the standard field supports", so it maps to `high` on the
 *    wire. Custom values are forwarded verbatim for advanced models/providers.
 *  - Providers that don't implement reasoning simply ignore the extra field, so
 *    an unsupported model keeps working normally.
 *  - OpenRouter uses a nested `reasoning: { effort }` object instead of the flat
 *    field; it overrides `buildRequestBody` and calls {@link openRouterEffort}.
 */

/** The built-in effort presets shown as buttons in the UI. */
export const EFFORT_PRESETS = ["low", "medium", "high", "max"] as const;

export type EffortPreset = (typeof EFFORT_PRESETS)[number];

/**
 * Normalize an incoming effort value. Trims whitespace and lower-cases known
 * presets; returns `undefined` when nothing usable was provided (so callers can
 * omit the field entirely and keep default provider behavior).
 */
export function normalizeEffort(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if ((EFFORT_PRESETS as readonly string[]).includes(lower)) return lower;
  // A custom value the user typed — forward as-is (advanced models/providers).
  return trimmed;
}

/**
 * Translate a normalized effort into the value sent in the flat OpenAI-style
 * `reasoning_effort` field. `max` is aliased to `high` (the field's ceiling);
 * everything else (presets and custom strings) passes through unchanged.
 */
export function reasoningEffortValue(effort: string): string {
  return effort === "max" ? "high" : effort;
}

/**
 * Mutate an OpenAI-compatible request body to carry the reasoning effort using
 * the flat `reasoning_effort` field. No-op when `effort` is empty/undefined so
 * unsupported models are unaffected.
 */
export function applyReasoningEffort(
  body: Record<string, unknown>,
  effort: string | undefined,
): Record<string, unknown> {
  const normalized = normalizeEffort(effort);
  if (!normalized) return body;
  body.reasoning_effort = reasoningEffortValue(normalized);
  return body;
}

/**
 * Build the value for OpenRouter's nested `reasoning: { effort }` object, or
 * `undefined` when no effort was requested.
 */
export function openRouterEffort(
  effort: string | undefined,
): { effort: string } | undefined {
  const normalized = normalizeEffort(effort);
  if (!normalized) return undefined;
  return { effort: reasoningEffortValue(normalized) };
}
