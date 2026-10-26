/**
 * Minimal 5-field cron parser + matcher (minute hour day-of-month month day-of-week).
 *
 * Supported per field: `*`, comma lists, ranges (`1-5`), steps (`*\/15`, `0-30/5`),
 * month names (JAN-DEC) and weekday names (SUN-SAT, with 7 == Sunday).
 * Day-of-month vs day-of-week follow the standard cron OR semantics: when both
 * fields are restricted (not `*`), a minute matches when EITHER matches; when
 * one of them is `*`, only the other constrains the match.
 *
 * Matching/evaluation always happens on wall-clock parts in the schedule's
 * timezone (see `nextrun.ts`), so DST behavior stays intuitive.
 */

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** True when day-of-month was a bare `*` (for OR-semantics). */
  domUnrestricted: boolean;
  /** True when day-of-week was a bare `*` (for OR-semantics). */
  dowUnrestricted: boolean;
  raw: string;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function numOrName(token: string, names: Record<string, number>): number | null {
  const t = token.trim().toLowerCase();
  if (t in names) return names[t]!;
  if (/^\d+$/.test(t)) return Number(t);
  return null;
}

function parseField(
  raw: string,
  min: number,
  max: number,
  names: Record<string, number>,
  fieldName: string,
): Set<number> {
  const out = new Set<number>();
  const chunks = raw.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
  if (chunks.length === 0) {
    throw new Error(`Cron field "${fieldName}" is empty.`);
  }
  for (const chunk of chunks) {
    // Split off an optional /step.
    const slash = chunk.indexOf("/");
    let base = chunk;
    let step = 1;
    if (slash !== -1) {
      base = chunk.slice(0, slash);
      const stepRaw = chunk.slice(slash + 1).trim();
      if (!/^\d+$/.test(stepRaw) || Number(stepRaw) < 1) {
        throw new Error(`Invalid step "${stepRaw}" in cron field "${fieldName}".`);
      }
      step = Number(stepRaw);
    }

    let lo: number;
    let hi: number;
    if (base === "" || base === "*") {
      lo = min;
      hi = max;
    } else if (base.includes("-")) {
      const [aRaw, bRaw] = base.split("-", 2).map((s) => s.trim());
      const a = numOrName(aRaw, names);
      const b = numOrName(bRaw, names);
      if (a === null || b === null) {
        throw new Error(`Invalid range "${base}" in cron field "${fieldName}".`);
      }
      lo = a;
      hi = b;
      if (lo > hi) throw new Error(`Reversed range "${base}" in cron field "${fieldName}".`);
    } else {
      const v = numOrName(base, names);
      if (v === null) throw new Error(`Invalid value "${base}" in cron field "${fieldName}".`);
      lo = v;
      hi = v;
    }

    // Sunday may be written as 7 in day-of-week; normalize to 0.
    const normalize = (v: number): number => (fieldName === "day-of-week" && v === 7 ? 0 : v);
    lo = normalize(lo);
    hi = normalize(hi);

    if (lo < min || hi > max) {
      throw new Error(`Value out of range (${min}-${max}) in cron field "${fieldName}".`);
    }
    for (let v = lo; v <= hi; v += step) out.add(normalize(v));
  }
  if (out.size === 0) throw new Error(`Cron field "${fieldName}" matched nothing.`);
  return out;
}

/** Parse a 5-field cron expression. Throws with a human-readable message when invalid. */
export function parseCron(raw: string): CronFields {
  const expression = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!expression) throw new Error("A cron expression is required (5 fields: minute hour day month weekday).");
  const parts = expression.split(" ");
  if (parts.length !== 5) {
    throw new Error(
      `A cron expression needs exactly 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}.`,
    );
  }
  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = parts as [string, string, string, string, string];
  return {
    minute: parseField(minuteRaw, 0, 59, {}, "minute"),
    hour: parseField(hourRaw, 0, 23, {}, "hour"),
    dayOfMonth: parseField(domRaw, 1, 31, {}, "day-of-month"),
    month: parseField(monthRaw, 1, 12, MONTH_NAMES, "month"),
    dayOfWeek: parseField(dowRaw, 0, 7, DOW_NAMES, "day-of-week"),
    domUnrestricted: domRaw.trim() === "*",
    dowUnrestricted: dowRaw.trim() === "*",
    raw: expression,
  };
}

/** True when the expression parses (used by validation endpoints). */
export function isValidCron(raw: string): boolean {
  try {
    parseCron(raw);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts a cron match is evaluated against. */
export interface CronDateParts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  /** 0-6, Sun-Sat. */
  weekday: number;
}

/** True when wall-clock parts satisfy the parsed expression (standard OR-semantics). */
export function cronMatches(fields: CronFields, parts: CronDateParts): boolean {
  if (!fields.minute.has(parts.minute)) return false;
  if (!fields.hour.has(parts.hour)) return false;
  if (!fields.month.has(parts.month)) return false;
  const domMatch = fields.dayOfMonth.has(parts.day);
  const dowMatch = fields.dayOfWeek.has(parts.weekday);
  if (fields.domUnrestricted && fields.dowUnrestricted) return true;
  if (fields.domUnrestricted) return dowMatch;
  if (fields.dowUnrestricted) return domMatch;
  return domMatch || dowMatch;
}

/** Short human description of an expression (for the setup UI preview). */
export function describeCron(raw: string): string {
  try {
    const fields = parseCron(raw);
    const parts: string[] = [];
    parts.push(summarize(fields.minute, 0, 59, "minute"));
    parts.push(summarize(fields.hour, 0, 23, "hour"));
    if (!(fields.domUnrestricted && fields.dowUnrestricted)) {
      if (!fields.domUnrestricted) parts.push(`on day-of-month ${sortedList(fields.dayOfMonth)}`);
      if (!fields.dowUnrestricted) parts.push(`on ${sortedList(fields.dayOfWeek).split(",").map(dowName).join(", ")}`);
      if (!fields.domUnrestricted && !fields.dowUnrestricted) parts.push("(either day matches)");
    } else {
      parts.push("every day");
    }
    if (!isFullRange(fields.month, 1, 12)) parts.push(`in month ${sortedList(fields.month)}`);
    return `Runs ${parts.join(" ")}.`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function summarize(set: Set<number>, min: number, max: number, unit: string): string {
  if (set.size === max - min + 1) return `every ${unit}`;
  const values = [...set].sort((a, b) => a - b);
  // Even step over the full range, e.g. */15.
  const step = values.length > 1 ? values[1]! - values[0]! : 0;
  const even = step > 0 && values.every((v, i) => v === min + i * step) && values[values.length - 1]! <= max;
  if (even && values[0] === min) return `every ${step} ${unit}s`;
  const label = unit === "minute" ? "at minute" : unit === "hour" ? "at hour" : unit;
  return `${label} ${values.map((v) => String(v).padStart(2, "0")).join(", ")}`;
}

function sortedList(set: Set<number>): string {
  return [...set].sort((a, b) => a - b).join(",");
}

function isFullRange(set: Set<number>, min: number, max: number): boolean {
  return set.size === max - min + 1;
}

const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dowName(n: string): string {
  const v = Number(n);
  return Number.isInteger(v) && v >= 0 && v <= 6 ? DOW_LONG[v]! : n;
}
