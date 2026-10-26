/**
 * Timezone helpers built on the platform `Intl` API (no new dependencies).
 *
 * Schedules store wall-clock intent (a daily "09:30", a one-time date/time) plus
 * an IANA timezone; every stored timestamp is UTC epoch-ms. These helpers convert
 * between the two directions so recurrence math ("next 09:30 in
 * America/New_York") stays correct across DST changes.
 */

/** Wall-clock date/time components (month 1-12, day 1-31, hour 0-23, minute 0-59). */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const PART_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let fmt = PART_FORMATTER_CACHE.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    PART_FORMATTER_CACHE.set(timezone, fmt);
  }
  return fmt;
}

/** True when `timezone` is a usable IANA name on this platform. */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort canonicalization: returns the trimmed name when valid, else "UTC".
 * Never throws — invalid user input degrades to UTC rather than breaking a save.
 */
export function normalizeTimezone(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value && isValidTimezone(value)) return value;
  return "UTC";
}

/**
 * UTC offset (ms, local = UTC + offset) of `timezone` at the given UTC instant.
 * Implemented by round-tripping the instant through `Intl` wall-clock parts.
 */
export function tzOffsetMs(timezone: string, utcMs: number): number {
  const parts = formatToParts(timezone, utcMs);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - utcMs;
}

function formatToParts(
  timezone: string,
  utcMs: number,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const fmt = formatter(timezone);
  const bag: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal" && part.type !== "timeZoneName") {
      bag[part.type] = Number(part.value);
    }
  }
  // en-US hour12:false can yield hour "24" at midnight — normalize to 0 of the same day.
  let hour = bag.hour ?? 0;
  const minute = bag.minute ?? 0;
  const second = bag.second ?? 0;
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
  return { year, month, day, hour, minute, second };
}

/** Wall-clock components of a UTC instant in `timezone`. */
export function utcToZoned(utcMs: number, timezone: string): ZonedParts {
  const p = formatToParts(timezone, utcMs);
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute };
}

/** Weekday (0-6, Sun-Sat) of the wall-clock date in `timezone` at a UTC instant. */
export function zonedWeekday(utcMs: number, timezone: string): number {
  const p = utcToZoned(utcMs, timezone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/**
 * Convert wall-clock components in `timezone` to a UTC epoch-ms instant.
 * Refines a naive guess twice against the true zone offset so DST transitions
 * resolve to the correct instant (ambiguous fall-back hours land on the first
 * occurrence; spring-forward gaps shift forward by the gap).
 */
export function zonedToUtc(parts: ZonedParts, timezone: string): number {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  for (let i = 0; i < 2; i += 1) {
    const offset = tzOffsetMs(timezone, guess);
    guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - offset;
  }
  return guess;
}

/** Midnight (00:00 wall time) of a zoned date, as a UTC instant. */
export function zonedMidnightUtc(year: number, month: number, day: number, timezone: string): number {
  return zonedToUtc({ year, month, day, hour: 0, minute: 0 }, timezone);
}

/**
 * Add `days` calendar days to a zoned wall-clock date and return the new
 * wall-clock { year, month, day } (month lengths and DST handled by the
 * platform calendar via a UTC round-trip).
 */
export function addZonedDays(
  year: number,
  month: number,
  day: number,
  days: number,
  timezone: string,
): { year: number; month: number; day: number } {
  const midnight = zonedMidnightUtc(year, month, day, timezone);
  const shifted = midnight + days * 24 * 3_600_000;
  // Noon anchor avoids landing inside a spring-forward gap when converting back.
  const p = utcToZoned(shifted + 12 * 3_600_000, timezone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Curated fallback list when `Intl.supportedValuesOf("timeZone")` is unavailable. */
const FALLBACK_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  "Atlantic/Azores",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Europe/Zurich",
  "Europe/Stockholm",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/** Every IANA timezone this platform supports (curated fallback when unsupported). */
export function listTimezones(): string[] {
  try {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supported === "function") {
      const zones = supported.call(Intl, "timeZone");
      if (Array.isArray(zones) && zones.length > 0) return [...zones].sort();
    }
  } catch {
    // fall through to the curated list
  }
  return [...FALLBACK_TIMEZONES];
}
