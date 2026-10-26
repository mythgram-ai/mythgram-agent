import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getNextOccurrences, getNextRun, type RecurrenceInput } from "./nextrun.js";

const UTC = "UTC";

function base(overrides: Partial<RecurrenceInput> = {}): RecurrenceInput {
  return {
    kind: "once",
    cron: "",
    intervalMinutes: null,
    time: null,
    weekdays: [],
    dayOfMonth: null,
    runAt: null,
    startAt: null,
    endAt: null,
    timezone: UTC,
    ...overrides,
  };
}

describe("next-run calculation", () => {
  it("fires a one-time schedule once, then never again", () => {
    const at = Date.UTC(2030, 0, 15, 12, 0);
    assert.equal(getNextRun(base({ kind: "once", runAt: at }), at - 1000), at);
    assert.equal(getNextRun(base({ kind: "once", runAt: at }), at), null);
    assert.equal(getNextRun(base({ kind: "once", runAt: at }), at + 1000), null);
    assert.equal(getNextRun(base({ kind: "once", runAt: null }), at - 1000), null);
  });

  it("steps every-X-minutes from the window start", () => {
    const start = Date.UTC(2030, 0, 1, 0, 0);
    const input = base({ kind: "interval", intervalMinutes: 30, startAt: start });
    assert.equal(getNextRun(input, start - 1), start + 30 * 60_000);
    assert.equal(getNextRun(input, start), start + 30 * 60_000);
    assert.equal(getNextRun(input, start + 30 * 60_000), start + 60 * 60_000);
    assert.equal(getNextRun(input, start + 31 * 60_000), start + 60 * 60_000);
    assert.equal(getNextRun(base({ kind: "interval", intervalMinutes: 0 }), start), null);
  });

  it("finds the next daily wall time (strictly after now)", () => {
    // 2029-06-04 is a Monday.
    const mondayNoon = Date.UTC(2029, 5, 4, 12, 0);
    const input = base({ kind: "daily", time: "09:30" });
    assert.equal(getNextRun(input, mondayNoon), Date.UTC(2029, 5, 5, 9, 30));
    assert.equal(getNextRun(input, Date.UTC(2029, 5, 4, 9, 29)), Date.UTC(2029, 5, 4, 9, 30));
    assert.equal(getNextRun(input, Date.UTC(2029, 5, 4, 9, 30)), Date.UTC(2029, 5, 5, 9, 30));
    assert.equal(getNextRun(base({ kind: "daily", time: "nope" }), mondayNoon), null);
  });

  it("honors the configured timezone", () => {
    // 09:30 in New York (EDT, UTC-4 in June) = 13:30 UTC.
    const input = base({ kind: "daily", time: "09:30", timezone: "America/New_York" });
    assert.equal(getNextRun(input, Date.UTC(2029, 5, 4, 12, 0)), Date.UTC(2029, 5, 4, 13, 30));
    assert.equal(getNextRun(input, Date.UTC(2029, 5, 4, 13, 30)), Date.UTC(2029, 5, 5, 13, 30));
  });

  it("picks specific weekdays", () => {
    // 2029-06-04 is a Monday; schedule runs Mon + Wed at 08:00 UTC.
    const input = base({ kind: "weekly", time: "08:00", weekdays: [1, 3] });
    assert.equal(getNextRun(input, Date.UTC(2029, 5, 4, 7, 0)), Date.UTC(2029, 5, 4, 8, 0));
    assert.equal(getNextRun(input, Date.UTC(2029, 5, 4, 9, 0)), Date.UTC(2029, 5, 6, 8, 0));
    assert.equal(getNextRun(base({ kind: "weekly", time: "08:00", weekdays: [] }), Date.UTC(2029, 5, 4)), null);
  });

  it("runs monthly on the day-of-month, skipping short months", () => {
    const input = base({ kind: "monthly", time: "10:00", dayOfMonth: 31 });
    // January 31 -> March 31 (no Feb 31).
    assert.equal(getNextRun(input, Date.UTC(2029, 0, 30)), Date.UTC(2029, 0, 31, 10, 0));
    assert.equal(getNextRun(input, Date.UTC(2029, 0, 31, 11, 0)), Date.UTC(2029, 2, 31, 10, 0));
    assert.equal(getNextRun(base({ kind: "monthly", time: "10:00", dayOfMonth: 99 }), Date.UTC(2029, 0, 1)), null);
  });

  it("evaluates custom cron expressions in the schedule timezone", () => {
    const input = base({ kind: "cron", cron: "0 9 * * 1-5" });
    // Monday 2029-06-04 08:00 UTC -> same day 09:00 UTC.
    assert.equal(getNextRun(input, Date.UTC(2029, 5, 4, 8, 0)), Date.UTC(2029, 5, 4, 9, 0));
    // Friday after 09:00 -> Monday 09:00.
    assert.equal(getNextRun(input, Date.UTC(2029, 5, 8, 10, 0)), Date.UTC(2029, 5, 11, 9, 0));
    assert.equal(getNextRun(base({ kind: "cron", cron: "bogus" }), Date.UTC(2029, 5, 4)), null);
  });

  it("respects the end of the window", () => {
    const end = Date.UTC(2029, 5, 5, 0, 0);
    const input = base({ kind: "daily", time: "09:30", endAt: end });
    assert.equal(getNextRun(input, Date.UTC(2029, 5, 4, 12, 0)), null);
    // Fire time exactly at the edge still counts.
    const edge = base({ kind: "once", runAt: end, endAt: end });
    assert.equal(getNextRun(edge, end - 1), end);
  });

  it("defers to the window start", () => {
    const start = Date.UTC(2029, 5, 10, 0, 0);
    const input = base({ kind: "daily", time: "09:30", startAt: start });
    assert.equal(getNextRun(input, Date.UTC(2029, 5, 4)), Date.UTC(2029, 5, 10, 9, 30));
  });

  it("lists preview occurrences in increasing order", () => {
    const input = base({ kind: "daily", time: "09:00" });
    const occurrences = getNextOccurrences(input, Date.UTC(2029, 5, 4, 12, 0), 3);
    assert.deepEqual(occurrences, [
      Date.UTC(2029, 5, 5, 9, 0),
      Date.UTC(2029, 5, 6, 9, 0),
      Date.UTC(2029, 5, 7, 9, 0),
    ]);
    // Interval previews stop after the first upcoming fire (later ones need run history).
    const interval = getNextOccurrences(
      base({ kind: "interval", intervalMinutes: 15, startAt: Date.UTC(2029, 5, 4) }),
      Date.UTC(2029, 5, 4),
      5,
    );
    assert.equal(interval.length, 1);
  });
});
