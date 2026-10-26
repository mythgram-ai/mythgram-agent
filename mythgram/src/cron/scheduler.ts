/**
 * ScheduleScheduler — the persistent background cron engine.
 *
 * Lives entirely in the backend process (started from `src/index.ts`), so
 * schedules fire on time with no browser open — even while the user is
 * sleeping. A short-interval tick (default 15s) scans the indexed
 * enabled/next_run_at queue and executes every due schedule:
 *
 *   - Boot: `start()` loads all active schedules, resets stale `running`
 *     flags left by a crash/restart, reschedules anything whose next run is
 *     stale, and catch-ups overdue schedules exactly once (missed-execution
 *     safety: coalesced into a single run, never a burst).
 *   - Tick: due schedules are claimed atomically (`running` 0 → 1, so two
 *     ticks — or a manual run racing a tick — can never double-execute),
 *     then executed concurrently without blocking the loop.
 *   - Finish: the run outcome advances the schedule (counts, last/next run,
 *     one-time completion, window expiry) and releases the claim.
 *   - Overlap: a schedule with an execution still in flight is skipped until
 *     it finishes (no stacked duplicate runs).
 *   - Stop: `stop()` halts the loop and aborts in-flight runs (used on
 *     shutdown; running flags are reset on the next boot).
 */

import type { MythgramDatabase } from "../database/index.js";
import { getNextRun } from "./nextrun.js";
import { toRecurrence } from "./store.js";
import type { ScheduleStore } from "./store.js";
import { isTerminalSchedule, type ScheduleConfig } from "./types.js";
import { type ScheduleRunner } from "./runner.js";

/** How often the scheduler scans for due schedules. */
export const SCHEDULER_TICK_MS = 15_000;

/** Overdue schedules older than this are rescheduled, not catch-up executed. */
export const SCHEDULER_CATCH_UP_MS = 24 * 3_600_000;

export interface ScheduleSchedulerDeps {
  db: MythgramDatabase;
  store: ScheduleStore;
  runner: ScheduleRunner;
  tickMs?: number;
  catchUpMs?: number;
  now?: () => number;
}

export class ScheduleScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly tickMs: number;
  private readonly catchUpMs: number;
  private readonly now: () => number;
  /** Schedule ids with an execution currently in flight (overlap guard). */
  private readonly inFlight = new Map<string, Promise<string | null>>();
  private abortController: AbortController | null = null;
  private started = false;

  constructor(private readonly deps: ScheduleSchedulerDeps) {
    this.tickMs = Math.max(5_000, deps.tickMs ?? SCHEDULER_TICK_MS);
    this.catchUpMs = deps.catchUpMs ?? SCHEDULER_CATCH_UP_MS;
    this.now = deps.now ?? Date.now;
  }

  /** Number of schedules currently executing (for observability/tests). */
  get runningCount(): number {
    return this.inFlight.size;
  }

  /** Latest captured context usage for a schedule (null when no run has reported yet). */
  lastContextUsage(scheduleId: string): Record<string, unknown> | null {
    try {
      return this.deps.runner.lastContextUsage(scheduleId);
    } catch {
      return null;
    }
  }

  /**
   * Load all active schedules and start the background loop. Resets stale
   * running flags, repairs stale next-run times, and catch-ups overdue
   * schedules once. Safe to call multiple times.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.abortController = new AbortController();
    this.recover();
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, this.tickMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
    // Run an immediate first tick so schedules due at boot fire without delay.
    void this.tick().catch(() => undefined);
  }

  /** Stop the loop and abort in-flight runs (shutdown path). */
  stop(): void {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Boot recovery: stale `running` flags are already cleared by the database
   * layer; here every enabled schedule gets a fresh, correct `nextRunAt`
   * (repairs rows saved by older versions or edited while down), expired
   * one-time/windowed schedules are retired, and overdue schedules are
   * catch-up executed exactly once when inside the catch-up window.
   */
  recover(): void {
    const now = this.now();
    for (const schedule of this.deps.store.list()) {
      // Retire one-time schedules that already fired and expired windows.
      if (isTerminalSchedule(schedule)) {
        if (schedule.enabled || schedule.nextRunAt !== null) {
          this.deps.store.setEnabled(schedule.id, false, now);
        }
        continue;
      }
      if (!schedule.enabled) continue;
      const next = getNextRun(toRecurrence(schedule), now);
      const stored = schedule.nextRunAt;
      if (next !== stored) {
        this.refreshNextRun(schedule.id, next);
      }
      // Overdue: the stored next run lies in the past (backend was down or
      // asleep). Catch up with a single execution when recent, else the fresh
      // `next` above already points at the next future fire.
      if (stored !== null && stored <= now && now - stored <= this.catchUpMs) {
        const fresh = this.deps.store.get(schedule.id);
        if (fresh && fresh.enabled && !isTerminalSchedule(fresh)) {
          void this.executeDue(fresh, "auto").catch(() => undefined);
        }
      }
    }
  }

  /** One tick: execute every enabled, idle, due schedule (concurrently). */
  async tick(): Promise<void> {
    if (!this.started) return;
    const now = this.now();
    const due = this.deps.db.schedules.listDue(now);
    for (const row of due) {
      const schedule = this.deps.store.get(row.id);
      if (!schedule || !schedule.enabled || schedule.running) continue;
      if (isTerminalSchedule(schedule)) {
        this.deps.store.setEnabled(schedule.id, false, now);
        continue;
      }
      // Skip when an execution is already in flight (overlap guard — the DB
      // claim below is the authoritative duplicate-execution guard).
      if (this.inFlight.has(schedule.id)) continue;
      void this.executeDue(schedule, "auto").catch(() => undefined);
    }
  }

  /**
   * Trigger an immediate manual run (the Schedule page "Run now" action and the
   * schedule_run_now agent tool). Returns the run id IMMEDIATELY while the execution
   * continues in the background — it never waits for the run to finish. Returns null
   * when the schedule is missing/completed or an execution is already in flight.
   */
  async runNow(id: string): Promise<string | null> {
    const schedule = this.deps.store.get(id);
    if (!schedule || isTerminalSchedule(schedule)) return null;
    if (schedule.running || this.inFlight.has(id)) return null;
    return this.startDue(schedule, "manual");
  }

  /**
   * Claim + launch one run, returning its run id immediately without waiting for the
   * execution to finish. The atomic DB claim is the duplicate-execution guard: only the
   * winner launches; losers (a racing tick or manual run) get null. The launched run
   * keeps executing in the background and releases the claim when it settles.
   */
  private startDue(schedule: ScheduleConfig, trigger: "auto" | "manual"): string | null {
    if (!this.deps.db.schedules.claimRun(schedule.id)) return null;
    let runId: string | null = null;
    const task = this.runClaimed(schedule, trigger, (rid) => {
      runId = rid;
    }).finally(() => {
      this.inFlight.delete(schedule.id);
      try {
        this.deps.db.schedules.releaseRun(schedule.id);
      } catch {
        // best effort — the next boot resets the flag
      }
    });
    this.inFlight.set(schedule.id, task);
    return runId;
  }

  /**
   * Claim + execute one run. The atomic DB claim is the duplicate-execution
   * guard: only the winner runs; losers (a racing tick or manual run) get null.
   */
  private async executeDue(schedule: ScheduleConfig, trigger: "auto" | "manual"): Promise<string | null> {
    if (!this.deps.db.schedules.claimRun(schedule.id)) return null;
    const task = this.runClaimed(schedule, trigger).finally(() => {
      this.inFlight.delete(schedule.id);
      try {
        this.deps.db.schedules.releaseRun(schedule.id);
      } catch {
        // best effort — the next boot resets the flag
      }
    });
    this.inFlight.set(schedule.id, task);
    return task;
  }

  private async runClaimed(
    schedule: ScheduleConfig,
    trigger: "auto" | "manual",
    onStarted?: (runId: string) => void,
  ): Promise<string | null> {
    try {
      const outcome = await this.deps.runner.execute(schedule, {
        trigger,
        signal: this.abortController?.signal,
        onStarted,
      });
      return outcome.runId;
    } catch {
      return null;
    }
  }

  private refreshNextRun(id: string, next: number | null): void {
    try {
      const current = this.deps.store.get(id);
      if (!current || current.nextRunAt === next) return;
      this.deps.store.refreshNextRun(id, this.now());
    } catch {
      // best effort — the next tick recomputes anyway
    }
  }
}
