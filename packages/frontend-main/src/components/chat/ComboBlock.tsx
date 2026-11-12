import { useState } from "react";
import { ArrowRightLeft, ChevronDown } from "lucide-react";
import type { ComboActivity } from "@/types";
import { cn } from "@/utils/cn";

/** Human labels for the agent scope that triggered the combo switch. */
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
  if (!scope) return "Provider combo";
  return SCOPE_LABELS[scope] ?? scope;
}

/**
 * Dedicated combo block: a professional, in-conversation card shown when the
 * active provider combo advanced to another provider because the previous one
 * threw. It names the combo, the new provider/model, and the error that
 * triggered the switch; the details are collapsible so the answer stays clean.
 */
export function ComboBlock({ combo }: { combo: ComboActivity }) {
  const [expanded, setExpanded] = useState(false);
  const scope = scopeLabel(combo.scope);
  const target = combo.model
    ? `${combo.provider} · ${combo.model}`
    : combo.provider || "next provider";
  const position =
    combo.total > 1 ? `Provider ${combo.index} of ${combo.total}` : "Next provider";
  const name = combo.comboName?.trim();

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
            Switched provider
            {name && (
              <span className="rounded-full bg-[color:color-mix(in_oklab,var(--secondary)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--secondary)]">
                {name}
              </span>
            )}
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
            The previous provider threw an error, so <span className="font-medium">{scope}</span>{" "}
            advanced to the next provider in the combo. A failed provider is skipped for the rest of
            the combo; only the last provider retries. The error was:
          </p>
          <pre className="m-0 mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--bg)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
            {combo.error || "Provider request failed."}
          </pre>
        </div>
      )}
    </div>
  );
}
