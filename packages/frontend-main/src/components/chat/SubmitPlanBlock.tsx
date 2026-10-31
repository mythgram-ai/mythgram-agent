import { useState } from "react";
import { Check, ClipboardList, Loader2, PencilLine, PencilOff, Timer, X } from "lucide-react";
import type { PlanApprovalInfo, ToolActivity } from "@/types";
import { decidePlan } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/primitives";

const STATUS_LABELS: Record<PlanApprovalInfo["status"], string> = {
  pending: "Awaiting your review",
  approved: "Approved — the agent is starting the task",
  canceled: "Canceled — the agent will retry",
  edited: "Approved with your edits — the agent is starting",
  timeout: "No response — the agent continued on its own",
};

const BADGE: Record<PlanApprovalInfo["status"], string> = {
  pending: "text-[var(--warning)] bg-[var(--warning-soft)]",
  approved: "text-[var(--success)] bg-[var(--success-soft)]",
  canceled: "text-[var(--danger)] bg-[var(--danger-soft)]",
  edited: "text-[var(--success)] bg-[var(--success-soft)]",
  timeout: "text-[var(--muted)] bg-[var(--chip)]",
};

function StatusIcon({ status }: { status: PlanApprovalInfo["status"] }) {
  switch (status) {
    case "approved":
    case "edited":
      return <Check className="h-3.5 w-3.5" />;
    case "canceled":
      return <X className="h-3.5 w-3.5" />;
    case "timeout":
      return <Timer className="h-3.5 w-3.5" />;
    default:
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
}

export function SubmitPlanBlock({ tool }: { tool: ToolActivity }) {
  const plan = tool.plan;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  if (!plan) {
    return (
      <div className="flex w-full items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--chip)] p-4 text-sm text-[var(--muted)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--secondary)]" />
        Waiting for the plan…
      </div>
    );
  }

  const decided = plan.status !== "pending";

  const sendDecision = async (decision: "approved" | "canceled" | "edited") => {
    if (saving || (decision === "edited" && draft.trim().length === 0)) return;
    setSaving(true);
    const updated = decision === "edited" ? draft : plan.plan;
    const ok = await decidePlan(plan.chatId, plan.id, decision, updated);
    if (ok) {
      useStore.getState().updatePlanForTool(plan.id, {
        status: decision === "edited" ? "edited" : decision,
        plan: decision === "edited" ? updated : undefined,
      });
      if (decision === "edited") setEditing(false);
    }
    setSaving(false);
  };

  return (
    <div className="w-full overflow-hidden rounded-[var(--radius-xl)] bg-[var(--bg)] fade-in" style={{ boxShadow: "var(--shadow-chip)" }}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--rail)] px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--fg)]">
          <ClipboardList className="h-4 w-4 text-[var(--secondary)]" />
          Implementation plan
        </span>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", BADGE[plan.status])}>
          <StatusIcon status={plan.status} />
          {STATUS_LABELS[plan.status]}
        </span>
      </div>

      <div className="px-4 py-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
          Plan to review
        </div>
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.max(8, Math.min(28, draft.split("\n").length + 2))}
            spellCheck={false}
            className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 font-mono text-xs leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--secondary)]"
            placeholder="Edit the plan…"
          />
        ) : (
          <div className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 font-mono text-xs leading-relaxed text-[var(--fg)]">
            {plan.plan || "(empty plan)"}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-3">
        {decided || saving ? (
          <span className="text-xs text-[var(--muted)]">
            {saving ? "Submitting…" : STATUS_LABELS[plan.status]}
          </span>
        ) : editing ? (
          <>
            <Button onClick={() => sendDecision("edited")} disabled={saving || draft.trim().length === 0}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save &amp; approve
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              <PencilOff className="h-3.5 w-3.5" />
              Discard edits
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => sendDecision("approved")} disabled={saving}>
              <Check className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button variant="danger" onClick={() => sendDecision("canceled")} disabled={saving}>
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(plan.plan);
                setEditing(true);
              }}
              disabled={saving}
            >
              <PencilLine className="h-3.5 w-3.5" />
              Edit
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
