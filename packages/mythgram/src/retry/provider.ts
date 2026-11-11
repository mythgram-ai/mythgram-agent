import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  Provider,
  ProviderModel,
  StreamDelta,
} from "../agents/providers/types.js";
import { runWithRetry, streamWithRetry, type RetryOptions } from "./engine.js";
import { normalizeRetrySettings } from "./settings.js";

export interface RetryingProviderOptions {
  /** The retry policy. Undefined/absent → the default policy (retry ON). */
  settings?: RetryOptions["settings"];
  /** Called before each retry; use it to surface the retry on the agent's event stream. */
  onRetry?: RetryOptions["onRetry"];
  /** Override the wait between attempts (tests only). */
  sleep?: RetryOptions["sleep"];
}

/**
 * Wrap a {@link Provider} so every chat-completion request it serves is retried
 * on ANY failure according to `options.settings`.
 *
 * This is the single integration point for the whole system: because every
 * agent type (main, custom, sub-agent, memory, summarization, chat, prompt
 * agent, team head/member, CEO) issues its LLM calls through the Provider
 * resolved for the turn, wrapping that Provider once gives every one of them
 * the same resilient behavior. Works uniformly for the local, built-in, and
 * custom OpenAI-compatible providers — the wrapper only touches the transport
 * (`streamChatCompletion` / `chatCompletion`), never the wire format.
 *
 * When retries are disabled the ORIGINAL provider is returned unchanged, so
 * turning the setting off has zero overhead and exact legacy behavior.
 */
export function withRetry(provider: Provider, options: RetryingProviderOptions = {}): Provider {
  const settings = normalizeRetrySettings(options.settings);
  if (!settings.enabled) return provider;

  const retryOptions = (opts: ChatCompletionOptions): RetryOptions => ({
    settings,
    onRetry: options.onRetry,
    sleep: options.sleep,
    signal: opts.signal,
  });

  const wrapped: Provider = {
    metadata: provider.metadata,
    listModels: (apiKey: string, baseUrl?: string): Promise<ProviderModel[]> =>
      provider.listModels(apiKey, baseUrl),
    streamChatCompletion: (opts: ChatCompletionOptions): AsyncGenerator<StreamDelta, void, unknown> =>
      streamWithRetry(() => provider.streamChatCompletion(opts), retryOptions(opts)),
  };

  // Only expose the non-streaming path when the inner provider has one, so
  // callers that probe `typeof provider.chatCompletion === "function"`
  // (e.g. the summarization fallback) keep their exact legacy behavior.
  if (typeof provider.chatCompletion === "function") {
    const complete = provider.chatCompletion.bind(provider);
    wrapped.chatCompletion = (opts: ChatCompletionOptions): Promise<ChatCompletionResult> =>
      runWithRetry(() => complete(opts), retryOptions(opts));
  }

  return wrapped;
}
