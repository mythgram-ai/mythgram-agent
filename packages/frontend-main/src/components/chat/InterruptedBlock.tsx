import { useState } from "react";
import { CirclePause, Loader2, Play, TriangleAlert } from "lucide-react";
import type { TurnInterruption } from "@/types";

const COPY: Record<TurnInterruption["reason"], { title: string; detail: string }> = {
  user: {
    title: "Stopped before the task finished",
    detail: "You stopped this response. Pick it back up where it left off.",
  },
  system: {
    title: "Interrupted before the task finished",
    detail: "The run ended unexpectedly. Continue to resume from the last completed step.",
  },
};

/**
 * Shown under an assistant turn that stopped early — by the user's Stop or by the
 * system (provider failure, lost run, backend restart). The latest one carries a
 * Continue button that resumes the task in the same conversation.
 */
export function InterruptedBlock({
  interruption,
  onContinue,
}: {
  interruption: TurnInterruption;
  onContinue?: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const isUser = interruption.reason === "user";
  const tone = isUser ? "var(--muted)" : "var(--warning)";
  const Icon = isUser ? CirclePause : TriangleAlert;
  const copy = COPY[interruption.reason];

  // Older interrupted turns keep a compact marker; only the latest one can continue.
  if (!onContinue) {
    return (
      <p className="m-0 inline-flex items-center gap-1.5 text-xs text-[var(--subtle)]">
        <Icon className="h-3.5 w-3.5" style={{ color: tone }} />
        {isUser ? "Stopped" : "Interrupted"}
      </p>
    );
  }

  return (
    <div
      role="status"
      className="fade-in flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2.5"
    >
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
        style={{ color: tone, background: `color-mix(in oklab, ${tone} 14%, transparent)` }}
      >
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm font-medium text-[var(--fg)]">{copy.title}</p>
        <p className="m-0 mt-0.5 text-xs text-[var(--muted)]">{copy.detail}</p>
      </div>
      <button
        type="button"
        disabled={starting}
        onClick={() => {
          setStarting(true);
          onContinue();
        }}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--secondary)] px-4 py-2 text-sm font-medium text-[var(--secondary-fg)] transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-60"
      >
        {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        Continue
      </button>
    </div>
  );
}
