import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  Provider,
  ProviderModel,
  StreamDelta,
} from "../agents/providers/types.js";
import { runWithRetry, streamWithRetry, type RetryOptions } from "../retry/engine.js";
import { withRetry } from "../retry/provider.js";
import { normalizeRetrySettings } from "../retry/settings.js";
import type { RetrySettings } from "../retry/types.js";
import { withFallback } from "../fallback/provider.js";
import type { FallbackEvent, FallbackTarget } from "../fallback/types.js";
import { comboIsUsable, sanitizeComboSettings, usableComboEntries } from "./settings.js";
import type { ComboEvent, ComboSettings } from "./types.js";
import {
  comboStateKey,
  getActiveComboIndex,
  setActiveComboIndex,
} from "./state.js";

/** A target accepted by a combo/fallback `resolve` callback (structurally shared). */
export interface ResolveTarget {
  provider: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  customProvider?: unknown;
}

export interface ComboProviderOptions {
  /** Active combo. Undefined/absent or unusable → plain retry behavior. */
  settings?: Partial<ComboSettings> | ComboSettings | unknown;
  /** Retry policy applied ONLY to the last entry (retry is the last resort). */
  retry?: Partial<RetrySettings> | RetrySettings;
  /** Primary provider id (used for the state key / legacy path). */
  providerId: string;
  /** Primary model (unused by the combo chain itself; kept for symmetry). */
  model: string;
  /** Primary API key (unused by the combo chain itself; kept for symmetry). */
  apiKey: string;
  /** Primary base URL override. */
  baseUrl?: string;
  /** Primary custom-provider config. */
  customProvider?: unknown;
  /** Materialize a {@link Provider} for one combo entry. */
  resolve: (entry: ResolveTarget) => Provider;
  /** Called before each retry (surfaces the last-entry retry on the event stream). */
  onRetry?: RetryOptions["onRetry"];
  /** Called when the combo advances to the next entry. */
  onCombo?: (event: ComboEvent) => unknown;
  /** Agent scope for events ("main", "chat", "team", ...). */
  scope?: string;
  /** Override the wait between attempts (tests only). */
  sleep?: RetryOptions["sleep"];
}

/** Options for {@link withResilience}: combo takes precedence over fallback. */
export interface ResilienceOptions extends Omit<ComboProviderOptions, "settings" | "onCombo"> {
  /** Active combo policy. When usable, it fully replaces the fallback policy. */
  combo?: Partial<ComboSettings> | ComboSettings | unknown;
  /** Fallback policy, used only when no combo is active. */
  fallback?: unknown;
  /** Called when a fallback target takes over (combo inactive). */
  onFallback?: (event: FallbackEvent) => unknown;
  /** Called when the combo advances to the next entry (combo active). */
  onCombo?: (event: ComboEvent) => unknown;
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
 * Wrap a {@link Provider} with the provider-combo system.
 *
 * Unlike the fallback system, the combo system does NOT retry a failing provider
 * before moving on: the first entry is tried once, and the moment it throws the
 * next entry takes over (and the failed entry is never used again for that combo).
 * Retry is the LAST resort and runs ONLY on the final combo entry — so a combo
 * whose every provider is down still keeps retrying the last one forever (per the
 * turn's retry policy).
 *
 * When no usable combo is configured the ORIGINAL retry-wrapped provider is
 * returned, so behavior is byte-for-byte identical to the retry-only system.
 */
export function withCombo(primary: Provider, options: ComboProviderOptions): Provider {
  const baseRetry = normalizeRetrySettings(options.retry);
  const asRetry = withRetry(primary, {
    settings: baseRetry,
    onRetry: options.onRetry,
    sleep: options.sleep,
  });

  const { settings: rawSettings } = options;
  const combo = sanitizeComboSettings(rawSettings);
  if (!comboIsUsable(combo)) return asRetry;

  const candidates = buildComboCandidates(combo, baseRetry, options);
  if (candidates.length < 2) return asRetry;

  const key = comboStateKey(
    combo,
    candidates.map((candidate) => ({
      provider: candidate.providerId,
      model: candidate.model,
      baseUrl: candidate.baseUrl,
      apiKey: candidate.apiKey,
    })),
  );

  const retryOptionsFor = (candidate: Candidate, opts: ChatCompletionOptions): RetryOptions => ({
    settings: candidate.retry,
    onRetry: options.onRetry,
    sleep: options.sleep,
    signal: opts.signal,
  });

  const wrapped: Provider = {
    metadata: primary.metadata,
    listModels: (apiKey: string, baseUrl?: string): Promise<ProviderModel[]> =>
      primary.listModels(apiKey, baseUrl),
    streamChatCompletion: (opts: ChatCompletionOptions): AsyncGenerator<StreamDelta, void, unknown> =>
      (async function* () {
        const start = clampIndex(getActiveComboIndex(key), candidates.length);
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
            setActiveComboIndex(key, i);
            return;
          } catch (error) {
            if (opts.signal?.aborted) throw error;
            // A stream that already emitted output cannot be un-emitted, so
            // switching providers now would duplicate content — surface instead.
            if (emitted) throw error;
            if (i < candidates.length - 1) {
              setActiveComboIndex(key, i + 1);
              await notifyCombo(options, combo, i, candidates, error);
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
        const start = clampIndex(getActiveComboIndex(key), candidates.length);
        for (let i = start; i < candidates.length; i++) {
          const candidate = candidates[i]!;
          try {
            const complete = candidate.provider.chatCompletion?.bind(candidate.provider);
            if (!complete) throw new Error(`Provider "${candidate.providerId}" has no non-streaming API`);
            const result = await runWithRetry(
              () => complete(applyCandidate(opts, candidate)),
              retryOptionsFor(candidate, opts),
            );
            setActiveComboIndex(key, i);
            return result;
          } catch (error) {
            if (opts.signal?.aborted) throw error;
            if (i < candidates.length - 1) {
              setActiveComboIndex(key, i + 1);
              await notifyCombo(options, combo, i, candidates, error);
              continue;
            }
            throw error;
          }
        }
        throw new Error("Combo chain exhausted");
      })();
  }

  return wrapped;
}

/**
 * Apply the turn's resilience layer: the provider combo when one is active,
 * otherwise the fallback system. A combo and a fallback are never combined — the
 * requirement is "no fallback provider and no fallback API key on a combo".
 */
export function withResilience(primary: Provider, options: ResilienceOptions): Provider {
  const combo = sanitizeComboSettings(options.combo);
  if (comboIsUsable(combo)) {
    return withCombo(primary, {
      settings: combo,
      retry: options.retry,
      providerId: options.providerId,
      model: options.model,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      customProvider: options.customProvider,
      resolve: options.resolve,
      onRetry: options.onRetry,
      onCombo: options.onCombo,
      scope: options.scope,
      sleep: options.sleep,
    });
  }
  return withFallback(primary, {
    settings: options.fallback,
    retry: options.retry,
    providerId: options.providerId,
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    customProvider: options.customProvider,
    resolve: options.resolve as (target: FallbackTarget) => Provider,
    onRetry: options.onRetry,
    onFallback: options.onFallback,
    scope: options.scope,
    sleep: options.sleep,
  });
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
 * Build the ordered candidate list from the combo entries. Every entry except the
 * LAST gets retry DISABLED (a single attempt — the moment it fails the combo
 * advances); the last entry keeps the full retry policy so the chain still retries
 * forever when configured to.
 */
function buildComboCandidates(
  combo: ComboSettings,
  baseRetry: RetrySettings,
  options: ComboProviderOptions,
): Candidate[] {
  const noRetry: RetrySettings = { ...baseRetry, enabled: false };
  const candidates: Candidate[] = [];

  for (const entry of usableComboEntries(combo)) {
    let provider: Provider;
    try {
      provider = options.resolve(entry);
    } catch {
      // A target that cannot be materialized is skipped rather than fatal.
      continue;
    }
    candidates.push({
      provider,
      providerId: entry.provider,
      apiKey: entry.apiKey,
      model: entry.model.trim(),
      baseUrl: entry.baseUrl ?? undefined,
      retry: noRetry,
    });
  }

  // Retry is the LAST resort — only the final entry may retry.
  if (candidates.length > 0) candidates[candidates.length - 1]!.retry = baseRetry;
  return candidates;
}

/** Fire the combo callback for the entry at candidate index `i + 1`. */
async function notifyCombo(
  options: ComboProviderOptions,
  settings: ComboSettings,
  i: number,
  candidates: Candidate[],
  error: unknown,
): Promise<void> {
  if (!options.onCombo) return;
  const next = candidates[i + 1]!;
  await options.onCombo({
    comboId: settings.comboId,
    comboName: settings.name,
    index: i + 1,
    total: candidates.length,
    provider: next.providerId,
    model: next.model,
    error: toError(error),
    scope: options.scope,
  });
}

/**
 * Serialize a {@link ComboEvent} into a plain, JSON-safe payload for an SSE
 * `combo` event (or a log line).
 */
export function comboEventPayload(event: ComboEvent, scope?: string): Record<string, unknown> {
  return {
    combo_id: event.comboId,
    combo_name: event.comboName,
    combo_index: event.index,
    combo_total: event.total,
    combo_provider: event.provider,
    combo_model: event.model,
    error: event.error.message,
    ...(scope ?? event.scope ? { scope: scope ?? event.scope } : {}),
  };
}
