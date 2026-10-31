/**
 * Next-run calculation for every recurrence kind, evaluated in the schedule's
 * timezone so wall-clock intent ("09:30 in America/New_York") stays correct.
 *
 * `getNextRun` returns the first fire time strictly AFTER `fromMs` (UTC
 * epoch-ms), or null when nothing will ever fire again (one-time in the past,
 * window expired, invalid config). `getNextOccurrences` lists the next N fire
 * times for the setup-UI preview.
 */

import type { ScheduleKind } from "./types.js";
import {
  addZonedDays,
  normalizeTimezone,
  utcToZoned,
  zonedToUtc,
  zonedWeekday,
} from "./timezone.js";
import { parseCron } from "./cronparse.js";

/** The recurrence fields `getNextRun` reads (a ScheduleConfig satisfies this). */
export interface RecurrenceInput {
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
}

/** Parse "HH:MM" wall time. Returns null when malformed. */
export function parseWallTime(raw: string | null): { hour: number; minute: number } | null {
  if (typeof raw !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Next-run search walks at most ~367 days ahead for every recurrence kind. */

/**
 * First fire time strictly after `fromMs` (UTC epoch-ms), or null when the
 * schedule will never fire again. Pure function — no I/O, safe to call on
 * every tick, on save, and from the preview endpoint.
 */
export function getNextRun(input: RecurrenceInput, fromMs: number): number | null {
  const timezone = normalizeTimezone(input.timezone);
  const endAt = typeof input.endAt === "number" && Number.isFinite(input.endAt) ? input.endAt : null;
  // A window that already closed never fires again.
  if (endAt !== null && fromMs >= endAt) return null;

  const startAt = typeof input.startAt === "number" && Number.isFinite(input.startAt) ? input.startAt : null;
  const from = startAt !== null && fromMs < startAt ? startAt : fromMs;

  let next: number | null;
  switch (input.kind) {
    case "once":
      next = nextOnce(input.runAt, from);
      break;
    case "interval":
      next = nextInterval(input.intervalMinutes, startAt, from);
      break;
    case "daily":
      next = nextDaily(input.time, timezone, from);
      break;
    case "weekly":
      next = nextWeekly(input.time, input.weekdays, timezone, from);
      break;
    case "monthly":
      next = nextMonthly(input.time, input.dayOfMonth, timezone, from);
      break;
    case "cron":
      next = nextCron(input.cron, timezone, from);
      break;
    default:
      next = null;
      break;
  }

  if (next === null) return null;
  // Outside (or exactly at the edge of) the window, there is no upcoming fire.
  if (endAt !== null && next > endAt) return null;
  return next;
}

/** Next `count` fire times after `fromMs` (for the setup-UI preview). */
export function getNextOccurrences(
  input: RecurrenceInput,
  fromMs: number,
  count = 5,
): number[] {
  const out: number[] = [];
  let cursor = fromMs;
  const safe = Math.max(1, Math.min(Math.floor(count), 20));
  for (let i = 0; i < safe; i += 1) {
    const next = getNextRun(input, cursor);
    if (next === null) break;
    out.push(next);
    // Step past the found instant so strictly-increasing times are produced.
    // Interval kinds anchor on startAt, so advance the cursor instead of mutating input.
    cursor = next + 1;
    if (input.kind === "interval") break; // intervals after the first need run history, not preview math
  }
  return out;
}

function nextOnce(runAt: number | null, from: number): number | null {
  if (typeof runAt !== "number" || !Number.isFinite(runAt)) return null;
  return runAt > from ? runAt : null;
}

function nextInterval(
  intervalMinutes: number | null,
  startAt: number | null,
  from: number,
): number | null {
  if (typeof intervalMinutes !== "number" || !Number.isFinite(intervalMinutes)) return null;
  const minutes = Math.floor(intervalMinutes);
  if (minutes < 1 || minutes > 525_600) return null; // 1 minute .. 1 year
  const step = minutes * 60_000;
  // Anchor on the window start when set, else on the current time: the first
  // fire is one full interval after the anchor, then every interval.
  const anchor = startAt ?? from;
  if (from < anchor) return anchor + step;
  const elapsed = from - anchor;
  const steps = Math.floor(elapsed / step) + 1;
  return anchor + steps * step;
}

function nextDaily(time: string | null, timezone: string, from: number): number | null {
  const wall = parseWallTime(time);
  if (!wall) return null;
  const zoned = utcToZoned(from, timezone);
  for (let offset = 0; offset <= 367; offset += 1) {
    const date = addZonedDays(zoned.year, zoned.month, zoned.day, offset, timezone);
    const candidate = zonedToUtc(
      { year: date.year, month: date.month, day: date.day, hour: wall.hour, minute: wall.minute },
      timezone,
    );
    if (candidate > from) return candidate;
  }
  return null;
}

function nextWeekly(
  time: string | null,
  weekdays: number[],
  timezone: string,
  from: number,
): number | null {
  const wall = parseWallTime(time);
  if (!wall) return null;
  const days = [...new Set(weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (days.length === 0) return null;
  const wanted = new Set(days);
  const zoned = utcToZoned(from, timezone);
  for (let offset = 0; offset <= 367; offset += 1) {
    const date = addZonedDays(zoned.year, zoned.month, zoned.day, offset, timezone);
    const midnight = zonedToUtc({ year: date.year, month: date.month, day: date.day, hour: 0, minute: 0 }, timezone);
    if (!wanted.has(zonedWeekday(midnight + 12 * 3_600_000, timezone))) continue;
    const candidate = zonedToUtc(
      { year: date.year, month: date.month, day: date.day, hour: wall.hour, minute: wall.minute },
      timezone,
    );
    if (candidate > from) return candidate;
  }
  return null;
}

function nextMonthly(
  time: string | null,
  dayOfMonth: number | null,
  timezone: string,
  from: number,
): number | null {
  const wall = parseWallTime(time);
  if (!wall) return null;
  if (typeof dayOfMonth !== "number" || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return null;
  }
  const zoned = utcToZoned(from, timezone);
  // Walk month by month (up to ~13 months); skip months lacking the day (e.g. Feb 30).
  let year = zoned.year;
  let month = zoned.month;
  for (let i = 0; i < 14; i += 1) {
    const dim = daysInMonth(year, month);
    if (dayOfMonth <= dim) {
      const candidate = zonedToUtc(
        { year, month, day: dayOfMonth, hour: wall.hour, minute: wall.minute },
        timezone,
      );
      if (candidate > from) return candidate;
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextCron(cron: string, timezone: string, from: number): number | null {
  let fields;
  try {
    fields = parseCron(cron);
  } catch {
    return null;
  }
  // Day-granular walk (max ~367 days): for each day that satisfies the
  // month + day constraints, scan that day's hour/minute combinations in
  // order and return the first instant strictly after `from`.
  const start = utcToZoned(from, timezone);
  const minutes = [...fields.minute].sort((a, b) => a - b);
  const hours = [...fields.hour].sort((a, b) => a - b);
  for (let offset = 0; offset <= 367; offset += 1) {
    const date = addZonedDays(start.year, start.month, start.day, offset, timezone);
    if (!fields.month.has(date.month)) continue;
    const midnight = zonedToUtc(
      { year: date.year, month: date.month, day: date.day, hour: 0, minute: 0 },
      timezone,
    );
    const weekday = zonedWeekday(midnight + 12 * 3_600_000, timezone);
    const domMatch = fields.dayOfMonth.has(date.day);
    const dowMatch = fields.dayOfWeek.has(weekday);
    let dayOk: boolean;
    if (fields.domUnrestricted && fields.dowUnrestricted) dayOk = true;
    else if (fields.domUnrestricted) dayOk = dowMatch;
    else if (fields.dowUnrestricted) dayOk = domMatch;
    else dayOk = domMatch || dowMatch;
    if (!dayOk) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = zonedToUtc(
          { year: date.year, month: date.month, day: date.day, hour, minute },
          timezone,
        );
        if (candidate > from) return candidate;
      }
    }
  }
  return null;
}
