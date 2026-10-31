import { useEffect, useMemo, useState } from "react";
import { Brain, Check, ChevronDown, History, Loader2, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useStore } from "@/store/useStore";
import { refreshMemoryAgentRuns, watchMemoryAgentRun } from "@/lib/memoryAgent";
import { cn } from "@/utils/cn";
import type { MemoryAgentRunMeta, ToolActivity } from "@/types";

/**
 * The memory-agent popup: a live, real-time view of the background "memoryagent" stream —
 * reasoning, memory tool calls, and the streamed run summary. The agent itself runs entirely
 * in the backend; this popup only watches. Finished runs are replayed from the backend's
 * SQLite event log, so any session in the list can be inspected after the fact.
 */
export function MemoryAgentPanel() {
  const open = useStore((s) => s.memoryAgentOpen);
  const setOpen = useStore((s) => s.setMemoryAgentOpen);
  const setSessionsOpen = useStore((s) => s.setMemoryAgentSessionsOpen);
  const runs = useStore((s) => s.memoryAgentRuns);
  const selectedId = useStore((s) => s.memoryAgentSelectedId);
  const live = useStore((s) => s.memoryAgentLive);

  const run: MemoryAgentRunMeta | undefined = useMemo(
    () => (selectedId ? runs.find((r) => r.id === selectedId) : runs[0]),
    [runs, selectedId],
  );
  const liveRun = run ? live[run.id] : undefined;

  // On open: refresh the session list, and (re)attach to the shown run's stream. Attaching
  // is idempotent — a finished run replays from the database, a live run streams in real time.
  useEffect(() => {
    if (!open) return;
    void refreshMemoryAgentRuns().catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open || !run) return;
    if (!liveRun) watchMemoryAgentRun(run.id);
  }, [open, run, liveRun]);

  const status = liveRun?.status ?? statusOf(run);
  const streaming = status === "running" || run?.status === "queued";

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Memory agent"
      icon={<Brain className="h-4 w-4" strokeWidth={1.8} />}
      size="lg"
      align="top"
      actions={
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setSessionsOpen(true);
          }}
          title="Memory agent sessions"
          className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]"
        >
          <History className="h-4 w-4" strokeWidth={1.8} />
        </button>
      }
    >
      {!run ? (
        <div className="px-6 py-12 text-center text-sm text-[var(--muted)]">
          No memory-agent sessions yet. The memory agent starts automatically in the background
          every time the main agent finishes a task, and builds your memory files
          (session-memory.md, MEMORY.md, USER.md, SOUL.md).
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
            <StatusPill status={run.status === "queued" && !liveRun ? "queued" : status} />
            <span className="font-mono">{run.id}</span>
            {run.model && (
              <span className="rounded-full bg-[var(--chip)] px-2.5 py-0.5">{run.model}</span>
            )}
            {run.chatSessionId && (
              <span className="rounded-full bg-[var(--chip)] px-2.5 py-0.5">
                chat {run.chatSessionId.slice(0, 8)}…
              </span>
            )}
          </div>

          {liveRun && liveRun.reasoning.length > 0 && (
            <Collapsible label="Reasoning">
              <p className="m-0 whitespace-pre-wrap text-xs leading-relaxed text-[var(--muted)]">
                {liveRun.reasoning}
              </p>
            </Collapsible>
          )}

          {liveRun && liveRun.tools.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="m-0 text-xs font-semibold text-[var(--muted)]">Memory operations</p>
              {liveRun.tools.map((tool) => (
                <ToolRow key={tool.id} tool={tool} />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-xs font-semibold text-[var(--muted)]">Run summary</p>
            <div className="rounded-[var(--radius-md)] bg-[var(--chip)] px-3.5 py-3 text-sm leading-relaxed">
              {liveRun && liveRun.output.length > 0 ? (
                <p className={cn("m-0 whitespace-pre-wrap", streaming && "caret")}>{liveRun.output}</p>
              ) : run.summary ? (
                <p className="m-0 whitespace-pre-wrap">{run.summary}</p>
              ) : (
                <p className={cn("m-0 text-[var(--muted)]", streaming && "shimmer-text")}>
                  {streaming ? "Building memory…" : "No summary produced."}
                </p>
              )}
            </div>
          </div>

          {(liveRun?.error || run.error) && status === "failed" && (
            <p className="m-0 rounded-[var(--radius-md)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-xs text-[var(--danger)]">
              {liveRun?.error || run.error}
            </p>
          )}

          {(liveRun?.updatedFiles.length || run.updatedFiles.length) > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-[var(--muted)]">Updated:</span>
              {(liveRun?.updatedFiles.length ? liveRun.updatedFiles : run.updatedFiles).map((path) => (
                <span
                  key={path}
                  className="rounded-full bg-[var(--success-soft)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--success)]"
                >
                  {path}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function statusOf(run: MemoryAgentRunMeta | undefined): "running" | "completed" | "failed" {
  if (!run) return "completed";
  if (run.status === "completed") return "completed";
  if (run.status === "failed") return "failed";
  return "running";
}

export function StatusPill({ status }: { status: "queued" | "running" | "completed" | "failed" }) {
  const styles: Record<string, string> = {
    queued: "bg-[var(--chip)] text-[var(--muted)]",
    running: "bg-[var(--warning-soft)] text-[var(--warning)]",
    completed: "bg-[var(--success-soft)] text-[var(--success)]",
    failed: "bg-[var(--danger-soft)] text-[var(--danger)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        styles[status],
      )}
    >
      {status === "running" && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />}
      {status === "completed" && <Check className="h-3 w-3" strokeWidth={2.2} />}
      {status === "failed" && <X className="h-3 w-3" strokeWidth={2.2} />}
      {status}
    </span>
  );
}

function ToolRow({ tool }: { tool: ToolActivity }) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--chip)] px-3 py-1.5 text-xs">
      {tool.status === "running" ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--muted)]" strokeWidth={2} />
      ) : tool.status === "ok" ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" strokeWidth={2.2} />
      ) : (
        <X className="h-3.5 w-3.5 shrink-0 text-[var(--danger)]" strokeWidth={2.2} />
      )}
      <span className="truncate font-medium">{tool.label || tool.name}</span>
      <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--subtle)]">{tool.name}</span>
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
      >
        {label}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
          strokeWidth={2}
        />
      </button>
      {expanded && (
        <div className="max-h-56 overflow-y-auto rounded-[var(--radius-md)] bg-[var(--chip)] px-3.5 py-3">
          {children}
        </div>
      )}
    </div>
  );
}
