/**
 * Schedule/Cron system — shared shapes.
 *
 * A schedule is a persisted task the backend scheduler (`scheduler.ts`) executes
 * automatically, even with no browser open: at each due time it runs the stored
 * prompt through the EXISTING agent runtime (the default Main Agent, or a
 * user-created Custom Agent with its full configuration).
 *
 * Recurrence kinds:
 *   - "once"     — a single execution at an exact date/time.
 *   - "interval" — every X minutes (hours/days converted to minutes).
 *   - "daily"    — every day at a wall-clock time.
 *   - "weekly"   — on specific weekdays at a wall-clock time.
 *   - "monthly"  — on a day-of-month at a wall-clock time.
 *   - "cron"     — a custom 5-field cron expression.
 *
 * All wall-clock fields (`runAt` input, `time`, `startAt`, `endAt`) are
 * interpreted in the schedule's IANA `timezone`; every stored timestamp is a
 * UTC epoch-ms number.
 */

/** Recurrence kind of a schedule. */
export type ScheduleKind = "once" | "interval" | "daily" | "weekly" | "monthly" | "cron";

/** Which agent executes the scheduled prompt. */
export type ScheduleAgentType = "default" | "custom";

/** Lifecycle status surfaced by the Schedule page. */
export type ScheduleStatus = "active" | "paused" | "running" | "completed" | "failed";

/** How a run was started. */
export type ScheduleTrigger = "auto" | "manual";

/** Terminal state of a finished run. */
export type ScheduleRunStatus = "running" | "completed" | "failed";

/** A persisted schedule (storage + wire shape, camelCase). */
export interface ScheduleConfig {
  id: string;
  name: string;
  /** Task prompt executed by the agent at each run. */
  prompt: string;
  /** Which agent runs the prompt: the built-in Default Agent or a Custom Agent. */
  agentType: ScheduleAgentType;
  /** Custom Agent id when `agentType` is "custom". */
  customAgentId: string | null;
  /** Provider id snapshot (e.g. "openrouter", "local", "custom_…"). */
  provider: string;
  /** Model id snapshot. */
  model: string;
  kind: ScheduleKind;
  /** Custom 5-field cron expression (kind "cron"). */
  cron: string;
  /** Every-X cadence in minutes (kind "interval"). */
  intervalMinutes: number | null;
  /** Wall-clock "HH:MM" (kinds "daily" | "weekly" | "monthly"). */
  time: string | null;
  /** Weekdays 0-6 (Sun-Sat, kind "weekly"). */
  weekdays: number[];
  /** Day of month 1-31 (kind "monthly"). */
  dayOfMonth: number | null;
  /** One-time fire time, UTC epoch ms (kind "once"). */
  runAt: number | null;
  /** Optional window start, UTC epoch ms. */
  startAt: number | null;
  /** Optional window end, UTC epoch ms. */
  endAt: number | null;
  /** IANA timezone for all wall-clock math (e.g. "UTC", "America/New_York"). */
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
}

/** Untrusted over-the-wire shape for creating/updating a schedule. */
export interface ScheduleWire {
  name?: unknown;
  prompt?: unknown;
  agentType?: unknown;
  agent_type?: unknown;
  customAgentId?: unknown;
  custom_agent_id?: unknown;
  provider?: unknown;
  model?: unknown;
  kind?: unknown;
  cron?: unknown;
  intervalMinutes?: unknown;
  interval_minutes?: unknown;
  /** Every-X value + unit, as sent by the setup UI. */
  everyValue?: unknown;
  every_value?: unknown;
  everyUnit?: unknown;
  every_unit?: unknown;
  time?: unknown;
  weekdays?: unknown;
  dayOfMonth?: unknown;
  day_of_month?: unknown;
  runAt?: unknown;
  run_at?: unknown;
  /** One-time date/time form fields. */
  date?: unknown;
  startAt?: unknown;
  start_at?: unknown;
  startDate?: unknown;
  start_date?: unknown;
  endAt?: unknown;
  end_at?: unknown;
  endDate?: unknown;
  end_date?: unknown;
  timezone?: unknown;
  enabled?: unknown;
}

/** One execution attempt of a schedule (history/logs row). */
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

/** A schedule as served by the API (config + computed display status). */
export interface ScheduleView extends ScheduleConfig {
  /** Display status: Active, Paused, Running, Completed, or Failed. */
  status: ScheduleStatus;
}

/** Compute the display status of a schedule from its stored fields. */
export function scheduleStatusOf(schedule: ScheduleConfig): ScheduleStatus {
  if (schedule.running) return "running";
  if (!schedule.enabled) {
    // A disabled one-time schedule that already fired (or expired) reads as Completed.
    if (schedule.kind === "once" && schedule.runCount > 0) return "completed";
    if (schedule.endAt !== null && Date.now() > schedule.endAt) return "completed";
    return "paused";
  }
  if (schedule.lastStatus === "failed") return "failed";
  return "active";
}

/** True when the schedule can never fire again (one-time done or window expired). */
export function isTerminalSchedule(schedule: ScheduleConfig): boolean {
  if (schedule.kind === "once" && schedule.runCount > 0) return true;
  if (schedule.endAt !== null && Date.now() > schedule.endAt) return true;
  return false;
}
