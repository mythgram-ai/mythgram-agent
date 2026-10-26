import { randomId } from "../../database/ids.js";
import type { StoredMessage } from "../../services/sessionStore.js";
import type { Provider } from "../providers/types.js";
import { loadSummaryRequestPrompt, loadSummarySystemPrompt } from "./prompts.js";
import { buildSummarySnapshot, serializeSnapshot } from "./inputBuilder.js";
import { validateFinalSummary } from "./validation.js";
import { runSummaryAgent } from "./runner.js";
import type { HandoffIds, HandoffState } from "./types.js";

/**
 * Sub-agent context summarization handoff.
 *
 * Mirrors the main-agent handoff lifecycle (see handoff.ts) for sub-agent runs:
 *   RUNNING → PAUSING → PAUSED → SUMMARIZING → SUMMARY_VALIDATED
 *     → CONTEXT_REPLACED → RESUMED
 * Terminal / recoverable:
 *   SUMMARY_FAILED | SUMMARY_INCOMPLETE | HANDOFF_FAILED | CANCELLED | RECOVERY_REQUIRED
 *
 * Input isolation is identical to the main agent (see inputBuilder.ts):
 *   - INCLUDED: chat data (user/assistant text, original order) + tool calls/results
 *     + latest user input (the sub-agent's latest task / reuse prompt).
 *   - EXCLUDED: system prompt (lives outside history, never copied), hidden
 *     reasoning (reasoning_content never copied, never re-sent), memory/knowledge
 *     blocks and tool traffic, and any other non-allowlisted field.
 *
 * After a successful handoff the caller MUST atomically replace the sub-agent's
 * entire history with `outcome.replacement` (a single user message carrying
 * `<context_summary>` + latest input). The sub-agent's system prompt variable is
 * left untouched so the very next LLM request sends:
 *   1. the summary,
 *   2. the system prompt again (identity is never forgotten because the context
 *      was cleared but the prompt is re-sent every request),
 *   3. the latest task input (so the sub-agent never forgets its task),
 * and the loop continues working.
 *
 * Events are the sub-agent counterparts of the main-agent handoff events so the
 * UI can render a dedicated "Sub agents" tab with live output per run. Every
 * event carries `sub_session_id` (+ `sub_agent` name) so concurrent
 * summarizations of multiple sub-agents never collide.
 */

export interface SubAgentHandoffIds extends HandoffIds {
  /** 10-character sub-agent session id this handoff belongs to. */
  subSessionId: string;
  /** Display name of the sub-agent being summarized. */
  subAgentName: string;
}

export interface SubAgentHandoffRunParams {
  chatId: string;
  /** 10-character sub-agent session id (correlates events to the exact run). */
  subSessionId: string;
  /** Display name of the sub-agent (observability + UI label). */
  subAgentName: string;
  turn?: number;
  /** Live sub-agent history (read-only snapshot is taken; never mutated here). */
  messages: StoredMessage[];
  /** Active sub-agent system prompt text (re-sent after replacement, never summarized). */
  systemPrompt: string;
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  effort?: string;
  signal?: AbortSignal;
  send?: (event: string, data: Record<string, unknown>) => void;
}

export interface SubAgentHandoffOutcome {
  ok: boolean;
  state: HandoffState;
  handoff: SubAgentHandoffIds;
  summary?: string;
  latestUserInput?: string;
  /** Replacement history to commit (only when ok and state CONTEXT_REPLACED/RESUMED). */
  replacement?: StoredMessage[];
  error?: string;
  code?: string;
}

const activeJobs = new Map<string, HandoffState>();

/** Bounded per-chat history of completed sub-agent handoff runs (latest last, capped). */
const MAX_HISTORY_PER_CHAT = 50;
export interface SubAgentHandoffRecord {
  handoffId: string;
  chatId: string;
  subSessionId: string;
  subAgentName: string;
  state: HandoffState;
  summary: string | null;
  summaryChars: number | null;
  latestUserInput: string | null;
  code: string | null;
  error: string | null;
  createdAt: number;
  finishedAt: number;
}
const historyByChat = new Map<string, SubAgentHandoffRecord[]>();

/** Past sub-agent handoff runs for a chat, oldest first (bounded, in-memory). */
export function getSubAgentHandoffHistory(chatId: string): SubAgentHandoffRecord[] {
  const list = historyByChat.get(chatId || "");
  return list ? list.map((r) => ({ ...r })) : [];
}

function recordHandoff(record: SubAgentHandoffRecord): void {
  const key = record.chatId || "";
  const list = historyByChat.get(key) ?? [];
  list.push(record);
  while (list.length > MAX_HISTORY_PER_CHAT) list.shift();
  historyByChat.set(key, list);
}

function newHandoffId(): string {
  return `handoff_${randomId(12)}`;
}

function setState(handoffId: string, state: HandoffState): void {
  activeJobs.set(handoffId, state);
}

function getState(handoffId: string): HandoffState | undefined {
  return activeJobs.get(handoffId);
}

/** Test hook: clear tracked sub-agent jobs. */
export function clearSubAgentHandoffJobs(): void {
  activeJobs.clear();
}

/** Test hook: clear recorded sub-agent history. */
export function clearSubAgentHandoffHistory(): void {
  historyByChat.clear();
}

function emit(
  send: SubAgentHandoffRunParams["send"],
  event: string,
  data: Record<string, unknown>,
): void {
  try {
    send?.(event, data);
  } catch {
    // Event transport must never break the handoff.
  }
}

function buildContinuationMessages(
  summary: string,
  latestUserInput: string,
): StoredMessage[] {
  const summaryBlock = `<context_summary>\n${summary.trim()}\n</context_summary>`;
  const userBlock = latestUserInput.trim();
  const content = userBlock ? `${summaryBlock}\n\n${userBlock}` : summaryBlock;
  return [{ role: "user", content }];
}

/**
 * Execute one sub-agent pause→summarize→validate→replace cycle. Resolves exactly once.
 * Never throws — failures resolve as ok:false with an observable failure state
 * and the caller's original context untouched (the sub-agent loop then blocks
 * further auto-triggers for this run to avoid a retry loop).
 */
export async function executeSubAgentHandoff(
  params: SubAgentHandoffRunParams,
): Promise<SubAgentHandoffOutcome> {
  const handoff: SubAgentHandoffIds = {
    chatId: params.chatId,
    handoffId: newHandoffId(),
    turn: params.turn,
    subSessionId: params.subSessionId,
    subAgentName: params.subAgentName,
  };
  const base: Record<string, unknown> = {
    chat_id: params.chatId,
    handoff_id: handoff.handoffId,
    sub_session_id: params.subSessionId,
    sub_agent: params.subAgentName,
  };
  if (typeof params.turn === "number") base.turn = params.turn;

  // RUNNING → PAUSING: establish the execution barrier (caller suspends its loop).
  // The sub-agent is immediately stopped: no new LLM generation, tool execution,
  // or task-state mutation happens while this job runs — exactly like the main agent.
  setState(handoff.handoffId, "PAUSING");
  const startedAt = Date.now();
  emit(params.send, "sub_agent_summary_execution_started", { ...base, state: "PAUSING" });
  emit(params.send, "sub_agent_pause_initiated", { ...base, state: "PAUSING" });

  if (params.signal?.aborted) {
    setState(handoff.handoffId, "CANCELLED");
    emit(params.send, "sub_agent_summary_execution_failed", {
      ...base,
      state: "CANCELLED",
      code: "aborted",
      message: "Sub-agent handoff cancelled before it started. Original context is preserved.",
    });
    recordHandoff({
      handoffId: handoff.handoffId,
      chatId: handoff.chatId,
      subSessionId: handoff.subSessionId,
      subAgentName: handoff.subAgentName,
      state: "CANCELLED",
      summary: null,
      summaryChars: null,
      latestUserInput: null,
      code: "aborted",
      error: "Handoff cancelled before it started.",
      createdAt: startedAt,
      finishedAt: Date.now(),
    });
    return { ok: false, state: "CANCELLED", handoff, code: "aborted" };
  }

  // Snapshot + isolate (temporary retention for recovery only).
  // buildSummarySnapshot allowlists ONLY chat data + tool calls/results + latest
  // input; system prompt and reasoning_content are excluded by construction.
  const originalCopy: StoredMessage[] = params.messages.map((m) => ({ ...m }));
  void originalCopy;
  const snapshot = buildSummarySnapshot(params.messages, {
    chatId: params.chatId,
    handoffId: handoff.handoffId,
    turn: params.turn,
  });

  // PAUSED: sub-agent cannot generate, execute tools, or modify task state.
  setState(handoff.handoffId, "PAUSED");
  emit(params.send, "sub_agent_paused", { ...base, state: "PAUSED" });

  // SUMMARIZING with the exact required prompts + allowlisted input only
  // (same prompts and same runner as the main agent).
  setState(handoff.handoffId, "SUMMARIZING");
  let systemPrompt: string;
  let requestPrompt: string;
  try {
    systemPrompt = loadSummarySystemPrompt();
    requestPrompt = loadSummaryRequestPrompt();
  } catch (error) {
    setState(handoff.handoffId, "SUMMARY_FAILED");
    const message = error instanceof Error ? error.message : String(error);
    emit(params.send, "sub_agent_summary_execution_failed", {
      ...base,
      state: "SUMMARY_FAILED",
      code: "prompt_load_failed",
      message,
    });
    recordHandoff({
      handoffId: handoff.handoffId,
      chatId: handoff.chatId,
      subSessionId: handoff.subSessionId,
      subAgentName: handoff.subAgentName,
      state: "SUMMARY_FAILED",
      summary: null,
      summaryChars: null,
      latestUserInput: snapshot.latestUserInput || null,
      code: "prompt_load_failed",
      error: message,
      createdAt: startedAt,
      finishedAt: Date.now(),
    });
    return { ok: false, state: "SUMMARY_FAILED", handoff, code: "prompt_load_failed" };
  }
  const userMessage = `${requestPrompt}\n\n${serializeSnapshot(snapshot)}`;

  const chunkSend = (event: string, data: Record<string, unknown>): void => {
    if (event === "summary_chunk" && typeof data.value === "string") {
      emit(params.send, "sub_agent_summary_output_chunk", { ...base, value: data.value });
    }
  };

  const outcome = await runSummaryAgent({
    provider: params.provider,
    model: params.model,
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
    temperature: params.temperature,
    effort: params.effort,
    systemPrompt,
    userMessage,
    signal: params.signal,
    send: chunkSend,
  });

  emit(params.send, "sub_agent_summary_generation_ended", {
    ...base,
    finish_reason: outcome.finishReason,
    aborted: outcome.aborted,
  });
  emit(params.send, "sub_agent_summary_run_completed", {
    ...base,
    stream_ok: outcome.streamOk,
    aborted: outcome.aborted,
  });

  // Completion requires a real final summary — never stream close alone.
  if (outcome.aborted || params.signal?.aborted) {
    if (getState(handoff.handoffId) !== "SUMMARIZING") {
      return { ok: false, state: getState(handoff.handoffId) ?? "CANCELLED", handoff };
    }
    setState(handoff.handoffId, "CANCELLED");
    emit(params.send, "sub_agent_summary_execution_failed", {
      ...base,
      state: "CANCELLED",
      code: "aborted",
      message: "Sub-agent summary run was cancelled. Original context is preserved.",
    });
    recordHandoff({
      handoffId: handoff.handoffId,
      chatId: handoff.chatId,
      subSessionId: handoff.subSessionId,
      subAgentName: handoff.subAgentName,
      state: "CANCELLED",
      summary: null,
      summaryChars: null,
      latestUserInput: snapshot.latestUserInput || null,
      code: "aborted",
      error: "Summary run was cancelled.",
      createdAt: startedAt,
      finishedAt: Date.now(),
    });
    return { ok: false, state: "CANCELLED", handoff, code: "aborted" };
  }
  if (!outcome.streamOk) {
    setState(handoff.handoffId, "SUMMARY_FAILED");
    emit(params.send, "sub_agent_summary_execution_failed", {
      ...base,
      state: "SUMMARY_FAILED",
      code: "provider_error",
      message: outcome.error ?? "Sub-agent summary stream failed without a final result. Original context is preserved.",
    });
    recordHandoff({
      handoffId: handoff.handoffId,
      chatId: handoff.chatId,
      subSessionId: handoff.subSessionId,
      subAgentName: handoff.subAgentName,
      state: "SUMMARY_FAILED",
      summary: null,
      summaryChars: null,
      latestUserInput: snapshot.latestUserInput || null,
      code: "provider_error",
      error: outcome.error ?? "Summary stream failed.",
      createdAt: startedAt,
      finishedAt: Date.now(),
    });
    return { ok: false, state: "SUMMARY_FAILED", handoff, code: "provider_error", error: outcome.error };
  }

  emit(params.send, "sub_agent_final_summary_received", { ...base, chars: outcome.text.length });

  const validation = validateFinalSummary(outcome.text);
  if (!validation.ok || !validation.summary) {
    if (getState(handoff.handoffId) !== "SUMMARIZING") {
      return { ok: false, state: getState(handoff.handoffId) ?? "SUMMARY_INCOMPLETE", handoff };
    }
    setState(handoff.handoffId, "SUMMARY_INCOMPLETE");
    emit(params.send, "sub_agent_summary_execution_failed", {
      ...base,
      state: "SUMMARY_INCOMPLETE",
      code: validation.code ?? "summary_invalid",
      message: validation.message ?? "Sub-agent summary was empty or invalid. Original context is preserved.",
    });
    recordHandoff({
      handoffId: handoff.handoffId,
      chatId: handoff.chatId,
      subSessionId: handoff.subSessionId,
      subAgentName: handoff.subAgentName,
      state: "SUMMARY_INCOMPLETE",
      summary: null,
      summaryChars: null,
      latestUserInput: snapshot.latestUserInput || null,
      code: validation.code ?? "summary_invalid",
      error: validation.message ?? "Summary was empty or invalid.",
      createdAt: startedAt,
      finishedAt: Date.now(),
    });
    return {
      ok: false,
      state: "SUMMARY_INCOMPLETE",
      handoff,
      code: validation.code,
      error: validation.message,
    };
  }

  setState(handoff.handoffId, "SUMMARY_VALIDATED");
  emit(params.send, "sub_agent_final_summary_validated", {
    ...base,
    state: "SUMMARY_VALIDATED",
    chars: validation.summary.length,
  });

  // Build the approved continuation inputs: summary + latest task input. The
  // caller clears the ENTIRE sub-agent context and commits this single message;
  // the system prompt is re-sent automatically on the next LLM request because it
  // lives outside the history (never cleared, never summarized).
  const replacement = buildContinuationMessages(validation.summary, snapshot.latestUserInput);
  if (replacement.length === 0 || !replacement[0]?.content) {
    setState(handoff.handoffId, "HANDOFF_FAILED");
    emit(params.send, "sub_agent_summary_execution_failed", {
      ...base,
      state: "HANDOFF_FAILED",
      code: "replacement_empty",
      message: "Replacement context was empty. Original context is preserved.",
    });
    recordHandoff({
      handoffId: handoff.handoffId,
      chatId: handoff.chatId,
      subSessionId: handoff.subSessionId,
      subAgentName: handoff.subAgentName,
      state: "HANDOFF_FAILED",
      summary: validation.summary,
      summaryChars: validation.summary.length,
      latestUserInput: snapshot.latestUserInput || null,
      code: "replacement_empty",
      error: "Replacement context was empty.",
      createdAt: startedAt,
      finishedAt: Date.now(),
    });
    return { ok: false, state: "HANDOFF_FAILED", handoff, code: "replacement_empty" };
  }

  emit(params.send, "sub_agent_context_replacement_started", { ...base, state: "SUMMARY_VALIDATED" });

  if (getState(handoff.handoffId) !== "SUMMARY_VALIDATED") {
    return { ok: false, state: getState(handoff.handoffId) ?? "HANDOFF_FAILED", handoff };
  }
  setState(handoff.handoffId, "CONTEXT_REPLACED");
  emit(params.send, "sub_agent_context_replaced", {
    ...base,
    state: "CONTEXT_REPLACED",
    summary_chars: validation.summary.length,
  });
  recordHandoff({
    handoffId: handoff.handoffId,
    chatId: handoff.chatId,
    subSessionId: handoff.subSessionId,
    subAgentName: handoff.subAgentName,
    state: "CONTEXT_REPLACED",
    summary: validation.summary,
    summaryChars: validation.summary.length,
    latestUserInput: snapshot.latestUserInput || null,
    code: null,
    error: null,
    createdAt: startedAt,
    finishedAt: Date.now(),
  });

  return {
    ok: true,
    state: "CONTEXT_REPLACED",
    handoff,
    summary: validation.summary,
    latestUserInput: snapshot.latestUserInput,
    replacement,
  };
}

/** Mark a sub-agent handoff resumed after the caller commits replacement and continues. */
export function markSubAgentResumed(
  handoff: SubAgentHandoffIds,
  send?: (event: string, data: Record<string, unknown>) => void,
): void {
  if (getState(handoff.handoffId) !== "CONTEXT_REPLACED") return;
  setState(handoff.handoffId, "RESUMED");
  const list = historyByChat.get(handoff.chatId || "");
  const record = list?.find((r) => r.handoffId === handoff.handoffId);
  if (record) record.state = "RESUMED";
  try {
    send?.("sub_agent_execution_resumed", {
      chat_id: handoff.chatId,
      handoff_id: handoff.handoffId,
      sub_session_id: handoff.subSessionId,
      sub_agent: handoff.subAgentName,
      state: "RESUMED",
    });
  } catch {
    // ignore
  }
}
