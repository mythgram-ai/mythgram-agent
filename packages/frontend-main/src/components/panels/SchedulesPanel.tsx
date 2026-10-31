import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  Copy,
  Gauge,
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Bot,
  Boxes,
  Sparkles,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { MAIN_AGENT_ID } from "@/lib/customAgents";
import {
  catalogContextLimit,
  contextPercent,
  formatTokenCompact,
  formatTokenCount,
  resolveContextLimit,
} from "@/lib/contextMeter";
import {
  fetchScheduleRawContext,
  type ScheduleRawContext,
} from "@/lib/rawContext";
import {
  SCHEDULE_KINDS,
  WEEKDAY_LABELS,
  WEEKDAY_LONG,
  createSchedule,
  deleteSchedule,
  duplicateSchedule,
  fetchScheduleRuns,
  fetchSchedules,
  fetchScheduleTimezones,
  formatDateTime,
  formatDuration,
  previewSchedule,
  runScheduleNow,
  scheduleCadence,
  updateSchedule,
  utcToDateTimeInput,
  zonedDateTimeToUtc,
  type Schedule,
  type ScheduleDraft,
  type ScheduleKind,
  type ScheduleRun,
  type ScheduleStatus,
} from "@/lib/schedules";
import { Modal } from "@/components/ui/Modal";
import {
  Button,
  EmptyState,
  Field,
  PanelHeader,
  Select,
  TextInput,
  Toggle,
} from "@/components/ui/primitives";
import { cn } from "@/utils/cn";
import { timeAgo } from "@/utils/format";

const POLL_MS = 5_000;

const STATUS_STYLE: Record<ScheduleStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-emerald-500/15 text-emerald-600" },
  paused: { label: "Paused", cls: "bg-[var(--chip)] text-[var(--muted)]" },
  running: { label: "Running", cls: "bg-blue-500/15 text-blue-500" },
  completed: { label: "Completed", cls: "bg-[var(--success-soft)] text-[var(--success)]" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-500" },
};

const RUN_STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  running: { label: "Running", cls: "bg-blue-500/15 text-blue-500" },
  completed: { label: "Done", cls: "bg-emerald-500/15 text-emerald-600" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-500" },
};

/**
 * Schedules page.
 *
 * Lists every persistent cron task managed by the backend scheduler (the
 * single source of truth — the list is refreshed from the API on open and
 * polled while visible, so a run that starts or finishes in the background
 * appears without a refresh). From here schedules are created, edited,
 * duplicated, paused/resumed, deleted, run manually, and inspected
 * (next/previous run, status, execution history with logs).
 *
 * Executions happen entirely in the backend process — closing this page (or
 * the whole browser) never stops them.
 */
export function SchedulesPanel() {
  const schedules = useStore((s) => s.schedules);
  const setSchedules = useStore((s) => s.setSchedules);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ schedule: Schedule | null } | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await fetchSchedules();
      setSchedules(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [setSchedules]);

  useEffect(() => {
    setLoading(true);
    void reload();
    const timer = setInterval(() => {
      void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const toggle = async (schedule: Schedule) => {
    setBusyId(schedule.id);
    try {
      const updated = await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      setSchedules(schedules.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (schedule: Schedule) => {
    setBusyId(schedule.id);
    setError(null);
    try {
      await runScheduleNow(schedule.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (schedule: Schedule) => {
    setBusyId(schedule.id);
    try {
      const copy = await duplicateSchedule(schedule.id);
      setSchedules([copy, ...schedules]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await deleteSchedule(id);
      setSchedules(schedules.filter((s) => s.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  const activeCount = schedules.filter((s) => s.status === "active" || s.status === "running").length;

  return (
    <div className="mx-auto w-full max-w-3xl panel-in">
      <div className="flex items-end justify-between gap-3">
        <PanelHeader kicker="Runs on its own" title="Schedules" />
        <Button onClick={() => setEditor({ schedule: null })}>
          <Plus className="h-4 w-4" /> New schedule
        </Button>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Automate the agent: describe a task once, pick when it runs, and the backend executes it on
        time — even with this page closed and the computer asleep.{" "}
        {schedules.length > 0 && (
          <span className="font-medium text-[var(--fg)]">
            {activeCount} of {schedules.length} active
          </span>
        )}
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading schedules…
        </div>
      ) : schedules.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-8 w-8" />}>
          No schedules yet. Create one to have the agent work for you on its own — once, or on a
          recurring cadence.
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0">
          {schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              busy={busyId === schedule.id}
              onToggle={() => void toggle(schedule)}
              onRunNow={() => void runNow(schedule)}
              onDuplicate={() => void duplicate(schedule)}
              onEdit={() => setEditor({ schedule })}
              onHistory={() => setHistoryId(schedule.id)}
              onDelete={() => setConfirmId(schedule.id)}
            />
          ))}
        </ul>
      )}

      {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}

      {editor && (
        <ScheduleEditorModal
          initial={editor.schedule}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void reload();
          }}
        />
      )}

      {historyId && (
        <ScheduleHistoryModal scheduleId={historyId} onClose={() => setHistoryId(null)} />
      )}

      <Modal
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        icon={<Trash2 className="h-4 w-4" />}
        title="Delete schedule?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => confirmId && void remove(confirmId)}
              disabled={busyId !== null}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="m-0 p-5 text-sm text-[var(--muted)]">
          The schedule and its execution history are removed permanently. Future runs stop
          immediately.
        </p>
      </Modal>
    </div>
  );
}

function ScheduleCard({
  schedule,
  busy,
  onToggle,
  onRunNow,
  onDuplicate,
  onEdit,
  onHistory,
  onDelete,
}: {
  schedule: Schedule;
  busy: boolean;
  onToggle: () => void;
  onRunNow: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
}) {
  const style = STATUS_STYLE[schedule.status];
  const agentLabel =
    schedule.agentType === "custom" ? "Custom agent" : "Default agent";
  const [contextOpen, setContextOpen] = useState(false);
  return (
    <li>
      <article
        className="flex h-full flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5"
        style={{ boxShadow: "var(--shadow-chip)" }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-serif-display m-0 text-2xl text-[var(--fg)]">{schedule.name}</h3>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  style.cls,
                )}
              >
                {schedule.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                {style.label}
              </span>
            </div>
            <p className="m-0 mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--muted)]">
              {schedule.prompt}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5">
                <CalendarClock className="h-2.5 w-2.5" />
                {scheduleCadence(schedule)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5">
                {schedule.agentType === "custom" ? (
                  <Boxes className="h-2.5 w-2.5" />
                ) : (
                  <Sparkles className="h-2.5 w-2.5" />
                )}
                {agentLabel}
                {schedule.model ? ` · ${schedule.model}` : ""}
              </span>
              {schedule.runCount > 0 && (
                <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5">
                  {schedule.runCount} run{schedule.runCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--subtle)]">
              <span>
                Next:{" "}
                <span className="font-medium text-[var(--muted)]">
                  {schedule.nextRunAt
                    ? `${formatDateTime(schedule.nextRunAt, schedule.timezone)} (${relativeIn(schedule.nextRunAt)})`
                    : "—"}
                </span>
              </span>
              <span>
                Previous:{" "}
                <span className="font-medium text-[var(--muted)]">
                  {schedule.lastRunAt ? timeAgo(schedule.lastRunAt) : "—"}
                </span>
              </span>
              {schedule.lastStatus === "failed" && schedule.lastError && (
                <span className="w-full truncate text-[var(--danger)]">Last error: {schedule.lastError}</span>
              )}
            </div>
          </div>
          <Toggle checked={schedule.enabled} onChange={onToggle} label="Enable schedule" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-3">
          <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={onRunNow} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run now
          </Button>
          <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={onHistory}>
            <History className="h-3.5 w-3.5" /> History
          </Button>
          <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => setContextOpen(true)}>
            <Gauge className="h-3.5 w-3.5" /> Context
          </Button>
          <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={onDuplicate} disabled={busy}>
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </Button>
          <Button
            variant="ghost"
            className="px-2 py-1.5 text-xs text-[var(--subtle)] hover:text-[var(--danger)]"
            onClick={onDelete}
            disabled={busy}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </article>
      {contextOpen && <ScheduleContextModal schedule={schedule} onClose={() => setContextOpen(false)} />}
    </li>
  );
}

/** "in 3h" / "tomorrow" style label for a future timestamp. */
function relativeIn(utcMs: number): string {
  const diff = utcMs - Date.now();
  if (diff <= 0) return "due now";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "in seconds";
  if (min < 60) return `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr}h`;
  const days = Math.round(hr / 24);
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days}d`;
  return `in ${Math.round(days / 7)}w`;
}

/* ------------------------------------------------------------------ editor */

interface EditorDraft {
  name: string;
  prompt: string;
  kind: ScheduleKind;
  date: string;
  time: string;
  everyValue: string;
  everyUnit: "minutes" | "hours" | "days";
  dailyTime: string;
  weekdays: number[];
  dayOfMonth: string;
  cron: string;
  timezone: string;
  startDate: string;
  endDate: string;
  enabled: boolean;
  agentType: "default" | "custom";
  customAgentId: string | null;
}

function browserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    // fall through to UTC
  }
  return "UTC";
}

function draftFromSchedule(schedule: Schedule | null): EditorDraft {
  if (!schedule) {
    const now = new Date(Date.now() + 3_600_000);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return {
      name: "",
      prompt: "",
      kind: "once",
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      everyValue: "30",
      everyUnit: "minutes",
      dailyTime: "09:00",
      weekdays: [1, 2, 3, 4, 5],
      dayOfMonth: "1",
      cron: "0 9 * * 1-5",
      timezone: browserTimezone(),
      startDate: "",
      endDate: "",
      enabled: true,
      agentType: "default",
      customAgentId: null,
    };
  }
  const once = schedule.runAt ? utcToDateTimeInput(schedule.runAt, schedule.timezone) : { date: "", time: "" };
  return {
    name: schedule.name,
    prompt: schedule.prompt,
    kind: schedule.kind,
    date: once.date,
    time: once.time || schedule.time || "09:00",
    everyValue: String(schedule.intervalMinutes ?? 30),
    everyUnit: "minutes",
    dailyTime: schedule.time ?? "09:00",
    weekdays: schedule.weekdays.length > 0 ? [...schedule.weekdays] : [1, 2, 3, 4, 5],
    dayOfMonth: String(schedule.dayOfMonth ?? 1),
    cron: schedule.cron || "0 9 * * 1-5",
    timezone: schedule.timezone,
    startDate: schedule.startAt ? utcToDateTimeInput(schedule.startAt, schedule.timezone).date : "",
    endDate: schedule.endAt ? utcToDateTimeInput(schedule.endAt, schedule.timezone).date : "",
    enabled: schedule.enabled,
    agentType: schedule.agentType,
    customAgentId: schedule.customAgentId,
  };
}

/**
 * Advanced Schedule Setup — every configuration option for a schedule:
 * name, task prompt (chat-style prompt box), one-time/recurring cadence,
 * date/time/timezone, custom cron, every-X, weekdays, start/end window,
 * enable switch, and the agent that executes it.
 */
function ScheduleEditorModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Schedule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const settings = useStore((s) => s.settings);
  const customAgents = useStore((s) => s.customAgents);
  const activeCustomAgentId = useStore((s) => s.activeCustomAgentId);

  const [draft, setDraft] = useState<EditorDraft>(() => {
    const base = draftFromSchedule(initial);
    // A new schedule inherits the currently active Custom Agent when one is
    // active, so it is immediately available in the Custom Agents section.
    if (!initial && activeCustomAgentId && activeCustomAgentId !== MAIN_AGENT_ID) {
      const active = customAgents.find((a) => a.id === activeCustomAgentId);
      if (active) {
        base.agentType = "custom";
        base.customAgentId = active.id;
      }
    }
    return base;
  });
  const [timezones, setTimezones] = useState<string[]>([draft.timezone]);
  const [preview, setPreview] = useState<number[]>([]);
  const [previewHint, setPreviewHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerSnapshot, setProviderSnapshot] = useState(() =>
    initial ? { provider: initial.provider, model: initial.model } : { provider: settings.provider, model: settings.model },
  );

  const set = (patch: Partial<EditorDraft>): void => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    let cancelled = false;
    fetchScheduleTimezones()
      .then((zones) => {
        if (!cancelled && zones.length > 0) setTimezones(zones);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Live preview of the next fire times (debounced; nothing persisted).
  const previewPayload = useMemo(
    () => buildPayload(draft, providerSnapshot, true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      draft.kind,
      draft.date,
      draft.time,
      draft.everyValue,
      draft.everyUnit,
      draft.dailyTime,
      draft.weekdays.join(","),
      draft.dayOfMonth,
      draft.cron,
      draft.timezone,
      draft.startDate,
      draft.endDate,
    ],
  );
  useEffect(() => {
    if (typeof previewPayload !== "object" || !previewPayload) {
      setPreview([]);
      setPreviewHint(null);
      return;
    }
    const timer = setTimeout(() => {
      previewSchedule(previewPayload, 5)
        .then((result) => {
          setPreview(result.occurrences);
          setPreviewHint(result.description ?? null);
        })
        .catch(() => {
          setPreview([]);
          setPreviewHint(null);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [previewPayload]);

  const save = async (): Promise<void> => {
    const payload = buildPayload(draft, providerSnapshot, false);
    if (typeof payload === "string") {
      setError(payload);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (initial) await updateSchedule(initial.id, payload);
      else await createSchedule(payload);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const selectedCustom = customAgents.find((a) => a.id === draft.customAgentId) ?? null;

  return (
    <Modal
      open
      onClose={onClose}
      icon={<CalendarClock className="h-4 w-4" />}
      title={initial ? "Edit schedule" : "New schedule"}
      size="lg"
      align="top"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {initial ? "Save" : "Create schedule"}
          </Button>
        </>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <Field label="Schedule name">
          <TextInput
            value={draft.name}
            maxLength={100}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e.g. Morning brief"
          />
        </Field>

        <div>
          <div className="mb-1.5 text-xs font-medium text-[var(--muted)]">Task prompt</div>
          <SchedulePromptBox value={draft.prompt} onChange={(prompt) => set({ prompt })} />
          <p className="m-0 mt-1 text-[10px] leading-relaxed text-[var(--subtle)]">
            What the agent should do at each run. Runs in the background through the agent runtime —
            no browser needed.
          </p>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-[var(--muted)]">Cadence</div>
          <div className="grid grid-cols-3 gap-1.5 max-[520px]:grid-cols-2">
            {SCHEDULE_KINDS.map((kind) => {
              const active = draft.kind === kind.id;
              return (
                <button
                  key={kind.id}
                  type="button"
                  onClick={() => set({ kind: kind.id })}
                  aria-pressed={active}
                  className={cn(
                    "rounded-[var(--radius-md)] border p-2.5 text-left transition-colors",
                    active
                      ? "border-[var(--secondary)] bg-[var(--chip)]"
                      : "border-[var(--border)] hover:border-[var(--secondary)]",
                  )}
                >
                  <span className="block text-xs font-medium text-[var(--fg)]">{kind.label}</span>
                  <span className="block text-[10px] text-[var(--subtle)]">{kind.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {draft.kind === "once" && (
          <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
            <Field label="Date">
              <TextInput type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
            </Field>
            <Field label="Time">
              <TextInput type="time" value={draft.time} onChange={(e) => set({ time: e.target.value })} />
            </Field>
          </div>
        )}

        {draft.kind === "interval" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Every">
              <TextInput
                type="number"
                min={1}
                value={draft.everyValue}
                onChange={(e) => set({ everyValue: e.target.value })}
              />
            </Field>
            <Field label="Unit">
              <Select
                value={draft.everyUnit}
                onChange={(e) => set({ everyUnit: e.target.value as EditorDraft["everyUnit"] })}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </Select>
            </Field>
          </div>
        )}

        {(draft.kind === "daily" || draft.kind === "weekly" || draft.kind === "monthly") && (
          <Field label="Time of day">
            <TextInput
              type="time"
              value={draft.dailyTime}
              onChange={(e) => set({ dailyTime: e.target.value })}
            />
          </Field>
        )}

        {draft.kind === "weekly" && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-[var(--muted)]">Weekdays</div>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, day) => {
                const active = draft.weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      set({
                        weekdays: active
                          ? draft.weekdays.filter((d) => d !== day)
                          : [...draft.weekdays, day].sort((a, b) => a - b),
                      })
                    }
                    aria-pressed={active}
                    title={WEEKDAY_LONG[day]}
                    className={cn(
                      "h-9 w-9 rounded-full border text-xs font-medium transition-colors",
                      active
                        ? "border-[var(--secondary)] bg-[var(--secondary)] text-[var(--secondary-fg)]"
                        : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--secondary)] hover:text-[var(--fg)]",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {draft.kind === "monthly" && (
          <Field label="Day of month" hint="1–31 (short months skip missing days)">
            <TextInput
              type="number"
              min={1}
              max={31}
              value={draft.dayOfMonth}
              onChange={(e) => set({ dayOfMonth: e.target.value })}
            />
          </Field>
        )}

        {draft.kind === "cron" && (
          <Field
            label="Cron expression"
            hint="minute hour day-of-month month day-of-week"
          >
            <TextInput
              value={draft.cron}
              onChange={(e) => set({ cron: e.target.value })}
              placeholder="0 9 * * 1-5"
              className="font-mono text-xs"
              spellCheck={false}
            />
            {previewHint && <p className="m-0 mt-1 text-[11px] text-[var(--muted)]">{previewHint}</p>}
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
          <Field label="Timezone">
            <Select value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {timezones.includes(draft.timezone) ? null : (
                <option value={draft.timezone}>{draft.timezone}</option>
              )}
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center gap-2 pt-5 text-xs text-[var(--muted)]">
            <Toggle checked={draft.enabled} onChange={(v) => set({ enabled: v })} />
            Enabled
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
          <Field label="Start date (optional)">
            <TextInput
              type="date"
              value={draft.startDate}
              onChange={(e) => set({ startDate: e.target.value })}
            />
          </Field>
          <Field label="End date (optional)">
            <TextInput
              type="date"
              value={draft.endDate}
              onChange={(e) => set({ endDate: e.target.value })}
            />
          </Field>
        </div>

        {preview.length > 0 && (
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3">
            <p className="m-0 mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
              Next runs
            </p>
            <ul className="m-0 list-none space-y-1 p-0">
              {preview.map((at) => (
                <li key={at} className="text-xs text-[var(--fg)]">
                  {formatDateTime(at, draft.timezone)}
                  <span className="ml-2 text-[var(--subtle)]">· {relativeIn(at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <AgentPicker
          agentType={draft.agentType}
          customAgentId={draft.customAgentId}
          onChange={(agentType, customAgentId) => set({ agentType, customAgentId })}
        />
        {draft.agentType === "custom" && selectedCustom && (
          <p className="m-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 text-xs text-[var(--muted)]">
            Runs as <span className="font-medium text-[var(--fg)]">{selectedCustom.name}</span> with
            its full configuration, system prompt, and {selectedCustom.selectedTools.length} selected
            tool{selectedCustom.selectedTools.length === 1 ? "" : "s"}.
          </p>
        )}

        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 text-xs text-[var(--muted)]">
          Executes as{" "}
          <span className="font-medium text-[var(--fg)]">
            {providerSnapshot.provider || "current provider"} · {providerSnapshot.model || "current model"}
          </span>
          . API keys always come from your current Settings at run time.
          <button
            type="button"
            onClick={() => setProviderSnapshot({ provider: settings.provider, model: settings.model })}
            className="ml-2 font-medium text-[var(--secondary)] hover:underline"
          >
            Use current Settings
          </button>
        </div>

        {error && <p className="m-0 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </Modal>
  );
}

/**
 * Build the wire payload from the editor draft. Returns an error string when
 * the draft is incomplete (rendered inline instead of saving).
 */
function buildPayload(
  draft: EditorDraft,
  providerSnapshot: { provider: string; model: string },
  forPreview: boolean,
): ScheduleDraft | string {
  if (!forPreview) {
    if (!draft.name.trim()) return "A schedule name is required.";
    if (!draft.prompt.trim()) return "A task prompt is required.";
    if (draft.agentType === "custom" && !draft.customAgentId) {
      return "Pick a Custom Agent, or switch back to the Default agent.";
    }
  }
  const payload: ScheduleDraft = {
    name: draft.name.trim() || "(preview)",
    prompt: draft.prompt.trim() || "(preview)",
    kind: draft.kind,
    timezone: draft.timezone,
    enabled: draft.enabled,
    agentType: draft.agentType,
    customAgentId: draft.agentType === "custom" ? draft.customAgentId : null,
    provider: providerSnapshot.provider,
    model: providerSnapshot.model,
  };

  if (draft.kind === "once") {
    const runAt = zonedDateTimeToUtc(draft.date, draft.time, draft.timezone);
    if (runAt === null) return forPreview ? "" : "Pick a valid date and time.";
    if (!forPreview && runAt <= Date.now()) return "The date and time must be in the future.";
    payload.runAt = runAt;
  }
  if (draft.kind === "interval") {
    const value = Math.floor(Number(draft.everyValue));
    if (!Number.isFinite(value) || value < 1) {
      return forPreview ? "" : "Enter an interval of at least 1.";
    }
    payload.everyValue = value;
    payload.everyUnit = draft.everyUnit;
  }
  if (draft.kind === "daily" || draft.kind === "weekly" || draft.kind === "monthly") {
    if (!/^\d{1,2}:\d{2}$/.test(draft.dailyTime.trim())) {
      return forPreview ? "" : "Pick a valid time of day.";
    }
    payload.time = draft.dailyTime.trim();
  }
  if (draft.kind === "weekly") {
    if (draft.weekdays.length === 0) return forPreview ? "" : "Pick at least one weekday.";
    payload.weekdays = [...draft.weekdays];
  }
  if (draft.kind === "monthly") {
    const dom = Math.floor(Number(draft.dayOfMonth));
    if (!Number.isInteger(dom) || dom < 1 || dom > 31) {
      return forPreview ? "" : "Enter a day of month between 1 and 31.";
    }
    payload.dayOfMonth = dom;
  }
  if (draft.kind === "cron") {
    if (!draft.cron.trim()) return forPreview ? "" : "Enter a cron expression.";
    payload.cron = draft.cron.trim();
  }
  let startAt: number | undefined;
  let endAt: number | undefined;
  if (draft.startDate.trim()) {
    const parsed = zonedDateTimeToUtc(draft.startDate.trim(), "00:00", draft.timezone);
    if (parsed === null) return forPreview ? "" : "The start date is invalid.";
    startAt = parsed;
    payload.startAt = parsed;
  }
  if (draft.endDate.trim()) {
    const parsed = zonedDateTimeToUtc(draft.endDate.trim(), "00:00", draft.timezone);
    if (parsed === null) return forPreview ? "" : "The end date is invalid.";
    endAt = parsed;
    payload.endAt = parsed;
  }
  if (startAt !== undefined && endAt !== undefined && endAt <= startAt) {
    return "The end date must be after the start date.";
  }
  return payload;
}

/**
 * The task-prompt box for a schedule — the same textarea component and
 * behavior as the Chat page prompt box (auto-growing, same quiet styling),
 * wired to the schedule draft instead of sending a chat message.
 */
function SchedulePromptBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [value]);

  return (
    <div
      className="rounded-[var(--radius-2xl)] bg-[var(--bg)] p-4 transition-shadow focus-within:[box-shadow:var(--shadow-card-focus)]"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <label htmlFor="schedule-prompt" className="sr-only">
        Task prompt
      </label>
      <textarea
        id="schedule-prompt"
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          const el = e.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
        }}
        rows={3}
        placeholder="Describe the task for the agent…"
        className="block max-h-[200px] min-h-[4.5rem] w-full resize-none border-0 bg-transparent text-base leading-relaxed text-[var(--fg)] outline-none placeholder:text-[var(--subtle)]"
      />
    </div>
  );
}

/**
 * Agent section of the setup UI. The Default agent (built-in Main Agent) is
 * always available; every Custom Agent is listed, with the currently active
 * one badged. Selecting a Custom Agent runs the schedule with that agent's
 * complete configuration through the existing custom-agent runtime.
 */
function AgentPicker({
  agentType,
  customAgentId,
  onChange,
}: {
  agentType: "default" | "custom";
  customAgentId: string | null;
  onChange: (agentType: "default" | "custom", customAgentId: string | null) => void;
}) {
  const customAgents = useStore((s) => s.customAgents);
  const activeCustomAgentId = useStore((s) => s.activeCustomAgentId);

  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-[var(--muted)]">Agent</div>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => onChange("default", null)}
          aria-pressed={agentType === "default"}
          className={cn(
            "flex w-full items-start gap-3 rounded-[var(--radius-lg)] border p-3.5 text-left transition-colors",
            agentType === "default"
              ? "border-[var(--secondary)] bg-[var(--chip)]"
              : "border-[var(--border)] hover:border-[var(--secondary)]",
          )}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-[var(--secondary-fg)]">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-[var(--fg)]">
              Default agent
              <span className="ml-2 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--subtle)]">
                built-in
              </span>
            </span>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              The Main Agent with the full tool set.
            </span>
          </span>
          {agentType === "default" && <Check className="h-4 w-4 shrink-0 text-[var(--secondary)]" />}
        </button>

        <div className="mb-1 flex items-center justify-between pt-1">
          <span className="text-xs font-medium text-[var(--muted)]">
            Custom agents <span className="text-[var(--subtle)]">({customAgents.length})</span>
          </span>
        </div>
        {customAgents.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3 text-center text-xs text-[var(--muted)]">
            No custom agents yet — create one on the Custom agents page to run schedules as it.
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
            {customAgents.map((agent) => {
              const selected = agentType === "custom" && customAgentId === agent.id;
              const isActive = agent.id === activeCustomAgentId;
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    onClick={() => onChange("custom", agent.id)}
                    aria-pressed={selected}
                    className={cn(
                      "flex h-full w-full items-start gap-2.5 rounded-[var(--radius-lg)] border p-3 text-left transition-colors",
                      selected
                        ? "border-[var(--secondary)] bg-[var(--chip)]"
                        : "border-[var(--border)] hover:border-[var(--secondary)]",
                    )}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--chip)] text-[var(--fg)]">
                      <Bot className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-[var(--fg)]">
                        <span className="truncate">{agent.name}</span>
                        {isActive && (
                          <span className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--secondary-fg)]">
                            Active now
                          </span>
                        )}
                      </span>
                      <span className="line-clamp-2 mt-0.5 block text-xs text-[var(--muted)]">
                        {agent.description || "No description."}
                      </span>
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-[var(--secondary)]" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Schedule context popup: limit (provider catalog wins, else the custom
 * user-added manual limit) + latest run usage tokens + raw task prompt/system prompt.
 * Usage is null until a run reports — the raw schedule prompt stays viewable regardless.
 */
function ScheduleContextModal({ schedule, onClose }: { schedule: Schedule; onClose: () => void }) {
  const models = useStore((s) => s.models);
  const modelsLoading = useStore((s) => s.modelsLoading);
  const settings = useStore((s) => s.settings);
  const [data, setData] = useState<ScheduleRawContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchScheduleRawContext(schedule.id)
      .then((ctx) => {
        if (!cancelled) setData(ctx);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schedule.id]);

  return (
    <Modal open onClose={onClose} title={`Context — ${schedule.name}`} size="lg">
      <ScheduleContextBody
        data={data}
        loading={loading}
        error={error}
        copied={copied}
        setCopied={setCopied}
        models={models}
        modelsLoading={modelsLoading}
        settings={settings}
      />
    </Modal>
  );
}

function ScheduleContextBody({
  data,
  loading,
  error,
  copied,
  setCopied,
  models,
  modelsLoading,
  settings,
}: {
  data: ScheduleRawContext | null;
  loading: boolean;
  error: string | null;
  copied: boolean;
  setCopied: (v: boolean) => void;
  models: { provider: string; id: string; context_window?: number | null }[];
  modelsLoading: boolean;
  settings: { provider: string; model: string; manualContextLimits?: Record<string, number> };
}) {
  const { limit, source } = resolveContextLimit(
    models,
    settings.provider,
    settings.model,
    settings.manualContextLimits,
  );
  const catalogLimit = catalogContextLimit(models, settings.provider, settings.model);
  const needsManual =
    settings.model.trim().length > 0 && !modelsLoading && catalogLimit === null;

  const promptTokens = useMemo(() => {
    try {
      const u = data?.usage as Record<string, unknown> | null | undefined;
      const n = typeof u?.prompt_tokens === "number" ? u.prompt_tokens : Number(u?.prompt_tokens);
      return Number.isFinite(n) && (n as number) >= 0 ? Math.floor(n as number) : null;
    } catch {
      return null;
    }
  }, [data]);

  const pct = promptTokens !== null ? contextPercent(promptTokens, limit) : null;
  const rawText = useMemo(() => {
    if (!data) return "";
    try {
      return JSON.stringify(
        {
          scheduleId: data.scheduleId,
          scheduleName: data.scheduleName,
          source: data.source,
          systemPromptSource: data.systemPromptSource,
          systemPrompt: data.systemPrompt,
          messageCount: data.messageCount,
          messages: data.messages,
          usage: data.usage ?? null,
        },
        null,
        2,
      );
    } catch {
      return "{}";
    }
  }, [data]);

  const copy = async () => {
    if (!rawText) return;
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (loading) {
    return <p className="m-0 p-5 text-sm text-[var(--muted)]">Loading this schedule's context…</p>;
  }
  if (error) {
    return <p className="m-0 p-5 text-sm text-[var(--danger)]">{error}</p>;
  }
  if (!data) {
    return <p className="m-0 p-5 text-sm text-[var(--muted)]">No context available.</p>;
  }
  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-[var(--secondary)]" />
        <h3 className="m-0 text-sm font-semibold">Context usage</h3>
      </div>
      {promptTokens !== null ? (
        <>
          <p className="m-0 text-2xl font-semibold tabular-nums">
            {formatTokenCount(promptTokens)} <span className="text-sm font-normal text-[var(--muted)]">tokens</span>
          </p>
          {pct !== null && limit != null ? (
            <>
              <p className="m-0 text-xs tabular-nums text-[var(--muted)]">
                of {formatTokenCount(limit)} ({pct}%){source === "manual" ? " · manual" : ""}
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--chip)]">
                <div
                  className={cn(
                    "h-full rounded-full",
                    pct >= 90 ? "bg-[var(--danger)]" : pct >= 70 ? "bg-[var(--warning)]" : "bg-[var(--secondary)]",
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
            </>
          ) : needsManual ? (
            <p className="m-0 text-xs text-[var(--warning)]">
              No context limit published for this model — enter it in Settings to show a percentage.
            </p>
          ) : (
            <p className="m-0 text-xs text-[var(--subtle)]">
              {formatTokenCompact(promptTokens)} tokens · limit unknown — showing tokens only.
            </p>
          )}
        </>
      ) : (
        <p className="m-0 text-xs leading-relaxed text-[var(--muted)]">
          No usage reported yet — it appears after this schedule's next run. The raw task prompt below
          is still viewable.
        </p>
      )}
      <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 font-mono text-[11px] leading-relaxed">
        {rawText}
      </pre>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => void copy()}>
          {copied ? (
            <>
              <Check className="h-4 w-4" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" /> Copy raw JSON
            </>
          )}
        </Button>
      </div>
      <p className="m-0 text-[11px] text-[var(--subtle)]">
        Raw scheduled inputs (system prompt + task prompt + latest usage), exactly as stored.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ history */

function ScheduleHistoryModal({ scheduleId, onClose }: { scheduleId: string; onClose: () => void }) {
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRuns(await fetchScheduleRuns(scheduleId, 50));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [scheduleId]);

  useEffect(() => {
    setLoading(true);
    void reload();
    const timer = setInterval(() => {
      void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  return (
    <Modal
      open
      onClose={onClose}
      icon={<History className="h-4 w-4" />}
      title="Execution history"
      size="lg"
      align="top"
    >
      <div className="px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
          </div>
        ) : runs.length === 0 ? (
          <p className="m-0 py-8 text-center text-sm text-[var(--muted)]">
            No executions yet — runs appear here with their status and logs.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {runs.map((run) => {
              const style = RUN_STATUS_STYLE[run.status] ?? RUN_STATUS_STYLE.completed;
              const open = openId === run.id;
              const duration =
                run.finishedAt && run.startedAt ? formatDuration(run.finishedAt - run.startedAt) : "—";
              return (
                <li
                  key={run.id}
                  className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]"
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : run.id)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--chip)]"
                  >
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        style.cls,
                      )}
                    >
                      {run.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
                      {style.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">
                      {run.trigger === "manual" ? "Manual run" : "Scheduled run"} ·{" "}
                      {timeAgo(run.startedAt)} · {duration}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--subtle)]">{run.id}</span>
                  </button>
                  {open && (
                    <div className="space-y-2 border-t border-[var(--border)] bg-[var(--chip)] p-3 text-xs fade-in">
                      {run.error && (
                        <p className="m-0 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] px-2.5 py-2 text-[var(--danger)]">
                          {run.error}
                        </p>
                      )}
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
                        Output
                      </div>
                      <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[11px] leading-relaxed text-[var(--fg)]">
                        {run.output || "(no output)"}
                      </pre>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="m-0 mt-2 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </Modal>
  );
}
