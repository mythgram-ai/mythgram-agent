import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../database/schema.js";
import { SchedulesRepo } from "../database/repositories/schedulesRepo.js";
import { ScheduleRunsRepo } from "../database/repositories/scheduleRunsRepo.js";
import { ScheduleStore } from "./store.js";

function makeStore(): ScheduleStore {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  applySchema(db);
  return new ScheduleStore(new SchedulesRepo(db), new ScheduleRunsRepo(db));
}

const ONCE_FUTURE = Date.UTC(2030, 0, 15, 12, 0);

describe("schedule store lifecycle", () => {
  let store: ScheduleStore;

  before(() => {
    store = makeStore();
  });

  it("creates a one-time schedule with a computed next run", () => {
    const created = store.create(
      { name: "Morning brief", prompt: "Summarize overnight events.", kind: "once", runAt: ONCE_FUTURE },
      ONCE_FUTURE - 3_600_000,
    );
    assert.equal(created.name, "Morning brief");
    assert.equal(created.nextRunAt, ONCE_FUTURE);
    assert.equal(created.enabled, true);
    assert.equal(created.running, false);
    assert.equal(created.runCount, 0);
  });

  it("rejects invalid payloads with clear errors", () => {
    assert.throws(() => store.create({ name: "", prompt: "x", kind: "once", runAt: ONCE_FUTURE }), /name is required/);
    assert.throws(() => store.create({ name: "x", prompt: "", kind: "once", runAt: ONCE_FUTURE }), /task prompt is required/);
    assert.throws(() => store.create({ name: "x", prompt: "y", kind: "nope", runAt: ONCE_FUTURE }), /Unknown schedule kind/);
    assert.throws(() => store.create({ name: "x", prompt: "y", kind: "cron", cron: "bogus" }), /Invalid cron/);
    assert.throws(() => store.create({ name: "x", prompt: "y", kind: "weekly", time: "08:00", weekdays: [] }), /weekday/);
    assert.throws(
      () => store.create({ name: "x", prompt: "y", kind: "interval", intervalMinutes: 0 }),
      /between 1 minute and 1 year/,
    );
    assert.throws(
      () => store.create({ name: "x", prompt: "y", kind: "daily", time: "25:00" }),
      /Invalid time/,
    );
    assert.throws(
      () => store.create({ name: "x", prompt: "y", kind: "once", runAt: ONCE_FUTURE, agentType: "custom" }),
      /Custom Agent must be selected/,
    );
  });

  it("accepts every-X cadences expressed as value + unit", () => {
    const hourly = store.create({ name: "h", prompt: "p", kind: "interval", everyValue: 2, everyUnit: "hours" });
    assert.equal(hourly.intervalMinutes, 120);
    const daily = store.create({ name: "d", prompt: "p", kind: "interval", everyValue: 1, everyUnit: "days" });
    assert.equal(daily.intervalMinutes, 1440);
  });

  it("updates partially and recomputes the next run", () => {
    const created = store.create({ name: "edit me", prompt: "p", kind: "daily", time: "09:00" });
    const updated = store.update(created.id, { name: "edited", time: "10:30" });
    assert.ok(updated);
    assert.equal(updated.name, "edited");
    assert.equal(updated.time, "10:30");
    assert.equal(updated.prompt, "p");
    assert.ok((updated.nextRunAt ?? 0) > Date.now());
    assert.equal(store.update("missing", { name: "x" }), null);
  });

  it("pausing clears the next run; enabling recomputes it", () => {
    const created = store.create({ name: "pausable", prompt: "p", kind: "daily", time: "09:00" });
    assert.ok(created.nextRunAt !== null);
    const paused = store.setEnabled(created.id, false);
    assert.ok(paused);
    assert.equal(paused.enabled, false);
    assert.equal(paused.nextRunAt, null);
    const resumed = store.setEnabled(created.id, true);
    assert.ok(resumed?.nextRunAt !== null);
  });

  it("records post-run bookkeeping and completes one-time schedules", () => {
    const created = store.create(
      { name: "once-run", prompt: "p", kind: "once", runAt: ONCE_FUTURE },
      ONCE_FUTURE - 1000,
    );
    const after = store.applyRunResult(
      created.id,
      { ok: true, startedAt: ONCE_FUTURE - 1000, finishedAt: ONCE_FUTURE },
      ONCE_FUTURE + 1000,
    );
    assert.ok(after);
    assert.equal(after.runCount, 1);
    assert.equal(after.lastStatus, "completed");
    assert.equal(after.enabled, false);
    assert.equal(after.nextRunAt, null);
  });

  it("keeps recurring schedules enabled with a future next run", () => {
    const created = store.create({ name: "recurring", prompt: "p", kind: "daily", time: "09:00" });
    const after = store.applyRunResult(
      created.id,
      { ok: false, error: "boom", startedAt: Date.now(), finishedAt: Date.now() },
    );
    assert.ok(after);
    assert.equal(after.runCount, 1);
    assert.equal(after.lastStatus, "failed");
    assert.equal(after.enabled, true);
    assert.ok((after.nextRunAt ?? 0) > Date.now());
  });

  it("duplicates as a paused copy and deletes with history", () => {
    const created = store.create({ name: "original", prompt: "p", kind: "daily", time: "09:00" });
    const copy = store.duplicate(created.id);
    assert.ok(copy);
    assert.equal(copy.name, "original (copy)");
    assert.equal(copy.enabled, false);
    assert.notEqual(copy.id, created.id);
    assert.equal(store.delete(copy.id), true);
    assert.equal(store.get(copy.id), null);
    assert.equal(store.delete("missing"), false);
  });
});
