import { memo, useState } from "react";
import { ChevronRight, Crown, User, Activity } from "lucide-react";
import type { TeamAgentBlock, TeamAgentSegment, TeamAgentStatus, TeamRunState } from "@/types";
import { cn } from "@/utils/cn";
import { useStore } from "@/store/useStore";
import { ToolChip } from "./ToolChip";

const STATUS_STYLE: Record<TeamAgentStatus, { label: string; cls: string }> = {
  idle: { label: "Idle", cls: "bg-[var(--chip)] text-[var(--muted)]" },
  working: { label: "Working", cls: "bg-blue-500/15 text-blue-500" },
  queued: { label: "Queued", cls: "bg-amber-500/15 text-amber-600" },
  completed: { label: "Done", cls: "bg-emerald-500/15 text-emerald-600" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-500" },
};

function SegmentView({ segment }: { segment: TeamAgentSegment }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const hasReasoning = segment.reasoning.trim().length > 0;
  const hasOutput = segment.output.trim().length > 0;

  return (
    <div className="space-y-2">
      {segment.trigger && (
        <div className="text-[11px] italic text-[var(--muted)]">↳ {segment.trigger}</div>
      )}
      {hasReasoning && (
        <div className="overflow-hidden rounded-[var(--radius-md)] bg-[var(--chip)]">
          <button
            onClick={() => setShowReasoning((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showReasoning && "rotate-90")} />
            Reasoning
          </button>
          {showReasoning && (
            <div className="whitespace-pre-wrap px-3 pb-2.5 text-xs leading-relaxed text-[var(--muted)]">
              {segment.reasoning}
            </div>
          )}
        </div>
      )}
      {segment.tools.length > 0 && (
        <div className="flex flex-col items-start gap-1.5">
          {segment.tools.map((tool) => (
            <ToolChip key={tool.id} tool={tool} />
          ))}
        </div>
      )}
      {hasOutput && (
        <div className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-[var(--fg)]">
          {segment.output}
        </div>
      )}
    </div>
  );
}

function AgentBlockView({ block }: { block: TeamAgentBlock }) {
  const isLeader = block.role === "leader";
  const status = STATUS_STYLE[block.status] ?? STATUS_STYLE.idle;

  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border p-3",
        isLeader
          ? "border-[color:color-mix(in_oklab,var(--secondary)_45%,var(--border))] bg-[color:color-mix(in_oklab,var(--secondary)_10%,transparent)]"
          : "border-[var(--border)] bg-[var(--card)]",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            "grid h-6 w-6 place-items-center rounded-full",
            isLeader ? "bg-[var(--secondary)] text-[var(--secondary-fg)]" : "bg-[var(--chip)] text-[var(--muted)]",
          )}
        >
          {isLeader ? <Crown className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
        </span>
        <span className="text-sm font-semibold text-[var(--fg)]">{block.name}</span>
        <span className="rounded-full bg-[var(--chip)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          {isLeader ? "Leader" : "Member"}
        </span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium", status.cls)}>
          {status.label}
          {block.queued > 0 ? ` · ${block.queued} queued` : ""}
        </span>
      </div>

      {block.description && block.segments.length === 0 && (
        <div className="text-xs text-[var(--muted)]">{block.description}</div>
      )}

      <div className="space-y-3">
        {block.segments.map((segment) => (
          <SegmentView key={segment.id} segment={segment} />
        ))}
      </div>
    </div>
  );
}

function TeamRunViewImpl({ team }: { team: TeamRunState }) {
  const setTeamMonitorOpen = useStore((s) => s.setTeamMonitorOpen);
  const orderedIds = team.order.length > 0 ? team.order : Object.keys(team.agents);
  const blocks = orderedIds.map((id) => team.agents[id]).filter(Boolean) as TeamAgentBlock[];
  const activeCount = blocks.filter((b) => b.status === "working").length;
  const queuedTotal = blocks.reduce((sum, b) => sum + b.queued, 0);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <span className="font-medium text-[var(--fg)]">Team: {team.teamName}</span>
        <span>·</span>
        <span>{blocks.length} agents</span>
        {activeCount > 0 && (
          <>
            <span>·</span>
            <span className="text-blue-500">{activeCount} working</span>
          </>
        )}
        <button
          type="button"
          onClick={() => setTeamMonitorOpen(true)}
          className="ml-auto flex items-center gap-1 rounded-full bg-[var(--chip)] px-2 py-1 font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          title="Open the team monitor"
        >
          <Activity className="h-3.5 w-3.5" />
          Monitor{team.monitor.length > 0 ? ` (${team.monitor.length})` : ""}
          {queuedTotal > 0 ? ` · ${queuedTotal} queued` : ""}
        </button>
      </div>

      {blocks.map((block) => (
        <AgentBlockView key={block.id} block={block} />
      ))}
    </div>
  );
}

export const TeamRunView = memo(TeamRunViewImpl);
