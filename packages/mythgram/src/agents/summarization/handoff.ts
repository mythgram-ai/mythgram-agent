import { randomId } from "../../database/ids.js";
import type { StoredMessage } from "../../services/sessionStore.js";
import type { Provider } from "../providers/types.js";
import { loadSummaryRequestPrompt, loadSummarySystemPrompt } from "./prompts.js";
import { buildSummarySnapshot, serializeSnapshot } from "./inputBuilder.js";
import { validateFinalSummary } from "./validation.js";
import { runSummaryAgent } from "./runner.js";
import type {
  ContinuationContext,
  HandoffAgent,
  HandoffIds,
  HandoffState,
} from "./types.js";

/**
 * Authoritative handoff coordinator (one active job per handoff id).
 *
 * Root-cause guard for previous premature-completion failures: every stage has
 * an explicit event and a distinct state, and no stage implies the next.
 * In particular:
 *   - job creation / stream close / tool end / generic "done" never mark success
 *   - SUMMARY_VALIDATED requires a real, non-empty validated final summary
 *   - CONTEXT_REPLACED requires the replacement to be constructed and committed
 *   - RESUMED requires replacement to have succeeded
 */

export interface HandoffRunParams {
  chatId: string;
  turn?: number;
  /** Live session messages (read-only snapshot is taken; never mutated here). */
  messages: StoredMessage[];
  /** Active system prompt text for the resumed agent (custom when active). */
  systemPrompt: string;
  memoryActive: boolean;
  knowledgeActive: boolean;
  /**
   * Top-level agent triggering the handoff ("main" for the built-in Main
   * Agent, "custom" for a user-created Custom Agent). Custom agents compact
   * exactly like the Main Agent through the same pipeline. Defaults to "main".
   */
  agent?: HandoffAgent;
  /** Custom Agent id when `agent` is "custom". */
  customAgentId?: string;
  /** Custom Agent display name when `agent` is "custom". */
  customAgentName?: string;
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  effort?: string;
  signal?: AbortSignal;
  send?: (event: string, data: Record<string, unknown>) => void;
}

export interface HandoffOutcome {
  ok: boolean;
  state: HandoffState;
  handoff: HandoffIds;
  summary?: string;
  latestUserInput?: string;
  /** Replacement messages to commit (only when ok and state CONTEXT_REPLACED/RESUMED). */
  replacement?: StoredMessage[];
  error?: string;
  code?: string;
}

const activeJobs = new Map<string, HandoffState>();

/** Bounded per-chat history of completed handoff runs (latest last, capped). */
const MAX_HISTORY_PER_CHAT = 20;
export interface HandoffRecord {
  handoffId: string;
  chatId: string;
  state: HandoffState;
  /** Top-level agent that triggered the run ("main" for older records without a tag). */
  agent: HandoffAgent;
  /** Custom Agent id when `agent` is "custom". */
  customAgentId: string | null;
  /** Custom Agent display name when `agent` is "custom". */
  customAgentName: string | null;
  summary: string | null;
  summaryChars: number | null;
  latestUserInput: string | null;
  code: string | null;
  error: string | null;
  createdAt: number;
  finishedAt: number;
}
const historyByChat = new Map<string, HandoffRecord[]>();

/** Past handoff runs for a chat, oldest first (bounded, in-memory). */
export function getHandoffHistory(chatId: string): HandoffRecord[] {
  const list = historyByChat.get(chatId || "");
  return list ? list.map((r) => ({ ...r })) : [];
}

/** Past CUSTOM-agent handoff runs for a chat, oldest first (bounded, in-memory). */
export function getCustomHandoffHistory(chatId: string): HandoffRecord[] {
  return getHandoffHistory(chatId).filter((r) => r.agent === "custom");
}

function recordHandoff(record: HandoffRecord): void {
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

/** Test hook: clear tracked jobs. */
export function clearHandoffJobs(): void {
  activeJobs.clear();
}

/** Test hook: clear recorded history. */
export function clearHandoffHistory(): void {
  historyByChat.clear();
}

function emit(
  send: HandoffRunParams["send"],
  event: string,
  data: Record<string, unknown>,
): void {
  try {
    send?.(event, data);
  } catch {
    // Event transport must never break the handoff.
  }
}

function buildContinuationMessages(ctx: ContinuationContext): StoredMessage[] {
  const summaryBlock = `<context_summary>\n${ctx.summary.trim()}\n</context_summary>`;
  const userBlock = ctx.latestUserInput.trim();
  const content = userBlock ? `${summaryBlock}\n\n${userBlock}` : summaryBlock;
  return [{ role: "user", content }];
}

/**
 * Execute one pause→summarize→validate→replace cycle. Resolves exactly once.
 * Never throws — failures resolve as ok:false with an observable failure state
 * and the caller's original context untouched.
 */
/** Normalize the triggering agent ("main" default keeps older callers valid). */
function handoffAgentOf(params: Pick<HandoffRunParams, "agent">): HandoffAgent {
  return params.agent === "custom" ? "custom" : "main";
}

function customIdOf(params: Pick<HandoffRunParams, "customAgentId">): string | undefined {
  const id = (params.customAgentId ?? "").trim();
  return id.length > 0 ? id : undefined;
}

function customNameOf(params: Pick<HandoffRunParams, "customAgentName">): string | undefined {
  const name = (params.customAgentName ?? "").trim();
  return name.length > 0 ? name : undefined;
}

export async function executeHandoff(params: HandoffRunParams): Promise<HandoffOutcome> {
  const agent = handoffAgentOf(params);
  const customAgentId = agent === "custom" ? customIdOf(params) : undefined;
  const customAgentName = agent === "custom" ? customNameOf(params) : undefined;
  const handoff: HandoffIds = {
    chatId: params.chatId,
    handoffId: newHandoffId(),
    turn: params.turn,
    agent,
    ...(customAgentId ? { customAgentId } : {}),
    ...(customAgentName ? { customAgentName } : {}),
  };
  const base: Record<string, unknown> = { chat_id: params.chatId, handoff_id: handoff.handoffId, agent };
  if (typeof params.turn === "number") base.turn = params.turn;
  if (customAgentId) base.custom_agent_id = customAgentId;
  if (customAgentName) base.custom_agent_name = customAgentName;

  // RUNNING → PAUSING: establish the execution barrier (caller suspends its loop).
  setState(handoff.handoffId, "PAUSING");
  const startedAt = Date.now();
  const recordTerminal = (
    partial: Omit<HandoffRecord, "handoffId" | "chatId" | "agent" | "customAgentId" | "customAgentName" | "createdAt" | "finishedAt">,
  ): void => {
    recordHandoff({
      handoffId: handoff.handoffId,
      chatId: handoff.chatId,
      agent,
      customAgentId: customAgentId ?? null,
      customAgentName: customAgentName ?? null,
      createdAt: startedAt,
      finishedAt: Date.now(),
      ...partial,
    });
  };
  /** Emit a top-level pause/resume lifecycle event, plus its custom-agent mirror when custom. */
  const emitTopLevel = (event: string, data: Record<string, unknown>): void => {
    emit(params.send, event, data);
    if (agent === "custom") {
      const mirror = event.replace(/^main_agent_/, "custom_agent_");
      if (mirror !== event) emit(params.send, mirror, data);
    }
  };
  emit(params.send, "summary_execution_started", { ...base, state: "PAUSING" });
  emitTopLevel("main_agent_pause_initiated", { ...base, state: "PAUSING" });

  if (params.signal?.aborted) {
    setState(handoff.handoffId, "CANCELLED");
    emit(params.send, "summary_execution_failed", {
      ...base,
      state: "CANCELLED",
      code: "aborted",
      message: "Handoff cancelled before it started. Original context is preserved.",
    });
    recordTerminal({
      state: "CANCELLED",
      summary: null,
      summaryChars: null,
      latestUserInput: null,
      code: "aborted",
      error: "Handoff cancelled before it started.",
    });
    return { ok: false, state: "CANCELLED", handoff, code: "aborted" };
  }

  // Snapshot + isolate (temporary retention for recovery only).
  const originalCopy: StoredMessage[] = params.messages.map((m) => ({ ...m }));
  void originalCopy;
  const snapshot = buildSummarySnapshot(params.messages, handoff);

  // PAUSED: top-level agent cannot generate, execute tools, or modify task state.
  setState(handoff.handoffId, "PAUSED");
  emitTopLevel("main_agent_paused", { ...base, state: "PAUSED" });

  // SUMMARIZING with the exact required prompts + allowlisted input only.
  setState(handoff.handoffId, "SUMMARIZING");
  let systemPrompt: string;
  let requestPrompt: string;
  try {
    systemPrompt = loadSummarySystemPrompt();
    requestPrompt = loadSummaryRequestPrompt();
  } catch (error) {
    setState(handoff.handoffId, "SUMMARY_FAILED");
    const message = error instanceof Error ? error.message : String(error);
    emit(params.send, "summary_execution_failed", {
      ...base,
      state: "SUMMARY_FAILED",
      code: "prompt_load_failed",
      message,
    });
    recordTerminal({
      state: "SUMMARY_FAILED",
      summary: null,
      summaryChars: null,
      latestUserInput: snapshot.latestUserInput || null,
      code: "prompt_load_failed",
      error: message,
    });
    return { ok: false, state: "SUMMARY_FAILED", handoff, code: "prompt_load_failed" };
  }
  const userMessage = `${requestPrompt}\n\n${serializeSnapshot(snapshot)}`;

  const chunkSend = (event: string, data: Record<string, unknown>): void => {
    if (event === "summary_chunk" && typeof data.value === "string") {
      emit(params.send, "summary_output_chunk", { ...base, value: data.value });
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

  emit(params.send, "summary_generation_ended", {
    ...base,
    finish_reason: outcome.finishReason,
    aborted: outcome.aborted,
  });
  emit(params.send, "summary_agent_run_completed", {
    ...base,
    stream_ok: outcome.streamOk,
    aborted: outcome.aborted,
  });

  // Completion requires a real final summary — never stream close alone.
  if (outcome.aborted || params.signal?.aborted) {
    // Duplicate terminal signals cannot resurrect this job: state is already set.
    if (getState(handoff.handoffId) !== "SUMMARIZING") {
      return { ok: false, state: getState(handoff.handoffId) ?? "CANCELLED", handoff };
    }
    setState(handoff.handoffId, "CANCELLED");
    emit(params.send, "summary_execution_failed", {
      ...base,
      state: "CANCELLED",
      code: "aborted",
      message: "Summary run was cancelled. Original context is preserved.",
    });
    recordTerminal({
      state: "CANCELLED",
      summary: null,
      summaryChars: null,
      latestUserInput: snapshot.latestUserInput || null,
      code: "aborted",
      error: "Summary run was cancelled.",
    });
    return { ok: false, state: "CANCELLED", handoff, code: "aborted" };
  }
  if (!outcome.streamOk) {
    setState(handoff.handoffId, "SUMMARY_FAILED");
    emit(params.send, "summary_execution_failed", {
      ...base,
      state: "SUMMARY_FAILED",
      code: "provider_error",
      message: outcome.error ?? "Summary stream failed without a final result. Original context is preserved.",
    });
    recordTerminal({
      state: "SUMMARY_FAILED",
      summary: null,
      summaryChars: null,
      latestUserInput: snapshot.latestUserInput || null,
      code: "provider_error",
      error: outcome.error ?? "Summary stream failed.",
    });
    return { ok: false, state: "SUMMARY_FAILED", handoff, code: "provider_error", error: outcome.error };
  }

  emit(params.send, "final_summary_received", { ...base, chars: outcome.text.length });

  const validation = validateFinalSummary(outcome.text);
  if (!validation.ok || !validation.summary) {
    // Guard against duplicate validation events: first verdict wins.
    if (getState(handoff.handoffId) !== "SUMMARIZING") {
      return { ok: false, state: getState(handoff.handoffId) ?? "SUMMARY_INCOMPLETE", handoff };
    }
    setState(handoff.handoffId, "SUMMARY_INCOMPLETE");
    emit(params.send, "summary_execution_failed", {
      ...base,
      state: "SUMMARY_INCOMPLETE",
      code: validation.code ?? "summary_invalid",
      message: validation.message ?? "Summary was empty or invalid. Original context is preserved.",
    });
    recordTerminal({
      state: "SUMMARY_INCOMPLETE",
      summary: null,
      summaryChars: null,
      latestUserInput: snapshot.latestUserInput || null,
      code: validation.code ?? "summary_invalid",
      error: validation.message ?? "Summary was empty or invalid.",
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
  emit(params.send, "final_summary_validated", {
    ...base,
    state: "SUMMARY_VALIDATED",
    chars: validation.summary.length,
  });

  // Build the approved continuation context (summary + latest input + system
  // prompt; memory/knowledge stay live via their runtimes when active).
  const continuation: ContinuationContext = {
    summary: validation.summary,
    latestUserInput: snapshot.latestUserInput,
    systemPrompt: params.systemPrompt,
    memoryActive: params.memoryActive,
    knowledgeActive: params.knowledgeActive,
  };
  const replacement = buildContinuationMessages(continuation);
  if (replacement.length === 0 || !replacement[0]?.content) {
    setState(handoff.handoffId, "HANDOFF_FAILED");
    emit(params.send, "summary_execution_failed", {
      ...base,
      state: "HANDOFF_FAILED",
      code: "replacement_empty",
      message: "Replacement context was empty. Original context is preserved.",
    });
    recordTerminal({
      state: "HANDOFF_FAILED",
      summary: validation.summary,
      summaryChars: validation.summary.length,
      latestUserInput: snapshot.latestUserInput || null,
      code: "replacement_empty",
      error: "Replacement context was empty.",
    });
    return { ok: false, state: "HANDOFF_FAILED", handoff, code: "replacement_empty" };
  }

  emit(params.send, "context_replacement_started", { ...base, state: "SUMMARY_VALIDATED" });

  // CONTEXT_REPLACED: caller commits replacement atomically (single assignment).
  // Duplicate replacement events cannot double-commit: state gate first.
  if (getState(handoff.handoffId) !== "SUMMARY_VALIDATED") {
    return { ok: false, state: getState(handoff.handoffId) ?? "HANDOFF_FAILED", handoff };
  }
  setState(handoff.handoffId, "CONTEXT_REPLACED");
  emitTopLevel("main_agent_context_replaced", {
    ...base,
    state: "CONTEXT_REPLACED",
    summary_chars: validation.summary.length,
  });
  recordTerminal({
    state: "CONTEXT_REPLACED",
    summary: validation.summary,
    summaryChars: validation.summary.length,
    latestUserInput: snapshot.latestUserInput || null,
    code: null,
    error: null,
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

/** Mark a handoff resumed after the caller commits replacement and continues. */
export function markResumed(
  handoff: HandoffIds,
  send?: (event: string, data: Record<string, unknown>) => void,
): void {
  if (getState(handoff.handoffId) !== "CONTEXT_REPLACED") return;
  setState(handoff.handoffId, "RESUMED");
  const list = historyByChat.get(handoff.chatId || "");
  const record = list?.find((r) => r.handoffId === handoff.handoffId);
  if (record) record.state = "RESUMED";
  const agent = handoff.agent === "custom" ? "custom" : "main";
  const payload: Record<string, unknown> = {
    chat_id: handoff.chatId,
    handoff_id: handoff.handoffId,
    state: "RESUMED",
    agent,
  };
  if (typeof handoff.customAgentId === "string" && handoff.customAgentId.trim()) {
    payload.custom_agent_id = handoff.customAgentId.trim();
  }
  if (typeof handoff.customAgentName === "string" && handoff.customAgentName.trim()) {
    payload.custom_agent_name = handoff.customAgentName.trim();
  }
  try {
    send?.("main_agent_execution_resumed", payload);
    if (agent === "custom") send?.("custom_agent_execution_resumed", payload);
  } catch {
    // ignore
  }
}
