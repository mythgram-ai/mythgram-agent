/**
 * Provider combo system — public surface.
 *
 * A combo is a user-created, ordered list of provider+model pairs that keeps a
 * turn alive when a provider throws. Unlike the retry engine (which re-issues the
 * SAME request) and the fallback system (which retries a provider until its budget
 * is exhausted before moving on), the combo system switches to the NEXT provider
 * IMMEDIATELY on any error and never reuses the failed provider for that combo.
 * Retry is the LAST resort: it runs ONLY on the final entry of the combo, once
 * every other provider has already failed. A combo and a fallback are mutually
 * exclusive — when a combo is active, no fallback provider or API key is used.
 *
 * It applies to every agent type (main, custom, sub-agent, memory agent, context
 * summarization, prompt agent, chat mode, and multi-agent team members/leaders/CEO)
 * and to every provider (local, built-in, custom) because they all resolve through
 * the same {@link withResilience} integration point.
 *
 * See {@link ComboSettings} for the user-configurable payload, {@link withCombo}
 * for the integration point, and {@link withResilience} for the combined
 * combo-or-fallback selection.
 */
export * from "./types.js";
export * from "./settings.js";
export * from "./state.js";
export * from "./provider.js";
