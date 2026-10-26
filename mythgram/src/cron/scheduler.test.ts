import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../database/schema.js";
import { SchedulesRepo } from "../database/repositories/schedulesRepo.js";
import { ScheduleRunsRepo } from "../database/repositories/scheduleRunsRepo.js";
import type { MythgramDatabase } from "../database/index.js";
import type { ScheduleRecord } from "../database/repositories/schedulesRepo.js";
import { ScheduleStore } from "./store.js";
import { ScheduleScheduler } from "./scheduler.js";
import type { ScheduleRunner } from "./runner.js";
import type { ExecuteOutcome } from "./runner.js";
import type { ScheduleConfig } from "./types.js";

interface Harness {
  db: MythgramDatabase;
  store: ScheduleStore;
  calls: Array<{ scheduleId: string; trigger: string }>;
  scheduler: ScheduleScheduler;
  releaseDeferred: () => void;
}

/** A fake runner that mirrors the real runner's bookkeeping without any LLM. */
function makeHarness(opts: { deferred?: boolean } = {}): Harness {
  const raw = new Database(":memory:");
  applySchema(raw);
  const schedules = new SchedulesRepo(raw);
  const scheduleRuns = new ScheduleRunsRepo(raw);
  const db = { schedules, scheduleRuns } as unknown as MythgramDatabase;
  const store = new ScheduleStore(schedules, scheduleRuns);
  const harness: Harness = {
    db,
    store,
    calls: [],
    scheduler: null as unknown as ScheduleScheduler,
    releaseDeferred: () => {},
  };
  let release: () => void = () => {};
  harness.releaseDeferred = (): void => release();

  const runner = {
    execute: async (
      schedule: ScheduleConfig,
      options: { trigger: "auto" | "manual"; onStarted?: (runId: string) => void },
    ): Promise<ExecuteOutcome> => {
      harness.calls.push({ scheduleId: schedule.id, trigger: options.trigger });
      const runId = `run_${harness.calls.length}_${Date.now().toString(36)}`;
      scheduleRuns.create(runId, schedule.id, options.trigger);
      // Mirror the real runner: hand the run id back synchronously at row creation.
      options.onStarted?.(runId);
      if (opts.deferred === true) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      scheduleRuns.finish(runId, { status: "completed", output: "done" });
      const now = Date.now();
      store.applyRunResult(schedule.id, { ok: true, startedAt: now, finishedAt: now });
      return { runId, ok: true, output: "done" };
    },
  };

  harness.scheduler = new ScheduleScheduler({
    db,
    store,
    runner: runner as unknown as ScheduleRunner,
    tickMs: 60_000,
  });
  return harness;
}

/** Backdate a schedule's computed next run so it is due right now. */
function makeDue(h: Harness, id: string, when = Date.now() - 1000): void {
  const row = h.db.schedules.get(id);
  assert.ok(row);
  const record: ScheduleRecord = {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    agentType: row.agentType,
    customAgentId: row.customAgentId,
    provider: row.provider,
    model: row.model,
    kind: row.kind,
    cron: row.cron,
    intervalMinutes: row.intervalMinutes,
    time: row.time,
    weekdays: row.weekdays,
    dayOfMonth: row.dayOfMonth,
    runAt: row.runAt,
    startAt: row.startAt,
    endAt: row.endAt,
    timezone: row.timezone,
    enabled: row.enabled,
    running: row.running,
    lastRunAt: row.lastRunAt,
    nextRunAt: when,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    runCount: row.runCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  h.db.schedules.save(record);
}

const ONCE_FUTURE = Date.UTC(2030, 0, 15, 12, 0);

describe("scheduler lifecycle", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("create → persist → tick executes a due schedule exactly once and records history", async () => {
    const created = h.store.create(
      { name: "due", prompt: "do it", kind: "once", runAt: ONCE_FUTURE },
      ONCE_FUTURE - 3_600_000,
    );
    makeDue(h, created.id);
    // Start without the boot tick: enable the loop flag directly (no timer).
    (h.scheduler as unknown as { started: boolean }).started = true;
    try {
      await h.scheduler.tick();
      await h.scheduler.tick();
      // The atomic claim lets exactly one tick win.
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0]!.scheduleId, created.id);
      const runs = h.db.scheduleRuns.listBySchedule(created.id);
      assert.equal(runs.length, 1);
      assert.equal(runs[0]!.status, "completed");
      const after = h.store.get(created.id)!;
      assert.equal(after.runCount, 1);
      assert.equal(after.enabled, false);
      assert.equal(after.nextRunAt, null);
      // A later tick never re-runs a completed one-time schedule.
      await h.scheduler.tick();
      assert.equal(h.calls.length, 1);
    } finally {
      h.scheduler.stop();
    }
  });

  it("does not stack overlapping executions of the same schedule", async () => {
    const slow = makeHarness({ deferred: true });
    try {
      const created = slow.store.create({ name: "slow", prompt: "take your time", kind: "daily", time: "09:00" });
      makeDue(slow, created.id);
      (slow.scheduler as unknown as { started: boolean }).started = true;
      // Attach a private abort controller so the manual flag path works without start().
      (slow.scheduler as unknown as { abortController: AbortController }).abortController = new AbortController();
      const first = slow.scheduler.tick();
      const second = slow.scheduler.tick();
      await Promise.all([first, second]);
      assert.equal(slow.calls.length, 1);
      slow.releaseDeferred();
      // Let the winning run settle (finish row + bookkeeping + claim release).
      for (let i = 0; i < 100 && slow.store.get(created.id)!.runCount === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(slow.store.get(created.id)!.runCount, 1);
    } finally {
      slow.releaseDeferred();
      slow.scheduler.stop();
    }
  });

  it("runNow triggers a manual run, and refuses while already running", async () => {
    const slow = makeHarness({ deferred: true });
    try {
      const created = slow.store.create({ name: "m", prompt: "p", kind: "daily", time: "09:00" });
      (slow.scheduler as unknown as { started: boolean }).started = true;
      (slow.scheduler as unknown as { abortController: AbortController }).abortController = new AbortController();
      const pending = slow.scheduler.runNow(created.id);
      // While the first run is in flight, a second manual run is refused.
      assert.equal(await slow.scheduler.runNow(created.id), null);
      slow.releaseDeferred();
      const first = await pending;
      assert.ok(first);
      assert.equal(slow.calls[0]!.trigger, "manual");
      assert.equal(slow.store.get(created.id)!.runCount, 1);
      assert.equal(await slow.scheduler.runNow("missing"), null);
    } finally {
      slow.releaseDeferred();
      slow.scheduler.stop();
    }
  });

  it("runNow returns the run id immediately without waiting for execution", async () => {
    const slow = makeHarness({ deferred: true });
    try {
      const created = slow.store.create({ name: "m", prompt: "p", kind: "daily", time: "09:00" });
      (slow.scheduler as unknown as { started: boolean }).started = true;
      (slow.scheduler as unknown as { abortController: AbortController }).abortController = new AbortController();
      // Returns the run id while the execution is still blocked on the deferred release.
      const runId = await slow.scheduler.runNow(created.id);
      assert.ok(typeof runId === "string" && runId.length > 0);
      // The run started (row exists, claim held) but has no outcome yet.
      assert.equal(slow.store.get(created.id)!.runCount, 0);
      assert.equal(slow.store.get(created.id)!.running, true);
      assert.equal(slow.db.scheduleRuns.runningFor(created.id)?.status, "running");
      slow.releaseDeferred();
      // The background run settles on its own after the release.
      for (let i = 0; i < 100 && slow.store.get(created.id)!.runCount === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(slow.store.get(created.id)!.runCount, 1);
      assert.equal(slow.store.get(created.id)!.running, false);
    } finally {
      slow.releaseDeferred();
      slow.scheduler.stop();
    }
  });

  it("a racing claim wins only once (duplicate-execution guard)", async () => {
    const created = h.store.create(
      { name: "race", prompt: "p", kind: "once", runAt: ONCE_FUTURE },
      ONCE_FUTURE - 3_600_000,
    );
    makeDue(h, created.id);
    // Simulate another claimant winning first.
    assert.equal(h.db.schedules.claimRun(created.id), true);
    assert.equal(h.db.schedules.claimRun(created.id), false);
    (h.scheduler as unknown as { started: boolean }).started = true;
    try {
      await h.scheduler.tick();
      assert.equal(h.calls.length, 0);
    } finally {
      h.scheduler.stop();
    }
    h.db.schedules.releaseRun(created.id);
  });

  it("restart recovery catch-ups an overdue schedule exactly once", async () => {
    // A recurring schedule whose next run went stale while the backend was down.
    const created = h.store.create({ name: "rec", prompt: "p", kind: "interval", intervalMinutes: 60 });
    makeDue(h, created.id, Date.now() - 60_000);
    // Fresh scheduler instance (as after a restart) over the same database.
    const scheduler2 = new ScheduleScheduler({
      db: h.db,
      store: h.store,
      runner: {
        execute: async (schedule: ScheduleConfig): Promise<ExecuteOutcome> => {
          h.calls.push({ scheduleId: schedule.id, trigger: "auto" });
          h.db.scheduleRuns.create("run_catchup", schedule.id, "auto");
          h.db.scheduleRuns.finish("run_catchup", { status: "completed", output: "caught up" });
          const now = Date.now();
          h.store.applyRunResult(schedule.id, { ok: true, startedAt: now, finishedAt: now });
          return { runId: "run_catchup", ok: true, output: "caught up" };
        },
      } as unknown as ScheduleRunner,
    });
    (scheduler2 as unknown as { started: boolean }).started = true;
    try {
      // recover() behaves like boot (without the timer/boot tick).
      scheduler2.recover();
      for (let i = 0; i < 100 && h.calls.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(h.calls.length, 1);
      const after = h.store.get(created.id)!;
      assert.ok((after.nextRunAt ?? 0) > Date.now());
    } finally {
      scheduler2.stop();
    }
  });
});
