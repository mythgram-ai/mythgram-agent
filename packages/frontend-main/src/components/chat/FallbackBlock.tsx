import { useState } from "react";
import { ArrowRightLeft, ChevronDown } from "lucide-react";
import type { FallbackActivity } from "@/types";
import { cn } from "@/utils/cn";

/** Human labels for the agent scope that triggered the fallback. */
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

/**
 * Dedicated fallback block: a professional, in-conversation card shown once every
 * retry of the current provider (or API key) has failed and a fallback target has
 * taken over. It names the new provider/model, the strategy, and the error that
 * triggered the switch; the details are collapsible so the answer stays clean.
 */
export function FallbackBlock({ fallback }: { fallback: FallbackActivity }) {
  const [expanded, setExpanded] = useState(false);
  const scope = scopeLabel(fallback.scope);
  const isApi = fallback.method === "api";
  const strategy = isApi ? "API key" : "provider";
  const target = fallback.model ? `${fallback.provider} · ${fallback.model}` : fallback.provider || "fallback target";
  const position =
    fallback.total > 1 ? `Fallback ${fallback.index} of ${fallback.total}` : "Fallback";

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--secondary)_32%,transparent)] bg-[color:color-mix(in_oklab,var(--secondary)_8%,transparent)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color:color-mix(in_oklab,var(--secondary)_16%,transparent)] text-[var(--secondary)]">
          <ArrowRightLeft className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-[var(--fg)]">
            Switched to fallback {strategy}
            <span className="rounded-full bg-[color:color-mix(in_oklab,var(--secondary)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--secondary)]">
              {position}
            </span>
          </p>
          <p className="m-0 mt-0.5 truncate text-xs text-[var(--muted)]">
            Now using <span className="font-medium text-[var(--fg)]">{target}</span>
            <span className="hidden sm:inline"> · {scope}</span>
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--muted)] transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-[color:color-mix(in_oklab,var(--secondary)_16%,transparent)] px-3 py-2">
          <p className="m-0 text-[11px] leading-relaxed text-[var(--muted)]">
            Every retry of the previous {isApi ? "API key" : "provider"} failed, so{" "}
            <span className="font-medium">{scope}</span> switched to this fallback target. The error was:
          </p>
          <pre className="m-0 mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--bg)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
            {fallback.error || "Provider request failed."}
          </pre>
        </div>
      )}
    </div>
  );
}
