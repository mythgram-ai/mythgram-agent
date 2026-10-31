import type { StoredMessage } from "../../services/sessionStore.js";

/**
 * Reliable automatic context summarization and main-agent handoff.
 *
 * Lifecycle (authoritative backend state, one active job per handoff):
 *   RUNNING → PAUSING → PAUSED → SUMMARIZING → SUMMARY_VALIDATED
 *     → CONTEXT_REPLACED → RESUMED
 * Terminal / recoverable:
 *   SUMMARY_FAILED | SUMMARY_INCOMPLETE | HANDOFF_FAILED | CANCELLED | RECOVERY_REQUIRED
 *
 * Success requires an actual, complete, non-empty validated summary.
 * Starting a job, closing a stream, ending a tool call, or emitting a generic
 * completion event never implies success.
 */

export type HandoffState =
  | "RUNNING"
  | "PAUSING"
  | "PAUSED"
  | "SUMMARIZING"
  | "SUMMARY_VALIDATED"
  | "CONTEXT_REPLACED"
  | "RESUMED"
  | "SUMMARY_FAILED"
  | "SUMMARY_INCOMPLETE"
  | "HANDOFF_FAILED"
  | "CANCELLED"
  | "RECOVERY_REQUIRED";

export const HANDOFF_TERMINAL_FAILURE: readonly HandoffState[] = [
  "SUMMARY_FAILED",
  "SUMMARY_INCOMPLETE",
  "HANDOFF_FAILED",
  "RECOVERY_REQUIRED",
] as const;

/** Default utilization that triggers a safe pause (90% of the context window). */
export const DEFAULT_SUMMARY_THRESHOLD = 0.9;

/** Minimum usable summary length (chars) for validation. Guards empty/trivial output. */
export const MIN_SUMMARY_CHARS = 20;

/** Which top-level agent a handoff belongs to. Custom agents compact exactly like the Main Agent. */
export type HandoffAgent = "main" | "custom";

export interface HandoffIds {
  chatId: string;
  /** Stable handoff id for one pause→resume cycle (prevents duplicate jobs). */
  handoffId: string;
  /** Chat-session turn number the handoff belongs to (observability). */
  turn?: number;
  /**
   * Top-level agent that triggered the handoff ("main" for the built-in Main
   * Agent, "custom" for a user-created Custom Agent). Defaults to "main" when
   * omitted so older callers/history stay valid.
   */
  agent?: HandoffAgent;
  /** Custom Agent id when `agent` is "custom". */
  customAgentId?: string;
  /** Custom Agent display name when `agent` is "custom". */
  customAgentName?: string;
}

export interface UtilizationSample {
  promptTokens: number;
  contextLimit: number | null;
  utilization: number | null;
}

/** Allowlisted snapshot sent to the summary agent (never the live mutable state). */
export interface SummarySnapshot {
  /** Chat data: filtered conversation messages, original order, no reasoning. */
  chatData: StoredMessage[];
  /** Tool calls and results preserved with ordering/ids/associations. */
  toolTraffic: Array<{ call: StoredMessage; result: StoredMessage | null }>;
  /** Only the latest user input at snapshot-finalization time. */
  latestUserInput: string;
  handoff: HandoffIds;
}

export interface ValidatedSummary {
  summary: string;
  chars: number;
}

/** Approved continuation inputs for the resumed main agent. */
export interface ContinuationContext {
  summary: string;
  latestUserInput: string;
  /** Active system prompt text (custom when active, else built-in). Resolved at handoff time. */
  systemPrompt: string;
  /** Authoritative memory/knowledge presence at handoff time (runtimes stay live). */
  memoryActive: boolean;
  knowledgeActive: boolean;
}

export function isTerminalFailure(state: HandoffState): boolean {
  return (HANDOFF_TERMINAL_FAILURE as readonly string[]).includes(state);
}
