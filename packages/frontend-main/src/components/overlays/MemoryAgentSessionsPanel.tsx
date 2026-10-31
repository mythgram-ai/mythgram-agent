import { useEffect } from "react";
import { History, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useStore } from "@/store/useStore";
import { refreshMemoryAgentRuns } from "@/lib/memoryAgent";
import { StatusPill } from "@/components/overlays/MemoryAgentPanel";
import type { MemoryAgentRunMeta } from "@/types";

/** Auto-refresh cadence while the popup is open (keeps running/queued counters honest). */
const POLL_MS = 3_000;

/**
 * The memory-agent sessions popup: how many background memory-build sessions are queued,
 * running, completed, or failed — plus the recent run list. All data comes from the backend
 * SQLite database; clicking a session opens it in the memory-agent stream popup (finished
 * runs replay from the persisted event log).
 */
export function MemoryAgentSessionsPanel() {
  const open = useStore((s) => s.memoryAgentSessionsOpen);
  const setOpen = useStore((s) => s.setMemoryAgentSessionsOpen);
  const setAgentOpen = useStore((s) => s.setMemoryAgentOpen);
  const setSelectedId = useStore((s) => s.setMemoryAgentSelectedId);
  const runs = useStore((s) => s.memoryAgentRuns);
  const counts = useStore((s) => s.memoryAgentCounts);

  useEffect(() => {
    if (!open) return;
    void refreshMemoryAgentRuns().catch(() => {});
    const timer = setInterval(() => {
      void refreshMemoryAgentRuns().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [open]);

  const openRun = (run: MemoryAgentRunMeta): void => {
    setSelectedId(run.id);
    setOpen(false);
    setAgentOpen(true);
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Memory agent sessions"
      icon={<History className="h-4 w-4" strokeWidth={1.8} />}
      size="lg"
      align="top"
      actions={
        <button
          type="button"
          onClick={() => void refreshMemoryAgentRuns().catch(() => {})}
          title="Refresh"
          className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
        </button>
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="grid grid-cols-4 gap-2 max-[520px]:grid-cols-2">
          <CountTile label="Running" value={counts.running + counts.queued} accent="warning" />
          <CountTile label="Completed" value={counts.completed} accent="success" />
          <CountTile label="Failed" value={counts.failed} accent="danger" />
          <CountTile label="Total" value={counts.total} />
        </div>

        {runs.length === 0 ? (
          <p className="m-0 py-8 text-center text-sm text-[var(--muted)]">
            No sessions yet — the memory agent starts automatically after each completed task.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => openRun(run)}
                className="flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--chip)] px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--chip-hover)]"
              >
                <StatusPill status={run.status} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-xs font-medium">
                    <span className="font-mono">{run.id}</span>
                    {run.model && <span className="text-[var(--muted)]"> · {run.model}</span>}
                  </p>
                  <p className="m-0 truncate text-[11px] text-[var(--muted)]">
                    {run.updatedFiles.length > 0
                      ? `Updated ${run.updatedFiles.join(", ")}`
                      : run.status === "failed" && run.error
                        ? run.error
                        : run.summary || "—"}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-[var(--subtle)]">
                  {relativeTime(run.finishedAt ?? run.startedAt ?? run.queuedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function CountTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "success" | "danger" | "warning";
}) {
  const color =
    accent === "success"
      ? "text-[var(--success)]"
      : accent === "danger"
        ? "text-[var(--danger)]"
        : accent === "warning"
          ? "text-[var(--warning)]"
          : "text-[var(--fg)]";
  return (
    <div className="rounded-[var(--radius-md)] bg-[var(--chip)] px-3.5 py-3">
      <p className={`m-0 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="m-0 text-[11px] text-[var(--muted)]">{label}</p>
    </div>
  );
}

function relativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
