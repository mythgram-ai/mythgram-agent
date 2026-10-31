import { useMemo } from "react";
import { Activity, ArrowRight, Crown, User } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Modal } from "@/components/ui/Modal";
import type { TeamAgentStatus, TeamMessageKind, TeamRunState } from "@/types";
import { cn } from "@/utils/cn";

const STATUS_CLS: Record<TeamAgentStatus, string> = {
  idle: "bg-[var(--chip)] text-[var(--muted)]",
  working: "bg-blue-500/15 text-blue-500",
  queued: "bg-amber-500/15 text-amber-600",
  completed: "bg-emerald-500/15 text-emerald-600",
  failed: "bg-red-500/15 text-red-500",
};

const KIND_LABEL: Record<TeamMessageKind, string> = {
  user: "user",
  delegate: "task",
  message: "message",
  to_leader: "report",
};

/** Find the newest team run in the current conversation (the one the user is watching). */
function useCurrentTeamRun(): TeamRunState | null {
  const currentId = useStore((s) => s.currentId);
  const conversations = useStore((s) => s.conversations);
  return useMemo(() => {
    const conv = conversations.find((c) => c.id === currentId);
    if (!conv) return null;
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const team = conv.messages[i]?.team;
      if (team) return team;
    }
    return null;
  }, [conversations, currentId]);
}

export function TeamMonitorPanel() {
  const open = useStore((s) => s.teamMonitorOpen);
  const setOpen = useStore((s) => s.setTeamMonitorOpen);
  const team = useCurrentTeamRun();

  const agents = team
    ? (team.order.length > 0 ? team.order : Object.keys(team.agents))
        .map((id) => team.agents[id])
        .filter(Boolean)
    : [];

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      size="lg"
      align="top"
      icon={<Activity className="h-4 w-4" />}
      title={team ? `Team monitor — ${team.teamName}` : "Team monitor"}
    >
      {!team ? (
        <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">
          No active team run in this conversation.
        </div>
      ) : (
        <div className="space-y-5 px-5 py-4">
          {/* Agent statuses + queue depth */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--subtle)]">Agents</h3>
            <ul className="space-y-1.5">
              {agents.map((a) => (
                <li
                  key={a!.id}
                  className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] px-3 py-2"
                >
                  {a!.role === "leader" ? (
                    <Crown className="h-3.5 w-3.5 text-[var(--secondary)]" />
                  ) : (
                    <User className="h-3.5 w-3.5 text-[var(--muted)]" />
                  )}
                  <span className="text-sm font-medium text-[var(--fg)]">{a!.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-[var(--subtle)]">
                    {a!.role}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {a!.queued > 0 && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                        {a!.queued} queued
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                        STATUS_CLS[a!.status],
                      )}
                    >
                      {a!.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Message log */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--subtle)]">
              Message log
            </h3>
            {team.monitor.filter((e) => e.kind === "message").length === 0 ? (
              <p className="text-xs text-[var(--muted)]">No messages exchanged yet.</p>
            ) : (
              <ul className="flex flex-col-reverse gap-1.5">
                {team.monitor
                  .filter((e) => e.kind === "message")
                  .map((e) => (
                    <li
                      key={e.id}
                      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                        <span className="font-medium text-[var(--fg)]">
                          {e.from === "__user__" ? "user" : e.from}
                        </span>
                        <ArrowRight className="h-3 w-3" />
                        <span className="font-medium text-[var(--fg)]">{e.to}</span>
                        {e.messageKind && (
                          <span className="rounded-full bg-[var(--chip)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                            {KIND_LABEL[e.messageKind]}
                          </span>
                        )}
                      </div>
                      <p className="line-clamp-4 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--fg)]">
                        {e.text}
                      </p>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
