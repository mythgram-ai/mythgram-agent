import { MIN_SUMMARY_CHARS } from "./types.js";

/**
 * Final-summary validation. Success requires an actual, complete, non-empty
 * summary — never a job creation, stream close, tool end, or generic completion.
 */

export interface SummaryValidation {
  ok: boolean;
  summary?: string;
  code?: string;
  message?: string;
}

export function validateFinalSummary(raw: unknown): SummaryValidation {
  const summary = typeof raw === "string" ? raw.trim() : "";
  if (!summary) {
    return {
      ok: false,
      code: "summary_empty",
      message: "The summary agent returned an empty summary. Original context is preserved.",
    };
  }
  if (summary.length < MIN_SUMMARY_CHARS) {
    return {
      ok: false,
      code: "summary_too_short",
      message: `The summary agent returned only ${summary.length} chars (minimum ${MIN_SUMMARY_CHARS}). Original context is preserved.`,
    };
  }
  return { ok: true, summary };
}
