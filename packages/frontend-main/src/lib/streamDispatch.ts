import { useStore } from "@/store/useStore";
import { uid } from "@/utils/id";
import { watchMemoryAgentRun } from "@/lib/memoryAgent";
import {
  normalizeContextUsageEvent,
  normalizeSubAgentUsageEvent,
  normalizeTeamUsageEvent,
} from "@/lib/contextMeter";
import { normalizeMcpServers } from "@/lib/mcp";
import { normalizeChannel } from "@/lib/channels";
import { normalizeConnectors } from "@/lib/connectors";
import { normalizePromptLibrary } from "@/lib/promptLibrary";
import { normalizeMainAgentPrompts } from "@/lib/mainAgentPrompts";
import { normalizeCustomAgents } from "@/lib/customAgents";
import { normalizeSlideProject, normalizeTemplateSummaries } from "@/lib/slides";
import type { StreamBatcher } from "@/lib/streamBatcher";
import type {
  AttachedFile,
  KnowledgeFile,
  MemoryFile,
  SSEEventData,
  TodoItem,
} from "@/types";

type Store = ReturnType<typeof useStore.getState>;

export interface DispatchContext {
  convId: string;
  msgId: string;
  batcher: StreamBatcher;
  onFilesChanged?: () => void;
  /** When resuming a run, the message is reset once on the first replayed event. */
  resume: { pending: boolean };
}

function normalizeAttachedFiles(raw: unknown, prefix = "att"): AttachedFile[] {
  if (!Array.isArray(raw)) return [];
  const out: AttachedFile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const path =
      typeof record.path === "string" && record.path.trim().length > 0 ? record.path.trim() : "";
    if (!path) continue;
    const name =
      typeof record.name === "string" && record.name.trim().length > 0
        ? record.name.trim()
        : (path.split("/").pop() ?? path);
    out.push({
      id: uid(prefix),
      name,
      path,
      size: typeof record.size === "number" ? record.size : 0,
      content_type:
        typeof record.content_type === "string" ? record.content_type : "application/octet-stream",
      size_label: typeof record.size_label === "string" ? record.size_label : undefined,
    });
  }
  return out;
}

/** Build the batch tool-chip label, e.g. "Sub-Agents (3): alpha, beta, gamma". */
function multiSubAgentLabel(children: Array<{ run: { agent: string } }>): string {
  const names = children.map((c) => c.run.agent).filter((n) => n.length > 0);
  const shown = names.slice(0, 3).join(", ");
  const extra = names.length > 3 ? `, +${names.length - 3} more` : "";
  return `Sub-Agents (${children.length}): ${shown}${extra}`.trim();
}

function extractUrl(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const record = raw as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url : "";
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : "";
}

function persistCreatedSubAgent(s: Store, raw: Record<string, unknown>): void {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return;
  const description = typeof raw.description === "string" ? raw.description : "";
  const systemPrompt = typeof raw.system_prompt === "string" ? raw.system_prompt : "";
  const tools = Array.isArray(raw.tools) ? raw.tools.filter((t): t is string => typeof t === "string") : [];
  const existing = s.subAgents.find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) s.updateSubAgent(existing.id, { name, description, systemPrompt, tools, enabled: true });
  else s.addSubAgent({ name, description, systemPrompt, tools, enabled: true });
}

function persistDeletedSubAgent(s: Store, rawName: unknown): void {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return;
  // Remove the user-defined sub-agent matching the name (case-insensitive). Built-in defaults
  // (id prefixed with "default-") are never removed — the backend already blocks deleting them.
  const target = s.subAgents.find(
    (a) => !a.id.startsWith("default-") && a.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (target) s.deleteSubAgent(target.id);
}

function persistDeletedSkill(s: Store, rawName: unknown): void {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return;
  // Remove the user-defined skill matching the name (case-insensitive). Built-in defaults
  // (id prefixed with "default-") are never removed — the backend already blocks deleting them.
  const target = s.skills.find(
    (sk) => !sk.id.startsWith("default-") && sk.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (target) s.deleteSkill(target.id);
}

function persistCreatedSkill(s: Store, raw: Record<string, unknown>): void {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return;
  const description = typeof raw.description === "string" ? raw.description : "";
  const skillFile = (
    typeof raw.skill_file === "string" && raw.skill_file.trim().length > 0 ? raw.skill_file : "SKILL.md"
  ).replace(/^[\\/]+/, "");
  const rawFiles = Array.isArray(raw.files) ? raw.files : [];
  const files: Array<{ path: string; content: string }> = [];
  for (const f of rawFiles) {
    if (!f || typeof f !== "object") continue;
    const rec = f as Record<string, unknown>;
    const p = typeof rec.path === "string" ? rec.path.trim().replace(/^[\\/]+/, "") : "";
    if (!p) continue;
    files.push({ path: p, content: typeof rec.content === "string" ? rec.content : "" });
  }
  const entry = files.find((f) => f.path.toLowerCase() === skillFile.toLowerCase());
  const entryContent = entry?.content ?? "";
  const skillContent =
    typeof raw.skill_content === "string" && raw.skill_content.trim().length > 0
      ? raw.skill_content
      : entryContent;
  const extraFiles = files.filter((f) => f.path.toLowerCase() !== skillFile.toLowerCase());
  const existing = s.skills.find((sk) => sk.name.trim().toLowerCase() === name.toLowerCase());
  if (existing)
    s.updateSkill(existing.id, {
      name,
      description,
      skillFile,
      skillContent,
      files: extraFiles,
      enabled: true,
    });
  else s.addSkill({ name, description, skillFile, skillContent, files: extraFiles, enabled: true });
}

/**
 * Agent tag carried by top-level summarization events ("main" default keeps older
 * payloads valid). Custom agents compact through the same pipeline as the Main
 * Agent; the tag lets the UI label the run correctly.
 */
function agentOf(data: SSEEventData): {
  agent: "main" | "custom";
  customAgentId?: string | null;
  customAgentName?: string | null;
} {
  const raw = typeof data.agent === "string" ? data.agent.trim().toLowerCase() : "";
  if (raw === "custom") {
    const id = typeof data.custom_agent_id === "string" ? data.custom_agent_id : null;
    const name = typeof data.custom_agent_name === "string" ? data.custom_agent_name : null;
    return { agent: "custom", customAgentId: id, customAgentName: name };
  }
  return { agent: "main" };
}

/**
 * Apply a single SSE event to the store. Token/reasoning events go through the batcher
 * (rAF-coalesced); everything else is applied immediately after flushing the batcher so
 * ordering between streamed text and structured events is preserved.
 */
export function dispatchStreamEvent(event: string, data: SSEEventData, ctx: DispatchContext): void {
  const { convId, msgId, batcher } = ctx;
  const s = useStore.getState();

  // On the first replayed event of a resume, wipe the (possibly partial) message once so the
  // full replay rebuilds it deterministically — no duplicated or missing tokens.
  if (ctx.resume.pending) {
    ctx.resume.pending = false;
    s.resetMessageStream(convId, msgId);
  }

  switch (event) {
    case "reasoning":
      batcher.appendReasoning(String(data.value ?? ""));
      return;
    case "token":
      batcher.token(String(data.value ?? ""));
      return;
    case "sub_agent_reasoning":
      batcher.subReasoning(String(data.id ?? ""), String(data.value ?? ""));
      return;
    case "sub_agent_token":
      batcher.subToken(String(data.id ?? ""), String(data.value ?? ""));
      return;
    case "team_agent_reasoning":
      batcher.teamReasoning(String(data.agent_id ?? ""), String(data.value ?? ""));
      return;
    case "team_agent_token":
      batcher.teamToken(String(data.agent_id ?? ""), String(data.value ?? ""));
      return;
  }

  // Non-delta event → make sure buffered text lands first.
  batcher.flush();

  switch (event) {
    case "tool_call":
      s.upsertTool(convId, msgId, {
        id: String(data.id ?? uid("tool")),
        name: String(data.name ?? "tool"),
        label: String(data.label ?? data.name ?? "tool"),
        status: "running",
        args: (data.args as Record<string, unknown> | undefined) ?? undefined,
        filePath: (data.args as Record<string, unknown> | undefined)?.file_path as string | undefined,
      });
      break;

    case "plan_review": {
      const planId = String(data.id ?? uid("tool"));
      s.setPlanPending(convId, msgId, planId, {
        id: planId,
        chatId: String(data.chat_id ?? convId),
        plan: String(data.plan ?? ""),
      });
      break;
    }

    case "ask_question": {
      const askId = String(data.id ?? uid("tool"));
      const questions = (data.questions ?? []).map((q) => ({
        question: String(q?.question ?? ""),
        context: String(q?.context ?? ""),
        options: (q?.options ?? []).map((o) => String(o)),
      }));
      s.setQuestionPending(convId, msgId, askId, {
        id: askId,
        chatId: String(data.chat_id ?? convId),
        questions,
      });
      break;
    }

    case "ask_for_something": {
      const askId = String(data.id ?? uid("tool"));
      const items = (data.items ?? []).map((it) => ({
        request: String(it?.request ?? ""),
        placeholder: String(it?.placeholder ?? ""),
      }));
      s.setAskPending(convId, msgId, askId, {
        id: askId,
        chatId: String(data.chat_id ?? convId),
        items,
      });
      break;
    }

    case "slides_template_choice": {
      const choiceId = String(data.id ?? uid("tool"));
      const templates = normalizeTemplateSummaries(data.templates).map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        slide_count: template.slide_count,
        builtin: template.builtin,
      }));
      s.setSlidesChoicePending(convId, msgId, choiceId, {
        id: choiceId,
        chatId: String(data.chat_id ?? convId),
        templates,
        timeoutMs: typeof data.timeout_ms === "number" ? data.timeout_ms : 120_000,
      });
      break;
    }

    case "slides_present": {
      const projects = Array.isArray(data.projects)
        ? data.projects
            .map((project) => normalizeSlideProject(project))
            .filter((project): project is NonNullable<typeof project> => project !== null)
        : [];
      const toolId =
        typeof data.tool_call_id === "string" && data.tool_call_id.length > 0
          ? data.tool_call_id
          : "";
      if (projects.length > 0 && toolId) s.setSlidesPresented(convId, msgId, toolId, projects);
      break;
    }

    case "slides_templates_updated":
      // The Slides panel refetches when opened; templates saved by the agent are also
      // reflected on the next panel load. No store slice is needed for this event.
      break;

    case "tool_result": {
      const ok = Boolean(data.ok);
      const id = String(data.id ?? uid("tool"));
      const name = String(data.name ?? "tool");
      const result = (data.result ?? {}) as { decision?: string } | undefined;
      s.upsertTool(convId, msgId, {
        id,
        name,
        label: String(data.label ?? data.name ?? "tool"),
        status: ok ? "ok" : "error",
        result: data.result,
      });

      const payload = (data.result as Record<string, unknown> | undefined)?.data as
        | Record<string, unknown>
        | undefined;
      if (ok && name === "create_sub_agent" && payload?.created_sub_agent) {
        persistCreatedSubAgent(s, payload.created_sub_agent as Record<string, unknown>);
      }
      if (ok && name === "delete_sub_agent" && payload?.deleted_sub_agent) {
        persistDeletedSubAgent(s, payload.deleted_sub_agent);
      }
      if (ok && name === "create_skill" && payload?.created_skill) {
        persistCreatedSkill(s, payload.created_skill as Record<string, unknown>);
      }
      if (ok && name === "delete_skill" && payload?.deleted_skill) {
        persistDeletedSkill(s, payload.deleted_skill);
      }
      if ((name === "TodoWrite" || name === "read_todos") && Array.isArray(payload?.todos)) {
        s.setTodos(payload.todos as TodoItem[]);
      }
      if (name === "embed_url") {
        const url = extractUrl(data.result);
        if (url) {
          s.setPreview(url);
          s.setPreviewOpen(true);
        }
      }
      if (name === "attach_files") {
        const files = normalizeAttachedFiles(payload?.files, "att");
        if (files.length > 0) {
          s.addAttachedFiles(files);
          s.setFilesOpen(true);
        }
      }
      if (name === "submit_plan" && result?.decision) {
        const map: Record<string, "approved" | "canceled" | "edited" | "timeout"> = {
          approved: "approved",
          edited: "edited",
          canceled: "canceled",
          timeout: "timeout",
        };
        const planStatus = map[result.decision];
        if (planStatus) s.setPlanStatus(convId, msgId, id, planStatus);
      }
      if (
        name === "ask_question_to_user" &&
        (result?.decision === "answered" || result?.decision === "timeout")
      ) {
        s.setQuestionStatus(convId, msgId, id, result.decision === "answered" ? "answered" : "timeout");
      }
      if (
        name === "ask_for_something" &&
        (result?.decision === "submitted" ||
          result?.decision === "rejected" ||
          result?.decision === "timeout")
      ) {
        s.setAskStatus(
          convId,
          msgId,
          id,
          result.decision === "submitted"
            ? "submitted"
            : result.decision === "rejected"
              ? "rejected"
              : "timeout",
        );
      }
      if (name === "ask_user_to_choose_slides_template" && result?.decision) {
        if (result.decision === "selected") {
          const selected = payload?.template as { id?: unknown } | undefined;
          s.setSlidesChoiceStatus(
            convId,
            msgId,
            id,
            "selected",
            typeof selected?.id === "string" ? selected.id : undefined,
          );
        } else if (result.decision === "timeout") {
          s.setSlidesChoiceStatus(convId, msgId, id, "timeout");
        } else if (result.decision === "channel_unavailable") {
          s.setSlidesChoiceStatus(convId, msgId, id, "channel_unavailable");
        }
      }
      ctx.onFilesChanged?.();
      break;
    }

    case "todo_updated":
      if (Array.isArray(data.todos)) s.setTodos(data.todos as TodoItem[]);
      break;

    case "memory_updated":
      if (Array.isArray(data.memoryFiles)) s.setMemory(data.memoryFiles as MemoryFile[]);
      break;

    case "memory_agent_queued":
      // The turn just enqueued a background memory-build run — attach to its stream so the
      // popup can show it live and the agent's memory updates mirror into this browser.
      if (typeof data.run_id === "string" && data.run_id.length > 0) {
        watchMemoryAgentRun(data.run_id);
      }
      break;

    case "context_usage": {
      // Multi-scope context-token logs from the backend event pipeline (live or
      // replayed). Each scope feeds its own meter section; unknown/malformed payloads
      // are ignored so one agent's usage is never shown as another's. Latest event
      // per conversation (or per runned sub/team/CEO agent) wins.
      const scope = typeof data.agent === "string" ? data.agent.trim().toLowerCase() : "";
      if (scope === "sub_agent") {
        const entry = normalizeSubAgentUsageEvent(data);
        if (entry) {
          s.setSubAgentUsage(convId, { ...entry, updatedAt: Date.now() });
        }
      } else if (scope === "team") {
        const entry = normalizeTeamUsageEvent(data, "team");
        if (entry) {
          s.setTeamUsage(convId, { ...entry, updatedAt: Date.now() });
        }
      } else if (scope === "ceo") {
        const entry = normalizeTeamUsageEvent(data, "ceo");
        if (entry) {
          s.setCeoUsage(convId, { ...entry, updatedAt: Date.now() });
        }
      } else if (scope === "custom") {
        const usage = normalizeContextUsageEvent(data, "custom");
        if (usage) {
          s.setCustomContextUsage(convId, { ...usage, updatedAt: Date.now() });
        }
      } else if (scope === "chat") {
        const usage = normalizeContextUsageEvent(data, "chat");
        if (usage) {
          s.setChatContextUsage(convId, { ...usage, updatedAt: Date.now() });
        }
      } else {
        const usage = normalizeContextUsageEvent(data, "main");
        if (usage) {
          s.setContextUsage(convId, { ...usage, updatedAt: Date.now() });
        }
      }
      break;
    }

    // ---- Automatic context summarization handoff ----
    // Authoritative backend lifecycle; the UI never shows success before
    // SUMMARY_VALIDATED + CONTEXT_REPLACED + RESUMED. Chunks accumulate in
    // order; the validated summary commits separately; closing the popup never
    // cancels the job; replay is incremental via the resume cursor.
    case "summary_execution_started": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) s.startSummaryHandoff(convId, handoffId, "pausing", agentOf(data));
      break;
    }
    case "main_agent_pause_initiated":
    case "custom_agent_pause_initiated": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) s.updateSummaryHandoff(convId, handoffId, { status: "pausing", ...agentOf(data) });
      break;
    }
    case "main_agent_paused":
    case "custom_agent_paused": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) s.updateSummaryHandoff(convId, handoffId, { status: "paused", ...agentOf(data) });
      break;
    }
    case "summary_output_chunk": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      const chunk = typeof data.value === "string" ? data.value : "";
      if (handoffId && chunk) {
        s.updateSummaryHandoff(convId, handoffId, { status: "summarizing" });
        s.appendSummaryChunk(convId, handoffId, chunk);
      }
      break;
    }
    case "summary_generation_ended":
    case "summary_agent_run_completed":
      break;
    case "final_summary_received": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) s.updateSummaryHandoff(convId, handoffId, { status: "summarizing" });
      break;
    }
    case "final_summary_validated": {
      // Final validated summary text is not carried in the event (avoid large
      // duplicate payloads); the streaming text accumulated so far is the
      // validated content. Status flips only here — never on stream close.
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) {
        const existing = useStore.getState().summaryHandoffs[convId];
        const text = existing && existing.handoffId === handoffId ? existing.streamingText : "";
        s.updateSummaryHandoff(convId, handoffId, {
          status: "validated",
          finalSummary: text,
          summaryChars: typeof data.chars === "number" ? data.chars : text.length,
          ...agentOf(data),
        });
        const updated = useStore.getState().summaryHandoffs[convId];
        if (updated && updated.handoffId === handoffId) s.upsertSummaryHistory(convId, { ...updated });
      }
      break;
    }
    case "context_replacement_started":
      break;
    case "main_agent_context_replaced":
    case "custom_agent_context_replaced": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) {
        s.updateSummaryHandoff(convId, handoffId, { status: "replaced", ...agentOf(data) });
        const updated = useStore.getState().summaryHandoffs[convId];
        if (updated && updated.handoffId === handoffId) s.upsertSummaryHistory(convId, { ...updated });
      }
      break;
    }
    case "main_agent_execution_resumed":
    case "custom_agent_execution_resumed": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) {
        s.updateSummaryHandoff(convId, handoffId, { status: "resumed", ...agentOf(data) });
        const updated = useStore.getState().summaryHandoffs[convId];
        if (updated && updated.handoffId === handoffId) s.upsertSummaryHistory(convId, { ...updated });
      }
      break;
    }
    case "summary_execution_failed": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) {
        const state = typeof data.state === "string" ? data.state : "";
        const status =
          state === "SUMMARY_INCOMPLETE" ? "incomplete" : state === "CANCELLED" ? "failed" : "failed";
        s.updateSummaryHandoff(convId, handoffId, {
          status,
          error: typeof data.message === "string" ? data.message : "Summarization failed.",
          code: typeof data.code === "string" ? data.code : null,
          ...agentOf(data),
        });
        const updated = useStore.getState().summaryHandoffs[convId];
        if (updated && updated.handoffId === handoffId) s.upsertSummaryHistory(convId, { ...updated });
      }
      break;
    }
    case "recovery_required": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) {
        s.updateSummaryHandoff(convId, handoffId, {
          status: "recovery",
          error: "Handoff needs recovery. Original context was preserved.",
          code: typeof data.code === "string" ? data.code : null,
          ...agentOf(data),
        });
        const updated = useStore.getState().summaryHandoffs[convId];
        if (updated && updated.handoffId === handoffId) s.upsertSummaryHistory(convId, { ...updated });
      }
      break;
    }

    // ---- Sub-agent context summarization handoffs ----
    // Same lifecycle as the main agent, but per sub-agent run (keyed by handoff id)
    // so concurrent summarizations of multiple sub-agents each stream live output.
    // Closing the popup never cancels backend jobs; replay is incremental.
    case "sub_agent_summary_execution_started": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      const subSessionId = typeof data.sub_session_id === "string" ? data.sub_session_id : "";
      const subAgentName = typeof data.sub_agent === "string" ? data.sub_agent : "";
      if (handoffId) s.startSubAgentSummary(convId, { handoffId, subSessionId, subAgentName, status: "pausing" });
      break;
    }
    case "sub_agent_pause_initiated": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) s.updateSubAgentSummary(convId, handoffId, { status: "pausing" });
      break;
    }
    case "sub_agent_paused": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) s.updateSubAgentSummary(convId, handoffId, { status: "paused" });
      break;
    }
    case "sub_agent_summary_output_chunk": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      const chunk = typeof data.value === "string" ? data.value : "";
      if (handoffId && chunk) {
        s.updateSubAgentSummary(convId, handoffId, { status: "summarizing" });
        s.appendSubAgentSummaryChunk(convId, handoffId, chunk);
      }
      break;
    }
    case "sub_agent_summary_generation_ended":
    case "sub_agent_summary_run_completed":
      break;
    case "sub_agent_final_summary_received": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) s.updateSubAgentSummary(convId, handoffId, { status: "summarizing" });
      break;
    }
    case "sub_agent_final_summary_validated": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) {
        const perConv = useStore.getState().subAgentSummaries[convId] ?? {};
        const existing = perConv[handoffId];
        const text = existing ? existing.streamingText : "";
        s.updateSubAgentSummary(convId, handoffId, {
          status: "validated",
          finalSummary: text,
          summaryChars: typeof data.chars === "number" ? data.chars : text.length,
        });
      }
      break;
    }
    case "sub_agent_context_replacement_started":
      break;
    case "sub_agent_context_replaced": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) s.updateSubAgentSummary(convId, handoffId, { status: "replaced" });
      break;
    }
    case "sub_agent_execution_resumed": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) s.updateSubAgentSummary(convId, handoffId, { status: "resumed" });
      break;
    }
    case "sub_agent_summary_execution_failed": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) {
        const state = typeof data.state === "string" ? data.state : "";
        const status = state === "SUMMARY_INCOMPLETE" ? "incomplete" : state === "CANCELLED" ? "failed" : "failed";
        s.updateSubAgentSummary(convId, handoffId, {
          status,
          error: typeof data.message === "string" ? data.message : "Sub-agent summarization failed.",
          code: typeof data.code === "string" ? data.code : null,
        });
      }
      break;
    }
    case "sub_agent_recovery_required": {
      const handoffId = typeof data.handoff_id === "string" ? data.handoff_id : "";
      if (handoffId) {
        s.updateSubAgentSummary(convId, handoffId, {
          status: "recovery",
          error: "Sub-agent handoff needs recovery. Original context was preserved.",
          code: typeof data.code === "string" ? data.code : null,
        });
      }
      break;
    }

    case "knowledge_updated":
      if (Array.isArray(data.knowledgeFiles)) s.setKnowledge(data.knowledgeFiles as KnowledgeFile[]);
      break;

    case "prompt_library_updated":
      // An agent-driven prompt-library tool (save/delete) mutated the persisted
      // library. Mirror the backend truth into the store so the Prompt Library page
      // and the "/" composer shortcut converge immediately instead of on next boot.
      if (Array.isArray(data.prompts)) s.setPromptLibrary(normalizePromptLibrary(data.prompts));
      break;

    case "custom_agents_updated":
      // An agent-driven custom-agent tool (create/delete) mutated the persisted
      // store. Mirror the backend truth into the store so the Custom Agents panel
      // converges immediately instead of on next boot.
      if (Array.isArray(data.agents)) s.setCustomAgents(normalizeCustomAgents(data.agents));
      break;

    case "main_agent_prompts_updated":
      // An agent-driven custom-system-prompt tool (save/delete) mutated the persisted
      // store. Mirror the backend truth into the store so the Custom system prompts
      // panel converges immediately instead of on next boot.
      if (Array.isArray(data.prompts)) s.setMainAgentPrompts(normalizeMainAgentPrompts(data.prompts));
      break;

    case "mcp_servers_updated":
      // An agent-driven MCP management tool mutated the persisted servers.
      // Mirror the backend truth into the store so the MCP page + the next
      // chat turn (which sends enabled server ids) converge immediately.
      if (Array.isArray((data as Record<string, unknown>).servers)) {
        try {
          const raw = (data as Record<string, unknown>).servers;
          const normalized = normalizeMcpServers(raw);
          if (normalized.length > 0 || (raw as unknown[]).length === 0) {
            s.setMcpServers(normalized);
          }
        } catch {
          // best effort — the MCP page refetches on open anyway
        }
      }
      break;

    case "mcp_oauth_required": {
      // The agent started an OAuth MCP connection and is blocked waiting for
      // the user (up to 3 minutes). Stash the pending server on the tool block
      // so the Connect button can resolve its server id even before tool_result.
      const toolId =
        typeof (data as Record<string, unknown>).tool_call_id === "string"
          ? ((data as Record<string, unknown>).tool_call_id as string)
          : null;
      const serverId =
        typeof (data as Record<string, unknown>).server_id === "string"
          ? ((data as Record<string, unknown>).server_id as string)
          : null;
      const serverName =
        typeof (data as Record<string, unknown>).server_name === "string"
          ? ((data as Record<string, unknown>).server_name as string)
          : null;
      if (toolId && serverId) {
        s.upsertTool(convId, msgId, {
          id: toolId,
          name: "connect_remote_mcp",
          label: serverName ? `Connect MCP: ${serverName}` : "Connect MCP server",
          status: "running",
          result: { oauth_pending: true, server_id: serverId, server_name: serverName } as never,
        });
      }
      break;
    }

    case "connectors_updated": {
      // An agent-driven connector management tool mutated the persisted connections.
      // Mirror the backend truth into the store so the Connectors page AND the next
      // chat turn (which sends the active connected-account refs) converge at once.
      const raw = (data as Record<string, unknown>).connectors;
      if (Array.isArray(raw)) {
        try {
          s.setConnectors(normalizeConnectors(raw));
        } catch {
          // best effort — the Connectors page refetches on open anyway
        }
      }
      break;
    }

    case "connector_connect_required": {
      // The backend opened the Composio OAuth session and is blocked waiting for the
      // user (up to 3 minutes). Stash the link on the tool block so the Connect button
      // renders inside this tool's block even before tool_result arrives.
      const raw = data as Record<string, unknown>;
      const toolId = typeof raw.tool_call_id === "string" ? (raw.tool_call_id as string) : null;
      const connectorName =
        typeof raw.connector_name === "string" ? (raw.connector_name as string) : "";
      const connectorLabel =
        typeof raw.connector_label === "string" ? (raw.connector_label as string) : connectorName;
      if (toolId && connectorName) {
        s.upsertTool(convId, msgId, {
          id: toolId,
          name: "connect_applications_connectors",
          label: connectorLabel ? `Connect app: ${connectorLabel}` : "Connect application connector",
          status: "running",
          args: { connector_name: connectorName },
          result: {
            connector_connect_pending: true,
            connector_name: connectorName,
            connector_label: connectorLabel,
            description: typeof raw.description === "string" ? raw.description : "",
            redirect_url: typeof raw.redirect_url === "string" ? raw.redirect_url : "",
            connected_account_id:
              typeof raw.connected_account_id === "string" ? raw.connected_account_id : "",
          } as never,
        });
      }
      break;
    }

    case "channels_updated": {
      // An agent-driven channel management tool mutated the persisted connections.
      // Mirror the backend truth into the store so the Channels page + the next
      // chat turn converge immediately.
      const raw = (data as Record<string, unknown>).channels;
      if (Array.isArray(raw)) {
        try {
          const normalized = raw
            .map((item) => normalizeChannel(item))
            .filter((c): c is NonNullable<typeof c> => c !== null);
          s.setChannelConnections(normalized);
        } catch {
          // best effort — the Channels page refetches on open anyway
        }
      }
      break;
    }

    case "channel_connection_request": {
      // The agent asked the user to configure + connect a channel and is blocked
      // waiting for up to 3 minutes. Stash the pending channel on the tool block
      // so the inline configuration form (name + token + setup guide + Connect
      // button) renders inside this tool's block even before tool_result arrives.
      const raw = data as Record<string, unknown>;
      const toolId = typeof raw.tool_call_id === "string" ? (raw.tool_call_id as string) : null;
      const channelName = typeof raw.channel_name === "string" ? (raw.channel_name as string) : "";
      const channelLabel = typeof raw.channel_label === "string" ? (raw.channel_label as string) : channelName;
      if (toolId && channelName) {
        s.upsertTool(convId, msgId, {
          id: toolId,
          name: "request_channel_connection_to_user",
          label: channelLabel ? `Connect channel: ${channelLabel}` : "Request channel connection",
          status: "running",
          args: { channel_name: channelName },
          result: {
            channel_connection_pending: true,
            channel_name: channelName,
            channel_label: channelLabel,
            description: typeof raw.description === "string" ? raw.description : "",
            setup_guide: typeof raw.setup_guide === "string" ? raw.setup_guide : "",
            addressing: typeof raw.addressing === "string" ? raw.addressing : "",
          } as never,
        });
      }
      break;
    }

    case "embed_url": {
      const url = extractUrl(data);
      if (url) {
        s.setPreview(url);
        s.setPreviewOpen(true);
      }
      break;
    }

    case "attach_files": {
      const files = normalizeAttachedFiles(data.files, "att");
      if (files.length > 0) {
        s.addAttachedFiles(files);
        s.setFilesOpen(true);
      }
      break;
    }

    case "multi_sub_agents_start": {
      // A call_multiple_sub_agents batch was launched. Pre-create one run slot per child so every
      // sub-agent renders its own block inside the batch tool block, in the requested order.
      const parentId = String(data.id ?? uid("tool"));
      const list = Array.isArray(data.agents) ? data.agents : [];
      const children = list.map((a, i) => ({
        id: String(a?.id ?? `${parentId}::${i}`),
        run: {
          agent: String(a?.agent ?? ""),
          task: String(a?.task ?? ""),
          background: a?.background === true,
          sentContext: a?.context_shared === true,
          error: a?.error != null ? String(a.error) : undefined,
        },
      }));
      s.startMultiSubAgents(convId, msgId, parentId, multiSubAgentLabel(children), children);
      break;
    }

    case "sub_agent_start": {
      const parentToolId = data.parent_tool_id != null ? String(data.parent_tool_id) : undefined;
      const run = {
        agent: String(data.agent ?? ""),
        task: String(data.task ?? ""),
        background: data.background === true,
        sentContext: data.context_shared === true,
        outputFile: data.output_file != null ? String(data.output_file) : undefined,
      };
      if (parentToolId) s.startSubAgentInParent(convId, msgId, parentToolId, String(data.id ?? ""), run);
      else s.startSubAgent(convId, msgId, String(data.id ?? ""), run);
      break;
    }

    case "sub_agent_background_started": {
      // A background (wait_for_output=false) sub-agent was launched and detached from the turn.
      // Register the run so the chip renders even though no further sub_agent_* events may arrive
      // once the main turn ends (the sub-agent writes its result to the output_file instead).
      const parentToolId = data.parent_tool_id != null ? String(data.parent_tool_id) : undefined;
      const run = {
        agent: String(data.agent ?? ""),
        task: String(data.task ?? ""),
        background: true,
        sentContext: data.context_shared === true,
        outputFile: data.output_file != null ? String(data.output_file) : undefined,
      };
      if (parentToolId) s.startSubAgentInParent(convId, msgId, parentToolId, String(data.id ?? ""), run);
      else s.startSubAgent(convId, msgId, String(data.id ?? ""), run);
      break;
    }

    case "sub_agent_tool_call": {
      const parentToolId = data.parent_tool_id != null ? String(data.parent_tool_id) : undefined;
      const subTool = {
        id: String(data.tool_id ?? uid("subtool")),
        name: String(data.name ?? "tool"),
        label: String(data.label ?? data.name ?? "tool"),
        status: "running" as const,
        args: (data.args as Record<string, unknown> | undefined) ?? undefined,
        filePath: (data.args as Record<string, unknown> | undefined)?.file_path as string | undefined,
      };
      if (parentToolId)
        s.upsertSubAgentToolInParent(convId, msgId, parentToolId, String(data.id ?? ""), subTool);
      else s.upsertSubAgentTool(convId, msgId, String(data.id ?? ""), subTool);
      break;
    }

    case "sub_agent_tool_result": {
      const parentToolId = data.parent_tool_id != null ? String(data.parent_tool_id) : undefined;
      const subTool = {
        id: String(data.tool_id ?? uid("subtool")),
        name: String(data.name ?? "tool"),
        label: String(data.label ?? data.name ?? "tool"),
        status: (data.ok ? "ok" : "error") as "ok" | "error",
        result: data.result,
      };
      if (parentToolId)
        s.upsertSubAgentToolInParent(convId, msgId, parentToolId, String(data.id ?? ""), subTool);
      else s.upsertSubAgentTool(convId, msgId, String(data.id ?? ""), subTool);
      ctx.onFilesChanged?.();
      break;
    }

    case "sub_agent_done": {
      const parentToolId = data.parent_tool_id != null ? String(data.parent_tool_id) : undefined;
      const patch = {
        status: (data.ok ? "ok" : "error") as "ok" | "error",
        output: data.output != null ? String(data.output) : undefined,
        error: data.error != null ? String(data.error) : undefined,
      };
      if (parentToolId) s.finishSubAgentInParent(convId, msgId, parentToolId, String(data.id ?? ""), patch);
      else s.finishSubAgent(convId, msgId, String(data.id ?? ""), patch);
      break;
    }

    // ---- Multi-agent team events ----
    case "team_start": {
      const roster = (Array.isArray(data.members) ? data.members : []).map((m) => ({
        id: String(m?.agent_id ?? ""),
        name: String(m?.agent_id ?? ""),
        role: (m?.role === "leader" ? "leader" : "member") as "leader" | "member",
        description: m?.description != null ? String(m.description) : undefined,
        status: "idle" as const,
        queued: 0,
        segments: [],
      }));
      s.startTeamRun(convId, msgId, {
        teamName: String(data.team_name ?? "Agent team"),
        leaderId: String(data.leader_id ?? ""),
        sendMessageEnabled: data.send_message_enabled === true,
        roster,
      });
      break;
    }

    case "team_agent_start":
      s.startTeamAgentSegment(convId, msgId, String(data.agent_id ?? ""), {
        role: data.role === "leader" ? "leader" : "member",
        trigger: data.trigger != null ? String(data.trigger) : undefined,
      });
      break;

    case "team_agent_tool_call":
      s.upsertTeamAgentTool(convId, msgId, String(data.agent_id ?? ""), {
        id: String(data.tool_id ?? uid("ttool")),
        name: String(data.name ?? "tool"),
        label: String(data.label ?? data.name ?? "tool"),
        status: "running",
        args: (data.args as Record<string, unknown> | undefined) ?? undefined,
        filePath: (data.args as Record<string, unknown> | undefined)?.file_path as string | undefined,
      });
      break;

    case "team_agent_tool_result":
      s.upsertTeamAgentTool(convId, msgId, String(data.agent_id ?? ""), {
        id: String(data.tool_id ?? uid("ttool")),
        name: String(data.name ?? "tool"),
        label: String(data.label ?? data.name ?? "tool"),
        status: data.ok ? "ok" : "error",
        result: data.result,
      });
      ctx.onFilesChanged?.();
      break;

    case "team_agent_segment":
      // The agent finished a run; nothing extra to store (tokens already streamed).
      break;

    case "team_agent_done":
      s.setTeamAgentStatus(convId, msgId, String(data.agent_id ?? ""), {
        status: (data.status as "completed" | "failed" | undefined) ?? (data.ok ? "completed" : "failed"),
      });
      break;

    case "team_status":
      s.setTeamAgentStatus(convId, msgId, String(data.agent_id ?? ""), {
        status: data.status as
          | "idle"
          | "working"
          | "queued"
          | "completed"
          | "failed"
          | undefined,
        queued: typeof data.queued === "number" ? data.queued : undefined,
      });
      break;

    case "team_message":
      s.addTeamMonitorMessage(convId, msgId, {
        from: data.from != null ? String(data.from) : undefined,
        to: data.to != null ? String(data.to) : undefined,
        kind: data.kind,
        text: data.message != null ? String(data.message) : undefined,
      });
      break;

    case "sliding_window_truncated": {
      // Sliding-window context management removed the oldest tokens so the
      // agent can keep working. Rendered as a clickable tool block (same as
      // any GenericChip) so the user can expand it to see which tokens were
      // deleted. Team/CEO truncations carry agent_id/role and land in the
      // same main flow so nothing is ever silent.
      const truncationId =
        typeof data.truncation_id === "string" && data.truncation_id
          ? data.truncation_id
          : typeof data.id === "string" && data.id
            ? data.id
            : uid("tool");
      const removed =
        typeof data.removed_messages === "number" && Number.isFinite(data.removed_messages)
          ? data.removed_messages
          : 0;
      const freed =
        typeof data.freed_tokens_estimate === "number" && Number.isFinite(data.freed_tokens_estimate)
          ? data.freed_tokens_estimate
          : 0;
      const label =
        typeof data.label === "string" && data.label
          ? data.label
          : `Sliding window: removed ${removed} old message(s) (~${freed.toLocaleString("en-US")} tokens)`;
      s.upsertTool(convId, msgId, {
        id: truncationId,
        name: "sliding_window_truncated",
        label,
        status: "ok",
        result: (data.result ?? {
          ok: true,
          data: {
            removed_messages: removed,
            freed_tokens_estimate: freed,
            truncate_percent:
              typeof data.truncate_percent === "number" ? data.truncate_percent : undefined,
            preview: Array.isArray(data.preview) ? data.preview : [],
          },
        }) as never,
      });
      break;
    }

    case "sub_agent_sliding_window_truncated": {
      const truncationId =
        typeof data.truncation_id === "string" && data.truncation_id
          ? data.truncation_id
          : typeof data.id === "string" && data.id
            ? data.id
            : uid("tool");
      const subName = typeof data.sub_agent === "string" && data.sub_agent ? data.sub_agent : "sub-agent";
      const removed =
        typeof data.removed_messages === "number" && Number.isFinite(data.removed_messages)
          ? data.removed_messages
          : 0;
      const freed =
        typeof data.freed_tokens_estimate === "number" && Number.isFinite(data.freed_tokens_estimate)
          ? data.freed_tokens_estimate
          : 0;
      const label =
        typeof data.label === "string" && data.label
          ? data.label
          : `Sliding window (${subName}): removed ${removed} old message(s) (~${freed.toLocaleString("en-US")} tokens)`;
      s.upsertTool(convId, msgId, {
        id: truncationId,
        name: "sliding_window_truncated",
        label,
        status: "ok",
        result: (data.result ?? {
          ok: true,
          data: {
            removed_messages: removed,
            freed_tokens_estimate: freed,
            sub_agent: subName,
            preview: Array.isArray(data.preview) ? data.preview : [],
          },
        }) as never,
      });
      break;
    }

    case "error":
      s.applyAssistantDelta(convId, msgId, {
        contentDelta: `\n\n⚠️ ${String(data.message ?? "Agent error")}`,
      });
      break;

    default:
      break;
  }
}
