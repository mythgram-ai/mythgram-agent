import { useEffect, useMemo, useState } from "react";
import { FileText, Gauge } from "lucide-react";
import { useStore } from "@/store/useStore";
import { cn } from "@/utils/cn";
import {
  catalogContextLimit,
  contextPercent,
  formatTokenCompact,
  formatTokenCount,
  resolveContextLimit,
} from "@/lib/contextMeter";
import { RawContextModal } from "@/components/chat/RawContextModal";
import type { RawContextAgent } from "@/lib/rawContext";
import { findActiveCustomAgent, MAIN_AGENT_ID } from "@/lib/customAgents";
import { activeCeo } from "@/lib/defaultCeo";
import { activeTeam } from "@/lib/defaultTeams";
import type { AgentContextUsage, MainContextUsage } from "@/types";

type RawTarget =
  | { agent: "main" }
  | { agent: "custom"; customAgentId?: string }
  | { agent: "chat" }
  | { agent: "sub_agent"; subSessionId: string }
  | { agent: "team"; teamAgent: string }
  | { agent: "ceo"; ceoAgent: string };

/**
 * Multi-scope context meter: a header button + popup showing the current
 * conversation's context-token usage for every runned agent.
 *
 * Data flow (existing logging pipeline, no polling): each agent loop emits one
 * `context_usage` event per LLM request (prompt_tokens = current context size) onto
 * the SessionEventBuffer → SQLite stream_events → SSE. `streamDispatch` routes each
 * scope into its own store slice; this component subscribes to those slices, so the
 * popup refreshes through the normal agent-update lifecycle (live + replay + reload).
 *
 * Sections (only runned agents appear — never-run agents are hidden by design):
 * - Top-level: main / custom / chat (whichever serves turns now) — same as the old
 *   main-agent meter, plus the custom user-added limit fallback when the provider
 *   publishes no limit.
 * - Sub agents: every runned sub-agent session (tokens + raw view per session).
 * - Team: every runned leader/member (when team mode is active, or past runs exist).
 * - CEO: every runned CEO/leader/member (when CEO mode is active, or past runs exist).
 */
export function ContextMeter() {
  const [open, setOpen] = useState(false);
  const [rawTarget, setRawTarget] = useState<RawTarget | null>(null);
  const currentId = useStore((s) => s.currentId);

  useEffect(() => {
    if (!open || rawTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rawTarget]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Context usage (all agents)"
        aria-label="Context usage (all agents)"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "relative grid h-11 w-11 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]",
        )}
      >
        <Gauge className="h-[18px] w-[18px]" strokeWidth={1.7} />
        <MeterDot />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Context usage (all agents)"
            className="absolute right-0 top-12 z-50 max-h-[70vh] w-80 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] pop-in"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            <ContextMeterBody currentId={currentId} onViewRaw={(t) => setRawTarget(t)} />
          </div>
        </>
      )}

      <RawContextModal
        open={rawTarget !== null}
        onClose={() => setRawTarget(null)}
        sessionId={currentId}
        agent={(rawTarget?.agent ?? "main") as RawContextAgent}
        subSessionId={rawTarget?.agent === "sub_agent" ? rawTarget.subSessionId : undefined}
        teamAgent={rawTarget?.agent === "team" ? rawTarget.teamAgent : undefined}
        ceoAgent={rawTarget?.agent === "ceo" ? rawTarget.ceoAgent : undefined}
        customAgentId={rawTarget?.agent === "custom" ? rawTarget.customAgentId : undefined}
      />
    </div>
  );
}

function useActiveScope(): "main" | "custom" | "chat" | "team" | "ceo" {
  const agentMode = useStore((s) => s.agentMode);
  const activeCustomAgentId = useStore((s) => s.activeCustomAgentId);
  const customAgents = useStore((s) => s.customAgents);
  const settings = useStore((s) => s.settings);
  const ceoAgents = useStore((s) => s.ceoAgents);
  const agentTeams = useStore((s) => s.agentTeams);
  if (agentMode === "chat") return "chat";
  if (
    activeCustomAgentId &&
    activeCustomAgentId !== MAIN_AGENT_ID &&
    findActiveCustomAgent(customAgents as never, activeCustomAgentId)
  ) {
    return "custom";
  }
  if (settings.enableCeoAgents === "yes" && activeCeo(ceoAgents as never)) return "ceo";
  if (settings.enableAgentTeams === "yes" && activeTeam(agentTeams as never)) return "team";
  return "main";
}

/**
 * Small status dot on the button reflecting the worst known utilization across all
 * scopes for this thread. Hidden while no usage is known anywhere.
 */
function MeterDot() {
  const currentId = useStore((s) => s.currentId);
  const main = useStore((s) => (currentId ? s.contextUsage[currentId] : undefined));
  const custom = useStore((s) => (currentId ? s.customContextUsage[currentId] : undefined));
  const chat = useStore((s) => (currentId ? s.chatContextUsage[currentId] : undefined));
  const sub = useStore((s) => (currentId ? s.subAgentUsage[currentId] : undefined));
  const team = useStore((s) => (currentId ? s.teamUsage[currentId] : undefined));
  const ceo = useStore((s) => (currentId ? s.ceoUsage[currentId] : undefined));
  const models = useStore((s) => s.models);
  const settings = useStore((s) => s.settings);

  const usage = useMemo(() => {
    const candidates: (MainContextUsage | AgentContextUsage | undefined)[] = [main, custom, chat];
    for (const entry of Object.values(sub ?? {})) candidates.push(entry);
    for (const entry of Object.values(team ?? {})) candidates.push(entry);
    for (const entry of Object.values(ceo ?? {})) candidates.push(entry);
    let best: MainContextUsage | AgentContextUsage | undefined;
    for (const c of candidates) {
      if (!c) continue;
      if (!best || c.promptTokens > best.promptTokens) best = c;
    }
    return best;
  }, [main, custom, chat, sub, team, ceo]);

  if (!usage || !currentId) return null;
  const { limit } = resolveContextLimit(
    models,
    settings.provider,
    settings.model,
    settings.manualContextLimits,
  );
  const pct = contextPercent(usage.promptTokens, limit);
  if (pct === null) return null;
  const tone =
    pct >= 90
      ? "bg-[var(--danger)]"
      : pct >= 70
        ? "bg-[var(--warning)]"
        : "bg-[var(--secondary)]";
  return (
    <span
      aria-hidden
      title={`${pct}% of context used (worst agent)`}
      className={cn(
        "absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-semibold tabular-nums text-[var(--secondary-fg)]",
        tone,
      )}
    >
      {pct >= 99.5 ? "!" : formatTokenCompact(usage.promptTokens)}
    </span>
  );
}

function ContextMeterBody({
  currentId,
  onViewRaw,
}: {
  currentId: string | null;
  onViewRaw: (t: RawTarget) => void;
}) {
  const scope = useActiveScope();
  const streaming = useStore((s) => s.streaming);
  const models = useStore((s) => s.models);
  const modelsLoading = useStore((s) => s.modelsLoading);
  const settings = useStore((s) => s.settings);
  const activeCustomAgentId = useStore((s) => s.activeCustomAgentId);
  const main = useStore((s) => (currentId ? s.contextUsage[currentId] : undefined));
  const custom = useStore((s) => (currentId ? s.customContextUsage[currentId] : undefined));
  const chat = useStore((s) => (currentId ? s.chatContextUsage[currentId] : undefined));
  const sub = useStore((s) => (currentId ? s.subAgentUsage[currentId] : undefined));
  const team = useStore((s) => (currentId ? s.teamUsage[currentId] : undefined));
  const ceo = useStore((s) => (currentId ? s.ceoUsage[currentId] : undefined));
  const loading = useStore((s) =>
    currentId ? s.conversations.find((c) => c.id === currentId)?.loaded === false : false,
  );

  const manualLimits = settings.manualContextLimits ?? {};
  const catalogLimit = catalogContextLimit(models, settings.provider, settings.model);
  const { limit, source } = resolveContextLimit(
    models,
    settings.provider,
    settings.model,
    manualLimits,
  );
  const modelSelected = settings.model.trim().length > 0;
  const needsManual = modelSelected && !modelsLoading && catalogLimit === null;

  const topUsage: MainContextUsage | AgentContextUsage | undefined =
    scope === "chat" ? chat : scope === "custom" ? custom : scope === "main" ? main : undefined;
  // Team/CEO modes have no single top-level usage — their per-agent sections below carry it.
  const isTeamLike = scope === "team" || scope === "ceo";

  const subEntries = useMemo(() => Object.values(sub ?? {}).sort((a, b) => b.promptTokens - a.promptTokens), [sub]);
  const teamEntries = useMemo(() => Object.values(team ?? {}).sort((a, b) => b.promptTokens - a.promptTokens), [team]);
  const ceoEntries = useMemo(() => Object.values(ceo ?? {}).sort((a, b) => b.promptTokens - a.promptTokens), [ceo]);

  const hasAnything =
    topUsage !== undefined || subEntries.length > 0 || teamEntries.length > 0 || ceoEntries.length > 0;

  if (!currentId) {
    return (
      <div className="px-4 py-4">
        <PopupTitle modelLabel={settings.model} />
        <p className="m-0 mt-2 text-xs leading-relaxed text-[var(--muted)]">
          No thread selected — open a chat thread to inspect context usage.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <PopupTitle modelLabel={topUsage?.model || settings.model || "current model"} />

      {/* Top-level scope (main/custom/chat) — same meter as before, now per scope. */}
      {!isTeamLike && (
        <TopLevelSection
          scope={scope as "main" | "custom" | "chat"}
          usage={topUsage}
          limit={limit}
          source={source}
          loading={loading}
          streaming={streaming}
          needsManual={needsManual}
          modelsLoading={modelsLoading}
          modelSelected={modelSelected}
          onViewRaw={() =>
            onViewRaw(
              scope === "custom"
                ? { agent: "custom", customAgentId: activeCustomAgentId ?? undefined }
                : scope === "chat"
                  ? { agent: "chat" }
                  : { agent: "main" },
            )
          }
        />
      )}
      {isTeamLike && (
        <p className="m-0 mt-2 text-xs leading-relaxed text-[var(--muted)]">
          {scope === "ceo"
            ? "CEO system active — per-agent usage below (CEO, leaders, members)."
            : "Team active — per-agent usage below (leader, members)."}
        </p>
      )}

      {/* Sub agents — runned sessions only (never-run agents never appear). */}
      {subEntries.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--subtle)]">
            Sub agents · {subEntries.length} runned
          </h3>
          <div className="mt-2 flex flex-col gap-2">
            {subEntries.map((entry) => (
              <AgentRow
                key={entry.subSessionId}
                title={entry.subAgentName || "Sub agent"}
                subtitle={`session ${entry.subSessionId}`}
                usage={entry}
                limit={limit}
                source={source}
                needsManual={needsManual}
                onViewRaw={() => onViewRaw({ agent: "sub_agent", subSessionId: entry.subSessionId })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Team agents — runned leader/members only. */}
      {teamEntries.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--subtle)]">
            Team · {teamEntries.length} runned
          </h3>
          <div className="mt-2 flex flex-col gap-2">
            {teamEntries.map((entry) => (
              <AgentRow
                key={entry.agentId}
                title={entry.agentId}
                subtitle={entry.role ? entry.role : "team agent"}
                usage={entry}
                limit={limit}
                source={source}
                needsManual={needsManual}
                onViewRaw={() => onViewRaw({ agent: "team", teamAgent: entry.agentId })}
              />
            ))}
          </div>
        </div>
      )}

      {/* CEO system — runned CEO/leaders/members only. */}
      {ceoEntries.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--subtle)]">
            CEO system · {ceoEntries.length} runned
          </h3>
          <div className="mt-2 flex flex-col gap-2">
            {ceoEntries.map((entry) => (
              <AgentRow
                key={entry.agentId}
                title={entry.agentId}
                subtitle={entry.role ? entry.role : "ceo agent"}
                usage={entry}
                limit={limit}
                source={source}
                needsManual={needsManual}
                onViewRaw={() => onViewRaw({ agent: "ceo", ceoAgent: entry.agentId })}
              />
            ))}
          </div>
        </div>
      )}

      {!hasAnything && (
        <p className="m-0 mt-3 text-[11px] leading-relaxed text-[var(--subtle)]">
          {loading
            ? "Loading context data from this thread's logs…"
            : streaming
              ? "Waiting for the first usage report…"
              : "No context data yet — it appears after the next reply. Sub agents, team and CEO agents appear here once they have run."}
        </p>
      )}

      {needsManual && (
        <p className="m-0 mt-3 text-[11px] leading-relaxed text-[var(--warning)]">
          No context limit published for this model — enter it in Settings (128000, 128k or 2m)
          to unlock percentage tracking. Applies to every agent below.
        </p>
      )}

      <p className="m-0 mt-3 text-[10px] leading-relaxed text-[var(--subtle)]">
        Current context size of each agent's latest request — not a lifetime total. Usage comes
        from request logs; providers that stay silent report nothing rather than an estimate.
      </p>
    </div>
  );
}

function TopLevelSection({
  scope,
  usage,
  limit,
  source,
  loading,
  streaming,
  needsManual,
  modelsLoading,
  modelSelected,
  onViewRaw,
}: {
  scope: "main" | "custom" | "chat";
  usage: MainContextUsage | AgentContextUsage | undefined;
  limit: number | null;
  source: "provider" | "manual" | null;
  loading: boolean;
  streaming: boolean;
  needsManual: boolean;
  modelsLoading: boolean;
  modelSelected: boolean;
  onViewRaw: () => void;
}) {
  const scopeLabel = scope === "custom" ? "Custom agent" : scope === "chat" ? "Chat" : "Main agent";
  if (!usage) {
    return (
      <div>
        <p className="m-0 mt-2 text-xs leading-relaxed text-[var(--muted)]">
          {loading
            ? "Loading context data from this thread's logs…"
            : streaming
              ? `Waiting for the ${scopeLabel.toLowerCase()}'s first usage report…`
              : `No context data yet — it appears after the ${scopeLabel.toLowerCase()}'s next reply.`}
        </p>
        <ViewRawContextButton onViewRaw={onViewRaw} scopeLabel={scopeLabel} />
      </div>
    );
  }
  const pct = contextPercent(usage.promptTokens, limit);
  return (
    <div>
      <p className="m-0 mt-2 text-2xl font-semibold tabular-nums text-[var(--fg)]">
        {formatTokenCount(usage.promptTokens)}{" "}
        <span className="text-sm font-normal text-[var(--muted)]">tokens</span>
      </p>
      {pct !== null && limit != null ? (
        <>
          <p className="m-0 mt-1 text-xs tabular-nums text-[var(--muted)]">
            of {formatTokenCount(limit)} ({pct}%)
            {source === "manual" && (
              <span title="Entered manually — the provider publishes no limit for this model"> · manual</span>
            )}
          </p>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${scopeLabel} context window used`}
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--chip)]"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                pct >= 90 ? "bg-[var(--danger)]" : pct >= 70 ? "bg-[var(--warning)]" : "bg-[var(--secondary)]",
              )}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        </>
      ) : needsManual ? (
        <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--warning)]">
          No context limit published for this model — enter it in Settings to show usage as a percentage.
        </p>
      ) : (
        <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--subtle)]">
          {modelsLoading
            ? "Loading the model's context limit…"
            : !modelSelected
              ? "Pick a model in Settings to show the context limit."
              : "Context limit unknown for this model — showing tokens only."}
        </p>
      )}
      <dl className="m-0 mt-3 flex flex-col gap-1 border-t border-[var(--border)] pt-3 text-xs">
        {usage.completionTokens !== undefined && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-[var(--subtle)]">Completion (last request)</dt>
            <dd className="m-0 tabular-nums text-[var(--muted)]">{formatTokenCount(usage.completionTokens)}</dd>
          </div>
        )}
        {usage.totalTokens !== undefined && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-[var(--subtle)]">Total (last request)</dt>
            <dd className="m-0 tabular-nums text-[var(--muted)]">{formatTokenCount(usage.totalTokens)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[var(--subtle)]">Scope</dt>
          <dd className="m-0 text-[var(--muted)]">{scopeLabel} · this thread</dd>
        </div>
      </dl>
      <ViewRawContextButton onViewRaw={onViewRaw} scopeLabel={scopeLabel} />
    </div>
  );
}

function AgentRow({
  title,
  subtitle,
  usage,
  limit,
  source,
  needsManual,
  onViewRaw,
}: {
  title: string;
  subtitle: string;
  usage: AgentContextUsage;
  limit: number | null;
  source: "provider" | "manual" | null;
  needsManual: boolean;
  onViewRaw: () => void;
}) {
  const pct = contextPercent(usage.promptTokens, limit);
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--fg)]">{title}</span>
        <span className="shrink-0 tabular-nums text-xs text-[var(--muted)]">{formatTokenCompact(usage.promptTokens)}</span>
      </div>
      <div className="mt-0.5 truncate text-[10px] text-[var(--subtle)]">{subtitle}</div>
      {pct !== null && limit != null ? (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--chip)]">
            <div
              className={cn(
                "h-full rounded-full",
                pct >= 90 ? "bg-[var(--danger)]" : pct >= 70 ? "bg-[var(--warning)]" : "bg-[var(--secondary)]",
              )}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-[var(--muted)]">
            {pct}%{source === "manual" ? " · manual" : ""}
          </span>
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-[var(--subtle)]">
          {formatTokenCount(usage.promptTokens)} tokens
          {needsManual ? " · enter the limit in Settings for %" : limit == null ? " · limit unknown" : ""}
        </div>
      )}
      <button
        type="button"
        onClick={onViewRaw}
        title={`View ${title}'s current context in raw format`}
        className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-[var(--radius-md)] bg-[var(--chip)] px-2 py-1.5 text-[11px] font-medium text-[var(--fg)] transition-colors hover:bg-[var(--chip-hover)]"
      >
        <FileText className="h-3 w-3" strokeWidth={1.8} />
        View raw context
      </button>
    </div>
  );
}

function ViewRawContextButton({ onViewRaw, scopeLabel }: { onViewRaw: () => void; scopeLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onViewRaw}
      title={scopeLabel ? `View the ${scopeLabel.toLowerCase()}'s current context in raw format` : "View raw context"}
      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--chip)] px-3 py-2 text-xs font-medium text-[var(--fg)] transition-colors hover:bg-[var(--chip-hover)]"
    >
      <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />
      View raw context
    </button>
  );
}

function PopupTitle({ modelLabel }: { modelLabel: string }) {
  return (
    <div className="flex items-center gap-2">
      <Gauge className="h-4 w-4 shrink-0 text-[var(--secondary)]" strokeWidth={1.8} />
      <h2 className="m-0 truncate text-sm font-semibold text-[var(--fg)]">Context usage</h2>
      {modelLabel.trim().length > 0 && (
        <span className="ml-auto max-w-[10rem] truncate rounded-full bg-[var(--chip)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--muted)]">
          {modelLabel}
        </span>
      )}
    </div>
  );
}
