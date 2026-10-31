import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";

/**
 * Schedules client — persistent cron tasks owned entirely by the backend.
 *
 * The backend scheduler loads every active schedule at boot and executes due
 * schedules through the existing agent runtime with no browser open, so this
 * client only manages them: list/create/update/delete/duplicate, manual runs,
 * execution history, next-fire previews, and the timezone catalog.
 */

export type ScheduleKind = "once" | "interval" | "daily" | "weekly" | "monthly" | "cron";
export type ScheduleAgentType = "default" | "custom";
export type ScheduleStatus = "active" | "paused" | "running" | "completed" | "failed";
export type ScheduleRunStatus = "running" | "completed" | "failed";
export type ScheduleTrigger = "auto" | "manual";

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  agentType: ScheduleAgentType;
  customAgentId: string | null;
  provider: string;
  model: string;
  kind: ScheduleKind;
  cron: string;
  intervalMinutes: number | null;
  time: string | null;
  weekdays: number[];
  dayOfMonth: number | null;
  runAt: number | null;
  startAt: number | null;
  endAt: number | null;
  timezone: string;
  enabled: boolean;
  running: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastStatus: "completed" | "failed" | null;
  lastError: string | null;
  runCount: number;
  createdAt: number;
  updatedAt: number;
  /** Display status: Active, Paused, Running, Completed, or Failed. */
  status: ScheduleStatus;
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  trigger: ScheduleTrigger;
  status: ScheduleRunStatus;
  output: string;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

/** Draft payload for create/update (partial for updates). */
export type ScheduleDraft = Partial<
  Pick<
    Schedule,
    | "name"
    | "prompt"
    | "agentType"
    | "customAgentId"
    | "provider"
    | "model"
    | "kind"
    | "cron"
    | "intervalMinutes"
    | "time"
    | "weekdays"
    | "dayOfMonth"
    | "runAt"
    | "startAt"
    | "endAt"
    | "timezone"
    | "enabled"
  >
> & {
  /** Every-X value + unit, as an alternative to intervalMinutes. */
  everyValue?: number;
  everyUnit?: "minutes" | "hours" | "days";
};

export async function fetchSchedules(signal?: AbortSignal): Promise<Schedule[]> {
  const data = await requestJson<{ schedules?: Schedule[] }>(
    routeUrl(API_ROUTES.schedulesList),
    undefined,
    signal,
  );
  return Array.isArray(data.schedules) ? data.schedules : [];
}

export async function createSchedule(draft: ScheduleDraft): Promise<Schedule> {
  const data = await requestJson<{ schedule?: Schedule }>(routeUrl(API_ROUTES.schedulesCreate), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!data.schedule) throw new Error("The backend did not return the created schedule.");
  return data.schedule;
}

export async function updateSchedule(id: string, patch: ScheduleDraft): Promise<Schedule> {
  const data = await requestJson<{ schedule?: Schedule }>(
    routeUrl(API_ROUTES.schedulesUpdate, { params: { id } }),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!data.schedule) throw new Error("The backend did not return the updated schedule.");
  return data.schedule;
}

export async function deleteSchedule(id: string): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.schedulesDelete, { params: { id } }), {
    method: "DELETE",
  }).catch(() => {});
}

export async function duplicateSchedule(id: string): Promise<Schedule> {
  const data = await requestJson<{ schedule?: Schedule }>(
    routeUrl(API_ROUTES.schedulesDuplicate, { params: { id } }),
    { method: "POST" },
  );
  if (!data.schedule) throw new Error("The backend did not return the duplicated schedule.");
  return data.schedule;
}

/** Manual "Run now" — returns the execution id. Throws when the schedule cannot run. */
export async function runScheduleNow(id: string): Promise<string> {
  const data = await requestJson<{ run_id?: string }>(
    routeUrl(API_ROUTES.schedulesRun, { params: { id } }),
    { method: "POST" },
  );
  if (!data.run_id) throw new Error("The schedule cannot run right now (already running, or completed).");
  return data.run_id;
}

export async function fetchScheduleRuns(id: string, limit = 50): Promise<ScheduleRun[]> {
  const data = await requestJson<{ runs?: ScheduleRun[] }>(
    routeUrl(API_ROUTES.schedulesRuns, { params: { id }, query: { limit } }),
  );
  return Array.isArray(data.runs) ? data.runs : [];
}

export async function fetchScheduleRun(id: string, runId: string): Promise<ScheduleRun> {
  const data = await requestJson<{ run?: ScheduleRun }>(
    routeUrl(API_ROUTES.schedulesRunGet, { params: { id, runId } }),
  );
  if (!data.run) throw new Error("Run not found.");
  return data.run;
}

export interface SchedulePreview {
  occurrences: number[];
  description?: string;
  cronValid?: boolean;
}

/** Next fire times for a draft payload (nothing persisted). */
export async function previewSchedule(draft: ScheduleDraft, count = 5): Promise<SchedulePreview> {
  const data = await requestJson<{ occurrences?: number[]; description?: string; cronValid?: boolean }>(
    routeUrl(API_ROUTES.schedulesPreview),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, count }),
    },
  );
  return {
    occurrences: Array.isArray(data.occurrences) ? data.occurrences : [],
    description: data.description,
    cronValid: data.cronValid,
  };
}

/** IANA timezones supported for schedule wall-clock math. */
export async function fetchScheduleTimezones(signal?: AbortSignal): Promise<string[]> {
  const data = await requestJson<{ timezones?: string[] }>(
    routeUrl(API_ROUTES.schedulesTimezones),
    undefined,
    signal,
  );
  return Array.isArray(data.timezones) ? data.timezones : ["UTC"];
}

export const SCHEDULE_KINDS: ReadonlyArray<{ id: ScheduleKind; label: string; hint: string }> = [
  { id: "once", label: "One-time", hint: "Run once at a date and time" },
  { id: "interval", label: "Every X", hint: "Every N minutes, hours, or days" },
  { id: "daily", label: "Daily", hint: "Every day at a time" },
  { id: "weekly", label: "Weekly", hint: "On weekdays at a time" },
  { id: "monthly", label: "Monthly", hint: "On a day of month at a time" },
  { id: "cron", label: "Custom cron", hint: "A 5-field cron expression" },
];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Short human summary of a schedule's recurrence (for list rows). */
export function scheduleCadence(schedule: Schedule): string {
  const time = schedule.time ?? "";
  switch (schedule.kind) {
    case "once":
      return schedule.runAt ? `Once · ${formatDateTime(schedule.runAt, schedule.timezone)}` : "One-time";
    case "interval": {
      const minutes = schedule.intervalMinutes ?? 0;
      if (minutes >= 1440 && minutes % 1440 === 0) {
        const days = minutes / 1440;
        return `Every ${days} day${days === 1 ? "" : "s"}`;
      }
      if (minutes >= 60 && minutes % 60 === 0) {
        const hours = minutes / 60;
        return `Every ${hours} hour${hours === 1 ? "" : "s"}`;
      }
      return `Every ${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    case "daily":
      return `Daily · ${time}`;
    case "weekly": {
      const days = schedule.weekdays.map((d) => WEEKDAY_LABELS[d] ?? String(d)).join(", ");
      return `Weekly · ${days || "—"} · ${time}`;
    }
    case "monthly":
      return `Monthly · day ${schedule.dayOfMonth ?? "—"} · ${time}`;
    case "cron":
      return schedule.cron ? `Cron · ${schedule.cron}` : "Custom cron";
    default:
      return schedule.kind;
  }
}

/** "Jun 4, 09:30" in the schedule timezone (date + HH:MM). */
export function formatDateTime(utcMs: number, timezone: string): string {
  try {
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
    }).format(new Date(utcMs));
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(utcMs));
    return `${date}, ${time}`;
  } catch {
    return new Date(utcMs).toLocaleString();
  }
}

/** Compact duration label, e.g. "45s", "3m", "1h 20m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

/** UTC offset (ms) of a timezone at an instant, via Intl. */
function tzOffsetMs(timezone: string, utcMs: number): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const bag: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(utcMs))) {
      if (part.type !== "literal") bag[part.type] = Number(part.value);
    }
    let hour = bag.hour ?? 0;
    let year = bag.year ?? 1970;
    let month = bag.month ?? 1;
    let day = bag.day ?? 1;
    if (hour === 24) {
      hour = 0;
      const rolled = new Date(Date.UTC(year, month - 1, day) + 24 * 3_600_000);
      year = rolled.getUTCFullYear();
      month = rolled.getUTCMonth() + 1;
      day = rolled.getUTCDate();
    }
    const asUtc = Date.UTC(year, month - 1, day, hour, bag.minute ?? 0, bag.second ?? 0);
    return asUtc - utcMs;
  } catch {
    return 0;
  }
}

/**
 * Convert a "YYYY-MM-DD" date + "HH:MM" time in `timezone` to a UTC epoch-ms
 * instant (for one-time runAt / start / end fields).
 */
export function zonedDateTimeToUtc(date: string, time: string, timezone: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i += 1) guess = Date.UTC(year, month - 1, day, hour, minute) - tzOffsetMs(timezone, guess);
  return guess;
}

/** Split a UTC instant into "YYYY-MM-DD" + "HH:MM" form values in `timezone`. */
export function utcToDateTimeInput(utcMs: number, timezone: string): { date: string; time: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(utcMs))
      .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    const hour = parts.hour === "24" ? "00" : (parts.hour ?? "00");
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute ?? "00"}` };
  } catch {
    const d = new Date(utcMs);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  }
}
