/**
 * Fallback system — public surface.
 *
 * The resilience layer above the retry engine. When every retry attempt of the
 * current provider (or provider API key) fails, the fallback system switches to
 * the next configured fallback target and remembers it as the active target for
 * all later requests. It applies to every agent type (main, custom, sub-agent,
 * memory agent, context summarization, prompt agent, chat mode, and multi-agent
 * team members/leaders/CEO) and to every provider (local, built-in, custom)
 * because they all resolve through the same {@link withFallback} integration
 * point.
 *
 * See {@link FallbackSettings} for the user-configurable policy and
 * {@link withFallback} for the integration point.
 */
export * from "./types.js";
export * from "./settings.js";
export * from "./state.js";
export * from "./provider.js";
