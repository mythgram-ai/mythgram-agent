import { useEffect, useRef, useState } from "react";
import { Ban, ClipboardList, Loader2, Send, Timer } from "lucide-react";
import type { AskSomethingInfo, ToolActivity } from "@/types";
import { rejectAsk, submitAskValues } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/primitives";

/** How long the form waits for the user before the backend times out (mirrors the tool default). */
const TIMEOUT_SECONDS = 120;

const STATUS_LABELS: Record<AskSomethingInfo["status"], string> = {
  pending: "Awaiting your input",
  submitted: "Provided — the agent is continuing",
  rejected: "Rejected — the agent is continuing",
  timeout: "No response — the agent continued on its own",
};

const BADGE: Record<AskSomethingInfo["status"], string> = {
  pending: "text-[var(--warning)] bg-[var(--warning-soft)]",
  submitted: "text-[var(--success)] bg-[var(--success-soft)]",
  rejected: "text-[var(--muted)] bg-[var(--chip)]",
  timeout: "text-[var(--muted)] bg-[var(--chip)]",
};

export function AskSomethingBlock({ tool }: { tool: ToolActivity }) {
  const info = tool.askInput;
  const [values, setValues] = useState<Record<number, string>>({});
  const [rejected, setRejected] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_SECONDS);
  const timedOutRef = useRef(false);

  const status = info?.status ?? "pending";
  const pending = status === "pending";

  // Local 2-minute countdown that mirrors the backend timeout for immediate feedback.
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const id = setInterval(() => {
      const remaining = TIMEOUT_SECONDS - Math.floor((Date.now() - started) / 1000);
      setSecondsLeft(Math.max(0, remaining));
      if (remaining <= 0 && !timedOutRef.current) {
        timedOutRef.current = true;
        clearInterval(id);
        if (info) {
          useStore.getState().updateAskForTool(info.id, { status: "timeout" });
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [pending, info]);

  if (!info) {
    return (
      <div className="flex w-full items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--chip)] p-4 text-sm text-[var(--muted)]">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--secondary)]" />
        Waiting for the request...
      </div>
    );
  }

  const decided = !pending;
  const items = info.items;

  const valueFor = (i: number) => values[i] ?? "";
  const isRejected = (i: number) => rejected[i] === true;
  // Every non-rejected item must be filled in before Send is allowed.
  const canSubmit =
    items.some((_, i) => isRejected(i) || valueFor(i).trim().length > 0) &&
    items.every((_, i) => isRejected(i) || valueFor(i).trim().length > 0);

  const toggleReject = (i: number) => {
    setRejected((prev) => ({ ...prev, [i]: !prev[i] }));
  };

  const submit = async () => {
    if (saving || decided || !canSubmit) return;
    setSaving(true);
    const payload = items.map((item, i) => ({
      request: item.request,
      value: isRejected(i) ? "" : valueFor(i).trim(),
      rejected: isRejected(i),
    }));
    const ok = await submitAskValues(info.chatId, info.id, payload);
    if (ok) useStore.getState().updateAskForTool(info.id, { status: "submitted" });
    setSaving(false);
  };

  const rejectAll = async () => {
    if (saving || decided) return;
    setSaving(true);
    const ok = await rejectAsk(info.chatId, info.id);
    if (ok) useStore.getState().updateAskForTool(info.id, { status: "rejected" });
    setSaving(false);
  };

  return (
    <div
      className="w-full overflow-hidden rounded-[var(--radius-xl)] bg-[var(--bg)] fade-in"
      style={{ boxShadow: "var(--shadow-chip)" }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--rail)] px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--fg)]">
          <ClipboardList className="h-4 w-4 text-[var(--secondary)]" />
          Information needed
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
            BADGE[status],
          )}
        >
          {pending ? <Timer className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />}
          {STATUS_LABELS[status]}
        </span>
        {pending && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-[var(--subtle)]">
            <Timer className="h-3.5 w-3.5" />
            {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        {items.map((item, index) => {
          const rejectedItem = isRejected(index);
          return (
            <div
              key={index}
              className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--chip)] p-3"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
                Item {index + 1} of {items.length}
              </div>
              <div className="mt-1 text-sm font-medium text-[var(--fg)]">{item.request}</div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={rejectedItem ? "" : valueFor(index)}
                  disabled={decided || saving || rejectedItem}
                  onChange={(e) => setValues((prev) => ({ ...prev, [index]: e.target.value }))}
                  placeholder={rejectedItem ? "Rejected" : item.placeholder || "Type your answer..."}
                  className={cn(
                    "min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--fg)] outline-none placeholder:text-[var(--subtle)] focus:border-[var(--secondary)]",
                    rejectedItem && "line-through opacity-60",
                  )}
                />
                <button
                  type="button"
                  disabled={decided || saving}
                  onClick={() => toggleReject(index)}
                  title={rejectedItem ? "Undo rejection" : "Reject this item"}
                  aria-pressed={rejectedItem}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-60",
                    rejectedItem
                      ? "border-[var(--danger,#dc2626)] text-[var(--fg)]"
                      : "border-[var(--border)] text-[var(--muted)] enabled:hover:border-[var(--secondary)] enabled:hover:text-[var(--fg)]",
                  )}
                >
                  <Ban className="h-3.5 w-3.5" />
                  {rejectedItem ? "Rejected" : "Reject"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-3">
        {decided || saving ? (
          <span className="text-xs text-[var(--muted)]">
            {saving ? "Submitting..." : STATUS_LABELS[status]}
          </span>
        ) : (
          <>
            <Button onClick={submit} disabled={saving || !canSubmit}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send{items.length > 1 ? ` (${items.length} items)` : ""}
            </Button>
            <button
              type="button"
              onClick={rejectAll}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition-colors enabled:hover:border-[var(--secondary)] enabled:hover:text-[var(--fg)] disabled:opacity-60"
            >
              <Ban className="h-3.5 w-3.5" />
              Reject all
            </button>
          </>
        )}
      </div>
    </div>
  );
}
