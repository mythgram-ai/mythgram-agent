/**
 * Retry system — shared types.
 *
 * The retry system wraps every LLM provider request (chat completions, streaming
 * and non-streaming) made by every agent type. When a request fails for ANY
 * reason — an HTTP error response, a network drop, a DNS failure, a timeout, a
 * malformed stream, a provider-side overload — the engine waits for a
 * configurable delay and immediately issues the request again, so the agent's
 * autonomous loop can keep working no matter how many errors the provider
 * keeps returning.
 *
 * Deliberately error-agnostic: there is NO error classification. Every thrown
 * error is retried exactly the same way.
 */

/** One scheduled retry attempt: how long to wait before the next try. */
export interface RetryAttemptSetting {
  /** Delay in milliseconds to wait before this attempt is issued. */
  delayMs: number;
}

/**
 * User-configurable retry policy. Travels with each turn (from the frontend
 * Settings) and is applied to every provider request of that turn.
 */
export interface RetrySettings {
  /** Master on/off switch. Defaults to true (retry enabled). */
  enabled: boolean;
  /**
   * The ordered list of retry attempts. `attempts[i].delayMs` is the wait
   * before retry attempt i+1. When the list is exhausted and `infinite` is
   * true, the last delay is reused forever.
   */
  attempts: RetryAttemptSetting[];
  /**
   * When true (default) the engine keeps retrying forever after the configured
   * list is exhausted, reusing the final delay. When false it gives up after
   * the configured attempts and rethrows the last error.
   */
  infinite: boolean;
  /**
   * What to do when a STREAMING request fails after it already emitted output
   * to the consumer. When true (default) the request is retried anyway (the
   * autonomous loop must keep going); when false the error is surfaced instead,
   * because a retried stream cannot un-emit the partial output.
   */
  restartOnPartialStream: boolean;
}

/** Info about a retry that is about to happen, passed to the optional callback. */
export interface RetryEvent {
  /** 1-based retry attempt number (the attempt currently being scheduled). */
  attempt: number;
  /**
   * Total number of configured attempts, or null when the policy retries
   * indefinitely (so the caller can render "attempt N" without a denominator).
   */
  maxAttempts: number | null;
  /** Milliseconds to wait before the next attempt is issued. */
  delayMs: number;
  /** The error that triggered this retry. */
  error: Error;
  /** True when the failed attempt had already streamed output to the consumer. */
  partial: boolean;
}
