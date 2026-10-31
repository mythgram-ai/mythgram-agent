import { useState } from "react";
import { Bot, ChevronDown, FileText, History, Loader2, RefreshCcw, ShieldCheck, TriangleAlert, User } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useStore } from "@/store/useStore";
import { cn } from "@/utils/cn";
import { fetchSubAgentSummaryHistory, fetchSummaryHistory } from "@/lib/summaries";
import type { SubAgentSummaryInfo, SummaryHandoffInfo, SummaryHandoffStatus } from "@/types";

/** Stable empty history — keeps the store selector referentially stable (no new array per render). */
const EMPTY_HISTORY: SummaryHandoffInfo[] = [];

function statusLabel(status: SummaryHandoffStatus, agent: "main" | "sub" | "custom" = "main"): string {
  const who = agent === "sub" ? "Sub agent" : agent === "custom" ? "Custom agent" : "Main agent";
  switch (status) {
    case "idle":
      return "Idle";
    case "pausing":
      return `Pausing ${who.toLowerCase()}…`;
    case "paused":
      return `${who} paused`;
    case "summarizing":
      return "Summarizing…";
    case "validated":
      return "Summary validated";
    case "replaced":
      return "Context replaced";
    case "resumed":
      return `${who} resumed`;
    case "failed":
      return "Summarization failed";
    case "incomplete":
      return "Summary incomplete";
    case "recovery":
      return "Recovery required";
    default:
      return status;
  }
}

function StatusPill({ status, agent }: { status: SummaryHandoffStatus; agent?: "main" | "sub" | "custom" }) {
  const tone =
    status === "resumed"
      ? "bg-[var(--secondary)] text-[var(--secondary-fg)]"
      : status === "failed" || status === "incomplete" || status === "recovery"
        ? "bg-[var(--danger-soft)] text-[var(--danger)]"
        : status === "validated" || status === "replaced"
          ? "bg-[var(--chip)] text-[var(--fg)]"
          : "bg-[var(--chip)] text-[var(--muted)]";
  const spinning = status === "pausing" || status === "paused" || status === "summarizing";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", tone)}>
      {spinning && <Loader2 className="h-3 w-3 animate-spin" />}
      {statusLabel(status, agent)}
    </span>
  );
}

function mapBackendState(state: string): SummaryHandoffStatus {
  return state === "RESUMED"
    ? "resumed"
    : state === "CONTEXT_REPLACED"
      ? "replaced"
      : state === "SUMMARY_VALIDATED"
        ? "validated"
        : state === "SUMMARY_INCOMPLETE"
          ? "incomplete"
          : state === "CANCELLED" || state === "SUMMARY_FAILED" || state === "HANDOFF_FAILED"
            ? "failed"
            : state === "RECOVERY_REQUIRED"
              ? "recovery"
              : "summarizing";
}

type TabId = "main" | "sub";

/**
 * Summary execution popup: header button opens this modal. Shows authoritative
 * backend status (pausing/paused/summarizing/validating/replacing/resuming),
 * live-streamed summary output, the final validated summary, errors and
 * recoverable states, and confirmation that the agent resumes only after
 * validation + replacement. Closing never cancels backend jobs.
 *
 * Tabs:
 * - "Main agent": the top-level handoff (existing behavior) + past runs.
 * - "Sub agents": live sub-agent summarizations — one card per summarizing
 *   sub-agent run, each streaming its own summary-agent output in real time.
 *   This tab only appears while sub-agent summarizations exist for the thread
 *   (i.e. while a sub agent is/has been summarizing); concurrent runs all show.
 */
export function SummaryHandoffPanel() {
  const open = useStore((s) => s.summaryHandoffOpen);
  const setOpen = useStore((s) => s.setSummaryHandoffOpen);
  const currentId = useStore((s) => s.currentId);
  const handoff = useStore((s) => (currentId ? s.summaryHandoffs[currentId] : undefined));
  const history = useStore((s) => (currentId ? s.summaryHistory[currentId] : undefined)) ?? EMPTY_HISTORY;
  const setSummaryHistory = useStore((s) => s.setSummaryHistory);
  const subMap = useStore((s) => (currentId ? s.subAgentSummaries[currentId] : undefined));
  const setSubAgentSummaries = useStore((s) => s.setSubAgentSummaries);
  const [tab, setTab] = useState<TabId>("main");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [subHistoryLoading, setSubHistoryLoading] = useState(false);
  const [subHistoryError, setSubHistoryError] = useState<string | null>(null);

  const subEntries: SubAgentSummaryInfo[] = subMap ? Object.values(subMap).sort((a, b) => a.updatedAt - b.updatedAt) : [];
  // The Sub-agents tab only shows while sub-agent summarizations exist for this
  // thread (a sub agent is/was summarizing). Hidden otherwise by design.
  const showSubTab = subEntries.length > 0;
  const activeTab: TabId = tab === "sub" && !showSubTab ? "main" : tab;

  // Past runs load on explicit button press (never automatically in an effect),
  // merged with live entries already accumulated from the SSE stream.
  async function toggleHistory(): Promise<void> {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next || !currentId) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const items = await fetchSummaryHistory(currentId);
      const live = useStore.getState().summaryHistory[currentId] ?? [];
      const byId = new Map<string, (typeof live)[number]>();
      for (const item of items) {
        byId.set(item.handoff_id, {
          handoffId: item.handoff_id,
          status: mapBackendState(item.state),
          streamingText: "",
          finalSummary: item.summary,
          summaryChars: item.summary_chars,
          error: item.error,
          code: item.code,
          updatedAt: item.finished_at,
          agent: item.agent === "custom" ? "custom" : "main",
          customAgentId: item.custom_agent_id ?? null,
          customAgentName: item.custom_agent_name ?? null,
        });
      }
      for (const entry of live) byId.set(entry.handoffId, entry);
      const merged = [...byId.values()].sort((a, b) => a.updatedAt - b.updatedAt);
      setSummaryHistory(currentId, merged);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function refreshSubHistory(): Promise<void> {
    if (!currentId) return;
    setSubHistoryLoading(true);
    setSubHistoryError(null);
    try {
      const items = await fetchSubAgentSummaryHistory(currentId);
      const liveMap = useStore.getState().subAgentSummaries[currentId] ?? {};
      const byId = new Map<string, SubAgentSummaryInfo>();
      for (const item of items) {
        byId.set(item.handoff_id, {
          handoffId: item.handoff_id,
          subSessionId: item.sub_session_id,
          subAgentName: item.sub_agent,
          status: mapBackendState(item.state),
          streamingText: "",
          finalSummary: item.summary,
          summaryChars: item.summary_chars,
          error: item.error,
          code: item.code,
          updatedAt: item.finished_at,
        });
      }
      for (const entry of Object.values(liveMap)) byId.set(entry.handoffId, entry);
      const merged = [...byId.values()].sort((a, b) => a.updatedAt - b.updatedAt);
      setSubAgentSummaries(currentId, merged);
    } catch (error) {
      setSubHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubHistoryLoading(false);
    }
  }

  const status: SummaryHandoffStatus = handoff?.status ?? "idle";
  const streaming = status === "pausing" || status === "paused" || status === "summarizing";
  const success = status === "resumed";
  const failed = status === "failed" || status === "incomplete" || status === "recovery";
  const handoffAgent = handoff?.agent === "custom" ? "custom" : "main";
  const handoffAgentLabel =
    handoffAgent === "custom" && handoff?.customAgentName
      ? `Custom agent (${handoff.customAgentName})`
      : handoffAgent === "custom"
        ? "Custom agent"
        : "Main agent";
  const orderedHistory = [...history].sort((a, b) => b.updatedAt - a.updatedAt);
  const orderedSubs = [...subEntries].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Context summary"
      icon={<RefreshCcw className="h-4 w-4" strokeWidth={1.8} />}
      size="lg"
      align="top"
      actions={
        activeTab === "main" ? (
          <button
            type="button"
            onClick={() => void toggleHistory()}
            title={historyOpen ? "Hide past runs" : "Show past runs in this session"}
            aria-expanded={historyOpen}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]"
          >
            <History className="h-4 w-4" strokeWidth={1.8} />
            Past runs{history.length > 0 ? ` (${history.length})` : ""}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void refreshSubHistory()}
            title="Reload past sub-agent runs from the server"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]"
          >
            <History className="h-4 w-4" strokeWidth={1.8} />
            Reload{subHistoryLoading ? "…" : ""}
          </button>
        )
      }
    >
      {(showSubTab || handoff || history.length > 0) && (
        <div className="flex items-center gap-1 border-b border-[var(--border)] px-5 pt-3" role="tablist" aria-label="Summary scope">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "main"}
            onClick={() => setTab("main")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-t-[var(--radius-md)] px-3 py-2 text-xs font-medium transition-colors",
              activeTab === "main" ? "bg-[var(--chip)] text-[var(--fg)]" : "text-[var(--muted)] hover:text-[var(--fg)]",
            )}
          >
            <User className="h-3.5 w-3.5" /> Main agent
          </button>
          {showSubTab && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "sub"}
              onClick={() => setTab("sub")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-t-[var(--radius-md)] px-3 py-2 text-xs font-medium transition-colors",
                activeTab === "sub" ? "bg-[var(--chip)] text-[var(--fg)]" : "text-[var(--muted)] hover:text-[var(--fg)]",
              )}
            >
              <Bot className="h-3.5 w-3.5" /> Sub agents ({subEntries.length})
            </button>
          )}
        </div>
      )}

      {activeTab === "sub" ? (
        <div className="flex flex-col gap-3 px-5 py-4" role="tabpanel" aria-label="Sub-agent summarizations">
          {subHistoryError && <p className="m-0 text-xs text-[var(--danger)]">{subHistoryError}</p>}
          {orderedSubs.length === 0 ? (
            <div className="px-2 py-8 text-center text-sm text-[var(--muted)]">
              No sub-agent summarization yet. When a sub agent reaches 90% context usage it pauses,
              summarizes, replaces its context, and resumes.
            </div>
          ) : (
            orderedSubs.map((entry) => (
              <SubSummaryCard key={entry.handoffId} entry={entry} />
            ))
          )}
          <div className="rounded-[var(--radius-md)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]"
            >
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Execution details
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", detailsOpen && "rotate-180")} />
            </button>
            {detailsOpen && (
              <div className="border-t border-[var(--border)] px-3 py-2.5 text-xs leading-relaxed text-[var(--muted)]">
                <p className="m-0">
                  Each card is one sub-agent handoff: the sub agent stops immediately at 90% context
                  usage, the summary agent summarizes the same way as the main agent (chat data +
                  tool calls/results in; system prompt + reasoning out), the entire sub-agent context
                  is cleared, then the summary + system prompt + latest task input are re-sent and the
                  sub agent continues.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : !handoff && history.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-[var(--muted)]">
          No summarization run yet for this thread. When the main or custom agent reaches 90% context usage it
          pauses automatically, summarizes, replaces its context, and resumes — as many times as needed.
          {showSubTab && (
            <>
              {" "}Sub-agent runs are summarizing — open the “Sub agents” tab to watch them live.
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-5 py-4" role="tabpanel" aria-label="Main-agent summarization">
          {handoff && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                <StatusPill status={status} agent={handoffAgent} />
                <span className="font-medium text-[var(--fg)]">{handoffAgentLabel}</span>
                <span className="font-mono">{handoff.handoffId}</span>
              </div>

              {streaming && (
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3">
                  <p className="m-0 mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Summary-agent output (live)
                  </p>
                  <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-[var(--fg)]">
                    {handoff.streamingText || "Waiting for the summary agent's first output…"}
                  </p>
                </div>
              )}

              {handoff.finalSummary && (
                <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                  <p className="m-0 mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                    <ShieldCheck className="h-3.5 w-3.5 text-[var(--secondary)]" />
                    Final validated summary
                  </p>
                  <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-[var(--fg)]">
                    {handoff.finalSummary}
                  </p>
                  {handoff.summaryChars != null && (
                    <p className="m-0 mt-2 text-[11px] tabular-nums text-[var(--subtle)]">
                      {handoff.summaryChars.toLocaleString("en-US")} chars
                    </p>
                  )}
                </div>
              )}

              {success && (
                <p className="m-0 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[var(--secondary)]" />
                  {handoffAgentLabel} resumed only after the summary was validated and context replacement succeeded.
                </p>
              )}

              {failed && (
                <div className="rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] p-3">
                  <p className="m-0 flex items-center gap-1.5 text-xs font-medium text-[var(--danger)]">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    {status === "incomplete" ? "Summary incomplete — original context preserved." : "Summarization failed — original context preserved."}
                  </p>
                  {handoff.error && (
                    <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--danger)]">{handoff.error}</p>
                  )}
                  {handoff.code && (
                    <p className="m-0 mt-1 font-mono text-[11px] text-[var(--danger)]">{handoff.code}</p>
                  )}
                </div>
              )}
            </>
          )}

          {historyOpen && (
            <div className="rounded-[var(--radius-md)] border border-[var(--border)]">
              <p className="m-0 border-b border-[var(--border)] px-3 py-2.5 text-xs font-medium text-[var(--muted)]">
                Past runs in this session{historyLoading ? " (loading…)" : ` (${history.length})`}
              </p>
              {historyError && (
                <p className="m-0 px-3 py-2 text-xs text-[var(--danger)]">{historyError}</p>
              )}
              {orderedHistory.length === 0 && !historyLoading ? (
                <p className="m-0 px-3 py-3 text-xs text-[var(--subtle)]">
                  No past runs yet — completed handoffs appear here with their validated summaries.
                </p>
              ) : (
                <ul className="m-0 flex max-h-72 list-none flex-col gap-2 overflow-y-auto p-3">
                  {orderedHistory.map((entry) => (
                    <li
                      key={entry.handoffId}
                      className="rounded-[var(--radius-md)] bg-[var(--chip)] p-2.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={entry.status} agent={entry.agent === "custom" ? "custom" : "main"} />
                        <span className="text-[11px] font-medium text-[var(--fg)]">
                          {entry.agent === "custom" && entry.customAgentName
                            ? `Custom (${entry.customAgentName})`
                            : entry.agent === "custom"
                              ? "Custom"
                              : "Main"}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--subtle)]">
                          {entry.handoffId}
                        </span>
                        <span className="ml-auto text-[11px] tabular-nums text-[var(--subtle)]">
                          {new Date(entry.updatedAt).toLocaleTimeString()}
                        </span>
                      </div>
                      {entry.finalSummary && (
                        <p className="m-0 mt-1.5 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-[var(--fg)]">
                          {entry.finalSummary}
                        </p>
                      )}
                      {entry.error && (
                        <p className="m-0 mt-1.5 text-xs text-[var(--danger)]">{entry.error}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="rounded-[var(--radius-md)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]"
            >
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Execution details
              </span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", detailsOpen && "rotate-180")} />
            </button>
            {detailsOpen && (
              <div className="border-t border-[var(--border)] px-3 py-2.5 text-xs leading-relaxed text-[var(--muted)]">
                <p className="m-0">
                  Status transitions reflect authoritative backend state. A successful completion
                  indicator appears only after validation, context replacement, and resumption — never
                  merely because streaming stopped. The agent may summarize multiple times per session
                  as context refills.
                </p>
                <p className="m-0 mt-2">
                  The summary agent receives only chat data, tool calls/results, and the latest user
                  input. System prompts, memory, knowledge, and hidden reasoning are never sent.
                </p>
                {handoff && (
                  <p className="m-0 mt-2 font-mono text-[11px] text-[var(--subtle)]">
                    handoff {handoff.handoffId} · updated {new Date(handoff.updatedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function SubSummaryCard({ entry }: { entry: SubAgentSummaryInfo }) {
  const streaming = entry.status === "pausing" || entry.status === "paused" || entry.status === "summarizing";
  const success = entry.status === "resumed";
  const failed = entry.status === "failed" || entry.status === "incomplete" || entry.status === "recovery";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
        <StatusPill status={entry.status} agent="sub" />
        <span className="max-w-[12rem] truncate font-medium text-[var(--fg)]" title={entry.subAgentName}>
          {entry.subAgentName || "Sub agent"}
        </span>
        {entry.subSessionId && (
          <span className="font-mono text-[11px] text-[var(--subtle)]" title="Sub-agent session">
            {entry.subSessionId}
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-[var(--subtle)]">{entry.handoffId}</span>
      </div>

      {streaming && (
        <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--chip)] p-2.5">
          <p className="m-0 mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Summary-agent output (live)
          </p>
          <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-[var(--fg)]">
            {entry.streamingText || "Waiting for the summary agent's first output…"}
          </p>
        </div>
      )}

      {entry.finalSummary && (
        <div className="mt-2">
          <p className="m-0 mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--secondary)]" />
            Final validated summary
          </p>
          <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-[var(--fg)]">
            {entry.finalSummary}
          </p>
          {entry.summaryChars != null && (
            <p className="m-0 mt-1.5 text-[11px] tabular-nums text-[var(--subtle)]">
              {entry.summaryChars.toLocaleString("en-US")} chars
            </p>
          )}
        </div>
      )}

      {success && (
        <p className="m-0 mt-2 flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--secondary)]" />
          Sub agent resumed only after validation + context replacement.
        </p>
      )}

      {failed && (
        <div className="mt-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] p-2.5">
          <p className="m-0 flex items-center gap-1.5 text-xs font-medium text-[var(--danger)]">
            <TriangleAlert className="h-3.5 w-3.5" />
            {entry.status === "incomplete" ? "Summary incomplete — original context preserved." : "Summarization failed — original context preserved."}
          </p>
          {entry.error && (
            <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--danger)]">{entry.error}</p>
          )}
          {entry.code && (
            <p className="m-0 mt-1 font-mono text-[11px] text-[var(--danger)]">{entry.code}</p>
          )}
        </div>
      )}
    </div>
  );
}
