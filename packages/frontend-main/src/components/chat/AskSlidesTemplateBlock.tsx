import { useState } from "react";
import { Check, LayoutTemplate, Loader2 } from "lucide-react";
import type { ToolActivity } from "@/types";
import { useStore } from "@/store/useStore";
import { submitSlidesTemplateChoice } from "@/lib/slides";
import { cn } from "@/utils/cn";

/**
 * Interactive template picker rendered for ask_user_to_choose_slides_template.
 * Selecting a card posts the template id to the pending backend request, which
 * unblocks the agent immediately.
 */
export function AskSlidesTemplateBlock({ tool }: { tool: ToolActivity }) {
  const choice = tool.slidesChoice;
  const updateChoice = useStore((s) => s.updateSlidesChoiceForTool);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  if (!choice) return null;

  const pending = choice.status === "pending";
  const selected = choice.templates.find((template) => template.id === choice.selectedTemplateId);

  const choose = async (templateId: string) => {
    if (!pending || submittingId) return;
    setSubmittingId(templateId);
    const ok = await submitSlidesTemplateChoice(choice.chatId, choice.id, templateId);
    if (ok) {
      updateChoice(choice.id, { status: "selected", selectedTemplateId: templateId });
    }
    // On failure the backend request was no longer pending; leave the block in its
    // current state so the agent's timeout result can update it.
    setSubmittingId(null);
  };

  return (
    <div className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-4 fade-in">
      <div className="flex items-center gap-2">
        <LayoutTemplate className="h-4 w-4 text-[var(--secondary)]" />
        <span className="text-sm font-semibold text-[var(--fg)]">Choose a slide template</span>
        {pending && (
          <span className="ml-auto text-[11px] text-[var(--muted)]">Waiting up to 2 minutes</span>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
        Pick the design the agent should use for your deck. Every slide renders at a true 16:9 size.
      </p>

      {pending ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {choice.templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => void choose(template.id)}
              disabled={submittingId !== null}
              className={cn(
                "group flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 text-left transition-colors",
                "hover:border-[var(--secondary)] hover:bg-[var(--chip-hover)] disabled:opacity-60",
              )}
            >
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--secondary)] text-[var(--secondary-fg)]">
                {submittingId === template.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LayoutTemplate className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-[var(--fg)]">
                    {template.name}
                  </span>
                  {template.builtin && (
                    <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--muted)]">
                      Built-in
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-[var(--muted)]">
                  {template.description || `${template.slide_count} slides`}
                </span>
                <span className="mt-1 block text-[10px] text-[var(--subtle)]">
                  {template.slide_count} slide{template.slide_count === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--chip)] px-3 py-2 text-xs">
          {choice.status === "selected" ? (
            <>
              <Check className="h-4 w-4 text-[var(--success)]" />
              <span className="text-[var(--fg)]">
                Selected <strong>{selected?.name ?? "a template"}</strong>.
              </span>
            </>
          ) : choice.status === "timeout" ? (
            <span className="text-[var(--muted)]">
              No selection was made in time — the agent will choose a suitable template itself.
            </span>
          ) : (
            <span className="text-[var(--muted)]">
              Template selection is not available in messaging channels — the agent will choose one.
            </span>
          )}
        </div>
      )}
    </div>
  );
}