import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeCron, isValidCron, parseCron, cronMatches } from "./cronparse.js";

describe("cron parser", () => {
  it("parses a standard 5-field expression", () => {
    const fields = parseCron("*/15 9-17 * * 1-5");
    assert.equal(fields.minute.size, 4);
    assert.ok(fields.hour.has(9) && fields.hour.has(17));
    assert.ok(fields.dayOfWeek.has(1) && fields.dayOfWeek.has(5));
    assert.equal(fields.raw, "*/15 9-17 * * 1-5");
  });

  it("accepts month and weekday names, and 7 as Sunday", () => {
    const fields = parseCron("0 12 1 JAN,FEB MON");
    assert.ok(fields.month.has(1) && fields.month.has(2));
    assert.ok(fields.dayOfWeek.has(1));
    const sunday = parseCron("0 0 * * 7");
    assert.ok(sunday.dayOfWeek.has(0));
  });

  it("rejects malformed expressions with clear errors", () => {
    assert.throws(() => parseCron(""), /required/);
    assert.throws(() => parseCron("* * * *"), /exactly 5 fields/);
    assert.throws(() => parseCron("61 * * * *"), /out of range/);
    assert.throws(() => parseCron("*/0 * * * *"), /Invalid step/);
    assert.throws(() => parseCron("5-2 * * * *"), /Reversed range/);
    assert.throws(() => parseCron("* * * * FUNDAY"), /Invalid value/);
    assert.equal(isValidCron("0 9 * * *"), true);
    assert.equal(isValidCron("not a cron"), false);
  });

  it("matches minute/hour/month directly", () => {
    const fields = parseCron("30 9 * * *");
    assert.equal(
      cronMatches(fields, { minute: 30, hour: 9, day: 15, month: 6, weekday: 3 }),
      true,
    );
    assert.equal(
      cronMatches(fields, { minute: 31, hour: 9, day: 15, month: 6, weekday: 3 }),
      false,
    );
  });

  it("uses OR semantics when both day fields are restricted", () => {
    const fields = parseCron("0 0 15 * 3");
    // Day-of-month matches.
    assert.equal(cronMatches(fields, { minute: 0, hour: 0, day: 15, month: 6, weekday: 1 }), true);
    // Weekday matches.
    assert.equal(cronMatches(fields, { minute: 0, hour: 0, day: 10, month: 6, weekday: 3 }), true);
    // Neither matches.
    assert.equal(cronMatches(fields, { minute: 0, hour: 0, day: 10, month: 6, weekday: 1 }), false);
  });

  it("constrains on the restricted day field only when the other is a star", () => {
    const domOnly = parseCron("0 0 15 * *");
    assert.equal(cronMatches(domOnly, { minute: 0, hour: 0, day: 15, month: 6, weekday: 3 }), true);
    assert.equal(cronMatches(domOnly, { minute: 0, hour: 0, day: 16, month: 6, weekday: 3 }), false);
    const dowOnly = parseCron("0 0 * * 3");
    assert.equal(cronMatches(dowOnly, { minute: 0, hour: 0, day: 16, month: 6, weekday: 3 }), true);
    assert.equal(cronMatches(dowOnly, { minute: 0, hour: 0, day: 16, month: 6, weekday: 4 }), false);
  });

  it("describes expressions for the setup UI", () => {
    assert.match(describeCron("0 9 * * 1-5"), /09/);
    assert.match(describeCron("*/15 * * * *"), /every 15 minutes/);
    assert.match(describeCron("garbage"), /5 fields/);
  });
});
