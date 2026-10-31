import { useState } from "react";
import { HelpCircle, Loader2, Send, Timer } from "lucide-react";
import type { AskQuestionInfo, ToolActivity } from "@/types";
import { submitAnswers } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/primitives";

const STATUS_LABELS: Record<AskQuestionInfo["status"], string> = {
  pending: "Awaiting your answers",
  answered: "Answers submitted — the agent is continuing",
  timeout: "No response — the agent continued on its own",
};

const BADGE: Record<AskQuestionInfo["status"], string> = {
  pending: "text-[var(--warning)] bg-[var(--warning-soft)]",
  answered: "text-[var(--success)] bg-[var(--success-soft)]",
  timeout: "text-[var(--muted)] bg-[var(--chip)]",
};

export function AskQuestionBlock({ tool }: { tool: ToolActivity }) {
  const info = tool.ask;
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [usingCustom, setUsingCustom] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);

  if (!info) {
    return (
      <div className="flex w-full items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--chip)] p-4 text-sm text-[var(--muted)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--secondary)]" />
        Waiting for the questions…
      </div>
    );
  }

  const decided = info.status !== "pending";
  const questions = info.questions;
  const answerFor = (i: number) => (usingCustom[i] ? (custom[i] ?? "") : (selected[i] ?? ""));
  const allAnswered = questions.every((_, i) => answerFor(i).trim().length > 0);

  const submit = async () => {
    if (saving || !allAnswered) return;
    setSaving(true);
    const answers = questions.map((q, i) => ({ question: q.question, answer: answerFor(i).trim() }));
    const ok = await submitAnswers(info.chatId, info.id, answers);
    if (ok) useStore.getState().updateQuestionForTool(info.id, { status: "answered" });
    setSaving(false);
  };

  return (
    <div className="w-full overflow-hidden rounded-[var(--radius-xl)] bg-[var(--bg)] fade-in" style={{ boxShadow: "var(--shadow-chip)" }}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--rail)] px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--fg)]">
          <HelpCircle className="h-4 w-4 text-[var(--secondary)]" />
          Questions
        </span>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", BADGE[info.status])}>
          {info.status === "timeout" ? <Timer className="h-3.5 w-3.5" /> : <HelpCircle className="h-3.5 w-3.5" />}
          {STATUS_LABELS[info.status]}
        </span>
      </div>

      <div className="space-y-4 px-4 py-3">
        {questions.map((q, index) => (
          <div key={index} className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--chip)] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
              Question {index + 1} of {questions.length}
            </div>
            <div className="mt-1 text-sm font-medium text-[var(--fg)]">{q.question}</div>
            {q.context && <div className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{q.context}</div>}

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {q.options.map((option, oi) => {
                const active = usingCustom[index] ? false : selected[index] === option;
                return (
                  <button
                    key={oi}
                    type="button"
                    disabled={decided || saving}
                    onClick={() => {
                      setUsingCustom((p) => ({ ...p, [index]: false }));
                      setSelected((p) => ({ ...p, [index]: option }));
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-60",
                      active
                        ? "border-[var(--secondary)] bg-[var(--secondary)] text-[var(--secondary-fg)]"
                        : "border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] enabled:hover:border-[var(--secondary)]",
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={decided || saving}
                onClick={() => setUsingCustom((p) => ({ ...p, [index]: !p[index] }))}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-xs transition-colors disabled:opacity-60",
                  usingCustom[index]
                    ? "border-[var(--secondary)] text-[var(--fg)]"
                    : "border-[var(--border)] text-[var(--muted)] enabled:hover:border-[var(--secondary)] enabled:hover:text-[var(--fg)]",
                )}
              >
                {usingCustom[index] ? "Use a provided option" : "Write a custom answer"}
              </button>

              {usingCustom[index] && (
                <input
                  type="text"
                  value={custom[index] ?? ""}
                  disabled={decided || saving}
                  onChange={(e) => setCustom((p) => ({ ...p, [index]: e.target.value }))}
                  placeholder="Type your answer…"
                  className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--fg)] outline-none placeholder:text-[var(--subtle)] focus:border-[var(--secondary)]"
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-3">
        {decided || saving ? (
          <span className="text-xs text-[var(--muted)]">{saving ? "Submitting…" : STATUS_LABELS[info.status]}</span>
        ) : (
          <Button onClick={submit} disabled={saving || !allAnswered}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send{questions.length > 1 ? ` (${questions.length} questions)` : ""}
          </Button>
        )}
      </div>
    </div>
  );
}
