import { DEFAULT_SUMMARY_THRESHOLD } from "./types.js";

/**
 * Context-utilization monitoring for the main agent.
 *
 * Utilization = prompt_tokens / context_limit using the most reliable
 * token-usage information available (the provider-reported `prompt_tokens` of
 * the latest LLM request — the current context size, not a cumulative total).
 */

export interface ThresholdOptions {
  /** 0..1 fraction that triggers a safe pause. Default 0.9 (90%). */
  threshold?: number;
}

export function normalizeThreshold(raw: unknown): number {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_SUMMARY_THRESHOLD;
  if (n <= 0 || n > 1) return DEFAULT_SUMMARY_THRESHOLD;
  return n;
}

export function utilizationOf(
  promptTokens: number | undefined | null,
  contextLimit: number | undefined | null,
): number | null {
  if (typeof promptTokens !== "number" || !Number.isFinite(promptTokens) || promptTokens < 0) {
    return null;
  }
  if (typeof contextLimit !== "number" || !Number.isFinite(contextLimit) || contextLimit <= 0) {
    return null;
  }
  return promptTokens / contextLimit;
}

/**
 * True when summarization must start: utilization is known and reaches or
 * exceeds the threshold. Unknown utilization (missing tokens/limit) never
 * triggers. Already-exceeded thresholds trigger immediately (safe).
 */
export function shouldTriggerSummarization(
  promptTokens: number | undefined | null,
  contextLimit: number | undefined | null,
  options?: ThresholdOptions,
): boolean {
  const utilization = utilizationOf(promptTokens, contextLimit);
  if (utilization === null) return false;
  const threshold = normalizeThreshold(options?.threshold);
  return utilization >= threshold;
}
