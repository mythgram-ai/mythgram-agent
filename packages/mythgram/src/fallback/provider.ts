import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  Provider,
  StreamDelta,
} from "../agents/providers/types.js";
import { runWithRetry, streamWithRetry, type RetryOptions } from "../retry/engine.js";
import { withRetry } from "../retry/provider.js";
import { normalizeRetrySettings } from "../retry/settings.js";
import type { RetrySettings } from "../retry/types.js";
import {
  fallbackActiveTargets,
  sanitizeFallbackSettings,
} from "./settings.js";
import {
  candidateSignature,
  fallbackStateKey,
  getActiveFallbackIndex,
  setActiveFallbackIndex,
} from "./state.js";
import type { FallbackEvent, FallbackSettings, FallbackTarget } from "./types.js";

export interface FallbackProviderOptions {
  /** Fallback policy. Undefined/absent → fallback OFF (legacy behavior). */
  settings?: Partial<FallbackSettings> | FallbackSettings | unknown;
  /** Retry policy applied to each candidate before moving on. */
  retry?: Partial<RetrySettings> | RetrySettings;
  /** Primary provider id (used for `api` fallback and the state key). */
  providerId: string;
  /** Primary model (targets with an empty model reuse it). */
  model: string;
  /** Primary API key (used for the primary candidate and `api` fallback base). */
  apiKey: string;
  /** Primary base URL override. */
  baseUrl?: string;
  /** Primary custom-provider config (unused directly; carried for symmetry). */
  customProvider?: unknown;
  /** Materialize a {@link Provider} for a `provider`-method target. */
  resolve: (target: FallbackTarget) => Provider;
  /** Called before each retry (surfaces the retry on the agent's event stream). */
  onRetry?: RetryOptions["onRetry"];
  /** Called when a fallback target takes over. */
  onFallback?: (event: FallbackEvent) => unknown;
  /** Agent scope for events ("main", "chat", "team", ...). */
  scope?: string;
  /** Override the wait between attempts (tests only). */
  sleep?: RetryOptions["sleep"];
}

/** One concrete request destination: a provider plus the per-call credentials. */
interface Candidate {
  provider: Provider;
  providerId: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  retry: RetrySettings;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Wrap a {@link Provider} with the fallback system.
 *
 * The primary provider is tried first with the configured retry policy; when
 * EVERY retry attempt of the primary is exhausted (the retry list is treated as
 * finite here — `infinite` is ignored for non-final candidates so the chain can
 * advance), the next configured fallback target takes over and is remembered as
 * the ACTIVE target for all later requests. This is the single integration point
 * that gives every agent type — main, custom, sub-agent, memory, context
 * summarization, chat, prompt agent, and multi-agent team members/leaders/CEO —
 * the same failover behavior, uniformly for local, built-in, and custom
 * providers.
 *
 * When fallback is disabled, has no targets, or resolves to a single candidate,
 * the ORIGINAL retry-wrapped provider is returned so behavior is byte-for-byte
 * identical to the retry-only system.
 */
export function withFallback(primary: Provider, options: FallbackProviderOptions): Provider {
  const fallback = sanitizeFallbackSettings(options.settings);
  const baseRetry = normalizeRetrySettings(options.retry);

  const legacy = withRetry(primary, {
    settings: baseRetry,
    onRetry: options.onRetry,
    sleep: options.sleep,
  });

  if (!fallback.enabled || fallbackActiveTargets(fallback).length === 0) return legacy;

  const candidates = buildCandidates(primary, fallback, baseRetry, options);
  if (candidates.length <= 1) return legacy;

  const key = fallbackStateKey(
    options.providerId,
    options.model,
    options.baseUrl ?? "",
    fallback,
    candidates.map((c) => candidateSignature(c.providerId, c.model, c.baseUrl ?? "", c.apiKey)),
  );

  const retryOptionsFor = (candidate: Candidate, opts: ChatCompletionOptions): RetryOptions => ({
    settings: candidate.retry,
    onRetry: options.onRetry,
    sleep: options.sleep,
    signal: opts.signal,
  });

  const wrapped: Provider = {
    metadata: primary.metadata,
    listModels: (apiKey: string, baseUrl?: string): Promise<import("../agents/providers/types.js").ProviderModel[]> =>
      primary.listModels(apiKey, baseUrl),
    streamChatCompletion: (opts: ChatCompletionOptions): AsyncGenerator<StreamDelta, void, unknown> =>
      (async function* () {
        const start = clampIndex(getActiveFallbackIndex(key), candidates.length);
        for (let i = start; i < candidates.length; i++) {
          const candidate = candidates[i]!;
          let emitted = false;
          try {
            const stream = streamWithRetry(
              () => candidate.provider.streamChatCompletion(applyCandidate(opts, candidate)),
              retryOptionsFor(candidate, opts),
            );
            for await (const delta of stream) {
              emitted = true;
              yield delta;
            }
            setActiveFallbackIndex(key, i);
            return;
          } catch (error) {
            if (opts.signal?.aborted) throw error;
            // A stream that already emitted output cannot be un-emitted, so
            // switching providers now would duplicate content — surface instead.
            if (emitted) throw error;
            if (i < candidates.length - 1) {
              await notifyFallback(options, fallback, i, candidates, error);
              continue;
            }
            throw error;
          }
        }
      })(),
  };

  // Only expose the non-streaming path when the primary has one, mirroring the
  // retry wrapper so summarization's stream→non-stream probe keeps working.
  if (typeof primary.chatCompletion === "function") {
    wrapped.chatCompletion = (opts: ChatCompletionOptions): Promise<ChatCompletionResult> =>
      (async () => {
        const start = clampIndex(getActiveFallbackIndex(key), candidates.length);
        for (let i = start; i < candidates.length; i++) {
          const candidate = candidates[i]!;
          try {
            const complete = candidate.provider.chatCompletion?.bind(candidate.provider);
            if (!complete) throw new Error(`Provider "${candidate.providerId}" has no non-streaming API`);
            const result = await runWithRetry(
              () => complete(applyCandidate(opts, candidate)),
              retryOptionsFor(candidate, opts),
            );
            setActiveFallbackIndex(key, i);
            return result;
          } catch (error) {
            if (opts.signal?.aborted) throw error;
            if (i < candidates.length - 1) {
              await notifyFallback(options, fallback, i, candidates, error);
              continue;
            }
            throw error;
          }
        }
        throw new Error("Fallback chain exhausted");
      })();
  }

  return wrapped;
}

/** Overlay a candidate's credentials/model/base URL onto the caller's options. */
function applyCandidate(opts: ChatCompletionOptions, candidate: Candidate): ChatCompletionOptions {
  return {
    ...opts,
    apiKey: candidate.apiKey,
    model: candidate.model,
    baseUrl: candidate.baseUrl,
  };
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(Math.floor(index), length - 1);
}

/**
 * Build the ordered candidate list: primary first, then every configured target.
 * Every non-final candidate gets a FINITE retry policy (the configured schedule
 * is exhausted, then the chain advances); the final candidate keeps the full
 * policy so the chain still retries forever when configured to.
 */
function buildCandidates(
  primary: Provider,
  fallback: FallbackSettings,
  baseRetry: RetrySettings,
  options: FallbackProviderOptions,
): Candidate[] {
  const finiteRetry: RetrySettings = { ...baseRetry, infinite: false };
  const candidates: Candidate[] = [
    {
      provider: primary,
      providerId: options.providerId,
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl,
      retry: finiteRetry,
    },
  ];

  for (const target of fallbackActiveTargets(fallback)) {
    // A provider fallback is meaningless without an explicit model — skip it
    // rather than silently reusing the primary model on a different provider.
    if (fallback.method === "provider" && !target.model.trim()) continue;
    let provider: Provider;
    if (fallback.method === "provider") {
      try {
        provider = options.resolve(target);
      } catch {
        // A target that cannot be materialized is skipped rather than fatal.
        continue;
      }
    } else {
      // `api` method: same provider as the primary, alternate credential. A target
      // bound to a different provider is stale (the primary changed) — skip it.
      if (target.provider && target.provider !== options.providerId) continue;
      provider = primary;
    }
    candidates.push({
      provider,
      providerId: target.provider,
      apiKey: target.apiKey,
      model: target.model.trim() || options.model,
      baseUrl:
        fallback.method === "provider" ? target.baseUrl ?? undefined : target.baseUrl ?? options.baseUrl,
      retry: finiteRetry,
    });
  }

  // The last candidate may retry forever, so an outage never permanently kills
  // the agent loop once every fallback has been tried.
  candidates[candidates.length - 1]!.retry = baseRetry;
  return candidates;
}

/** Fire the fallback callback for the target at candidate index `i + 1`. */
async function notifyFallback(
  options: FallbackProviderOptions,
  settings: FallbackSettings,
  i: number,
  candidates: Candidate[],
  error: unknown,
): Promise<void> {
  if (!options.onFallback) return;
  const next = candidates[i + 1]!;
  await options.onFallback({
    method: settings.method,
    index: i + 1,
    total: candidates.length - 1,
    provider: next.providerId,
    model: next.model,
    error: toError(error),
    scope: options.scope,
  });
}

/**
 * Serialize a {@link FallbackEvent} into a plain, JSON-safe payload for an SSE
 * `fallback` event (or a log line).
 */
export function fallbackEventPayload(event: FallbackEvent, scope?: string): Record<string, unknown> {
  return {
    fallback_method: event.method,
    fallback_index: event.index,
    fallback_total: event.total,
    fallback_provider: event.provider,
    fallback_model: event.model,
    error: event.error.message,
    ...(scope ?? event.scope ? { scope: scope ?? event.scope } : {}),
  };
}
