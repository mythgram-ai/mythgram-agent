import type Database from "better-sqlite3";

export type ScheduleRunStatus = "running" | "completed" | "failed";
export type ScheduleRunTrigger = "auto" | "manual";

export interface ScheduleRunRow {
  id: string;
  scheduleId: string;
  trigger: ScheduleRunTrigger;
  status: ScheduleRunStatus;
  output: string;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

interface RawRunRow {
  id: string;
  schedule_id: string;
  trigger: string;
  status: string;
  output: string;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

function toRow(row: RawRunRow): ScheduleRunRow {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    trigger: row.trigger === "manual" ? "manual" : "auto",
    status: isStatus(row.status) ? row.status : "failed",
    output: row.output,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function isStatus(value: string): value is ScheduleRunStatus {
  return value === "running" || value === "completed" || value === "failed";
}

/** Execution history of schedules (one row per automatic or manual run). */
export class ScheduleRunsRepo {
  private readonly insert: Database.Statement;
  private readonly finishStmt: Database.Statement;
  private readonly selectOne: Database.Statement;
  private readonly selectBySchedule: Database.Statement;
  private readonly selectRunningBySchedule: Database.Statement;
  private readonly failStale: Database.Statement;
  private readonly deleteBySchedule: Database.Statement;
  private readonly deleteOldRuns: Database.Statement;
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.insert = db.prepare(
      `INSERT INTO schedule_runs (id, schedule_id, trigger, status, output, started_at)
       VALUES (?, ?, ?, 'running', '', ?)`,
    );
    this.finishStmt = db.prepare(
      `UPDATE schedule_runs SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?`,
    );
    this.selectOne = db.prepare(`SELECT * FROM schedule_runs WHERE id = ?`);
    this.selectBySchedule = db.prepare(
      `SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ?`,
    );
    this.selectRunningBySchedule = db.prepare(
      `SELECT * FROM schedule_runs WHERE schedule_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
    );
    this.failStale = db.prepare(
      `UPDATE schedule_runs SET status = 'failed', error = ?, finished_at = ?
       WHERE status = 'running'`,
    );
    this.deleteBySchedule = db.prepare(`DELETE FROM schedule_runs WHERE schedule_id = ?`);
    this.deleteOldRuns = db.prepare(
      `DELETE FROM schedule_runs WHERE id IN (
         SELECT id FROM schedule_runs WHERE schedule_id = ?
         ORDER BY started_at DESC LIMIT -1 OFFSET ?
       )`,
    );
  }

  /** Register a freshly started run (status "running"). */
  create(id: string, scheduleId: string, trigger: ScheduleRunTrigger): void {
    this.insert.run(id, scheduleId, trigger, Date.now());
  }

  finish(
    id: string,
    outcome: { status: "completed" | "failed"; output: string; error?: string | null },
  ): void {
    this.finishStmt.run(outcome.status, outcome.output, outcome.error ?? null, Date.now(), id);
  }

  get(id: string): ScheduleRunRow | undefined {
    const row = this.selectOne.get(id) as RawRunRow | undefined;
    return row ? toRow(row) : undefined;
  }

  /** Most recent runs of one schedule first (bounded). */
  listBySchedule(scheduleId: string, limit = 50): ScheduleRunRow[] {
    const bounded = Math.max(1, Math.min(Math.floor(limit), 200));
    return (this.selectBySchedule.all(scheduleId, bounded) as RawRunRow[]).map(toRow);
  }

  /** The currently running execution of a schedule, if any. */
  runningFor(scheduleId: string): ScheduleRunRow | undefined {
    const row = this.selectRunningBySchedule.get(scheduleId) as RawRunRow | undefined;
    return row ? toRow(row) : undefined;
  }

  /** After a restart nothing can still be running — mark leftovers failed. */
  failInterrupted(): void {
    this.failStale.run("Interrupted by a backend restart.", Date.now());
  }

  deleteByScheduleId(scheduleId: string): void {
    this.deleteBySchedule.run(scheduleId);
  }

  /** Keep only the newest `keep` runs per schedule — bounds long-term growth. */
  prune(scheduleId: string, keep = 200): void {
    this.deleteOldRuns.run(scheduleId, Math.max(1, Math.floor(keep)));
  }

  /** Exposed for the transactional schedule+history delete in the cron store. */
  transaction<T>(fn: () => T): T {
    return (this.db.transaction(fn) as () => T)();
  }
}
