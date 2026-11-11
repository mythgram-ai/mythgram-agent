import { useEffect, useState } from "react";
import { ChevronDown, RefreshCw, ShieldCheck } from "lucide-react";
import type { RetryActivity } from "@/types";
import { cn } from "@/utils/cn";

/** Human labels for the agent scope that triggered the retry. */
const SCOPE_LABELS: Record<string, string> = {
  main: "Main agent",
  custom: "Custom agent",
  chat: "Chat",
  team: "Agent team",
  ceo: "CEO agent",
  promptagent: "Prompt agent",
  memoryagent: "Memory agent",
};

function scopeLabel(scope?: string): string {
  if (!scope) return "Provider";
  return SCOPE_LABELS[scope] ?? scope;
}

/** "5s", "45s", "1m", "2m 30s" — compact, human delay labels. */
function formatDelay(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/** Very short label for the ring centre ("12", "2m"). */
function ringLabel(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return String(totalSeconds);
  return `${Math.ceil(totalSeconds / 60)}m`;
}

/**
 * Live countdown (down to zero) while `active`. Starts from the full delay (the
 * component is remounted per attempt via `key`, so this is accurate on arrival)
 * and is corrected by a 200ms interval whose callback — never render — reads the
 * clock. No synchronous setState in an effect, so no cascading-render hazard.
 */
function useCountdown(startedAt: number, delayMs: number, active: boolean): number {
  const [remaining, setRemaining] = useState(() => Math.max(0, delayMs));
  useEffect(() => {
    if (!active) return;
    const compute = (): number => Math.min(delayMs, Math.max(0, delayMs - (Date.now() - startedAt)));
    const id = window.setInterval(() => setRemaining(compute()), 200);
    return () => window.clearInterval(id);
  }, [active, startedAt, delayMs]);
  return remaining;
}

/** Circular countdown with the remaining time in the centre. */
function CountdownRing({ remainingMs, totalMs, tone }: { remainingMs: number; totalMs: number; tone: string }) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const fraction = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  return (
    <div className="relative grid h-10 w-10 place-items-center" aria-hidden>
      <svg width="40" height="40" viewBox="0 0 40 40" className="-rotate-90">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          style={{ transition: "stroke-dashoffset 0.2s linear" }}
        />
      </svg>
      <span className="absolute text-[11px] font-semibold tabular-nums" style={{ color: tone }}>
        {ringLabel(remainingMs)}
      </span>
    </div>
  );
}

/**
 * Dedicated provider-retry block: a professional, in-conversation card that shows
 * a failed LLM request being retried — attempt count, agent scope, a live
 * countdown ring + progress bar, and the underlying error. Once the provider
 * responds again it collapses into a compact "recovered" line (details still
 * available), so the retry history is visible without polluting the answer or
 * the reasoning trace.
 */
export function RetryBlock({ retry, streaming }: { retry: RetryActivity; streaming: boolean }) {
  const waiting = retry.status === "waiting";
  const remaining = useCountdown(retry.startedAt, retry.delayMs, waiting && streaming);
  const [expanded, setExpanded] = useState(false);
  const scope = scopeLabel(retry.scope);
  const retriesLabel = `${retry.total} ${retry.total === 1 ? "retry" : "retries"}`;

  // A waiting block is only meaningful while the turn is live; drop it otherwise
  // (e.g. an aborted turn, or a stale snapshot restored from persistence).
  if (waiting && !streaming) return null;

  if (!waiting) {
    return (
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--success)_30%,transparent)] bg-[var(--success-soft)]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        >
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
          <span className="font-medium text-[var(--success)]">
            Provider request recovered after {retriesLabel}
          </span>
          <span className="hidden text-[var(--muted)] sm:inline">· {scope}</span>
          <ChevronDown
            className={cn(
              "ml-auto h-3.5 w-3.5 shrink-0 text-[var(--muted)] transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
        {expanded && (
          <div className="border-t border-[color:color-mix(in_oklab,var(--success)_18%,transparent)] px-3 py-2">
            <p className="m-0 text-[11px] leading-relaxed text-[var(--muted)]">
              Retried {retriesLabel} from <span className="font-medium">{scope}</span> — the last error was:
            </p>
            <pre className="m-0 mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--bg)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
              {retry.error || "Provider request failed."}
            </pre>
          </div>
        )}
      </div>
    );
  }

  const attemptLabel =
    retry.maxAttempts == null
      ? `Attempt ${retry.attempt} · retrying indefinitely`
      : `Attempt ${retry.attempt} of ${retry.maxAttempts}`;
  const progress = retry.delayMs > 0 ? (remaining / retry.delayMs) * 100 : 0;

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--warning)_38%,transparent)] bg-[var(--warning-soft)]">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color:color-mix(in_oklab,var(--warning)_14%,transparent)] text-[var(--warning)]">
          <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-[var(--fg)]">
            Retrying provider request
            <span className="rounded-full bg-[color:color-mix(in_oklab,var(--warning)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--warning)]">
              {scope}
            </span>
          </p>
          <p className="m-0 mt-0.5 text-xs tabular-nums text-[var(--muted)]">{attemptLabel}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="text-right">
            <p className="m-0 text-[10px] uppercase tracking-wide text-[var(--muted)]">Next retry</p>
            <p className="m-0 text-xs font-semibold tabular-nums text-[var(--fg)]">in {formatDelay(remaining)}</p>
          </div>
          <CountdownRing remainingMs={remaining} totalMs={retry.delayMs} tone="var(--warning)" />
        </div>
      </div>

      <div className="h-1 w-full bg-[color:color-mix(in_oklab,var(--warning)_14%,transparent)]">
        <div
          className="h-full bg-[var(--warning)] transition-[width] duration-200 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
          {expanded ? "Hide error" : "Show error"}
        </button>
        {expanded && (
          <pre className="m-0 mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--bg)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
            {retry.error || "Provider request failed."}
          </pre>
        )}
      </div>
    </div>
  );
}
