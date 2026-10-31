import type Database from "better-sqlite3";

/** One persisted schedule row (raw storage shape — the cron layer types it). */
export interface ScheduleRow {
  id: string;
  name: string;
  prompt: string;
  agentType: string;
  customAgentId: string | null;
  provider: string;
  model: string;
  kind: string;
  cron: string;
  intervalMinutes: number | null;
  time: string | null;
  weekdays: string;
  dayOfMonth: number | null;
  runAt: number | null;
  startAt: number | null;
  endAt: number | null;
  timezone: string;
  enabled: boolean;
  running: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  runCount: number;
  createdAt: number;
  updatedAt: number;
}

interface RawScheduleRow {
  id: string;
  name: string;
  prompt: string;
  agent_type: string;
  custom_agent_id: string | null;
  provider: string;
  model: string;
  kind: string;
  cron: string;
  interval_minutes: number | null;
  time: string | null;
  weekdays: string;
  day_of_month: number | null;
  run_at: number | null;
  start_at: number | null;
  end_at: number | null;
  timezone: string;
  enabled: number;
  running: number;
  last_run_at: number | null;
  last_status: string | null;
  last_error: string | null;
  next_run_at: number | null;
  run_count: number;
  created_at: number;
  updated_at: number;
}

function toRow(row: RawScheduleRow): ScheduleRow {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    agentType: row.agent_type,
    customAgentId: row.custom_agent_id,
    provider: row.provider,
    model: row.model,
    kind: row.kind,
    cron: row.cron,
    intervalMinutes: row.interval_minutes,
    time: row.time,
    weekdays: row.weekdays,
    dayOfMonth: row.day_of_month,
    runAt: row.run_at,
    startAt: row.start_at,
    endAt: row.end_at,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    running: row.running === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fields the cron store writes (mirrors the table columns, camelCase). */
export interface ScheduleRecord {
  id: string;
  name: string;
  prompt: string;
  agentType: string;
  customAgentId: string | null;
  provider: string;
  model: string;
  kind: string;
  cron: string;
  intervalMinutes: number | null;
  time: string | null;
  weekdays: string;
  dayOfMonth: number | null;
  runAt: number | null;
  startAt: number | null;
  endAt: number | null;
  timezone: string;
  enabled: boolean;
  running: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  runCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Schedules table (all lookups are indexed point reads or the
 * enabled/next_run_at range scan the scheduler ticks on).
 */
export class SchedulesRepo {
  private readonly selectOne: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectDue: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly remove: Database.Statement;
  private readonly claim: Database.Statement;
  private readonly release: Database.Statement;
  private readonly clearRunning: Database.Statement;

  constructor(db: Database.Database) {
    this.selectOne = db.prepare(`SELECT * FROM schedules WHERE id = ?`);
    this.selectAll = db.prepare(`SELECT * FROM schedules ORDER BY created_at DESC`);
    this.selectDue = db.prepare(
      `SELECT * FROM schedules
        WHERE enabled = 1 AND running = 0 AND next_run_at IS NOT NULL AND next_run_at <= ?
        ORDER BY next_run_at ASC`,
    );
    this.upsert = db.prepare(
      `INSERT INTO schedules
        (id, name, prompt, agent_type, custom_agent_id, provider, model, kind, cron,
         interval_minutes, time, weekdays, day_of_month, run_at, start_at, end_at,
         timezone, enabled, running, last_run_at, next_run_at, last_status, last_error,
         run_count, created_at, updated_at)
       VALUES
        (@id, @name, @prompt, @agentType, @customAgentId, @provider, @model, @kind, @cron,
         @intervalMinutes, @time, @weekdays, @dayOfMonth, @runAt, @startAt, @endAt,
         @timezone, @enabled, @running, @lastRunAt, @nextRunAt, @lastStatus, @lastError,
         @runCount, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, prompt = excluded.prompt, agent_type = excluded.agent_type,
         custom_agent_id = excluded.custom_agent_id, provider = excluded.provider,
         model = excluded.model, kind = excluded.kind, cron = excluded.cron,
         interval_minutes = excluded.interval_minutes, time = excluded.time,
         weekdays = excluded.weekdays, day_of_month = excluded.day_of_month,
         run_at = excluded.run_at, start_at = excluded.start_at, end_at = excluded.end_at,
         timezone = excluded.timezone, enabled = excluded.enabled, running = excluded.running,
         last_run_at = excluded.last_run_at, next_run_at = excluded.next_run_at,
         last_status = excluded.last_status, last_error = excluded.last_error,
         run_count = excluded.run_count, updated_at = excluded.updated_at`,
    );
    this.remove = db.prepare(`DELETE FROM schedules WHERE id = ?`);
    // Atomic claim: only one claimant (one process, one tick) can flip running 0 -> 1.
    this.claim = db.prepare(
      `UPDATE schedules SET running = 1, updated_at = ? WHERE id = ? AND running = 0`,
    );
    this.release = db.prepare(`UPDATE schedules SET running = 0, updated_at = ? WHERE id = ?`);
    this.clearRunning = db.prepare(`UPDATE schedules SET running = 0 WHERE running = 1`);
  }

  get(id: string): ScheduleRow | undefined {
    const row = this.selectOne.get(id) as RawScheduleRow | undefined;
    return row ? toRow(row) : undefined;
  }

  list(): ScheduleRow[] {
    return (this.selectAll.all() as RawScheduleRow[]).map(toRow);
  }

  /** Enabled, idle schedules whose next run is due at `nowMs` (ordered oldest-due first). */
  listDue(nowMs: number): ScheduleRow[] {
    return (this.selectDue.all(nowMs) as RawScheduleRow[]).map(toRow);
  }

  save(record: ScheduleRecord): void {
    this.upsert.run({
      id: record.id,
      name: record.name,
      prompt: record.prompt,
      agentType: record.agentType,
      customAgentId: record.customAgentId,
      provider: record.provider,
      model: record.model,
      kind: record.kind,
      cron: record.cron,
      intervalMinutes: record.intervalMinutes,
      time: record.time,
      weekdays: record.weekdays,
      dayOfMonth: record.dayOfMonth,
      runAt: record.runAt,
      startAt: record.startAt,
      endAt: record.endAt,
      timezone: record.timezone,
      enabled: record.enabled ? 1 : 0,
      running: record.running ? 1 : 0,
      lastRunAt: record.lastRunAt,
      nextRunAt: record.nextRunAt,
      lastStatus: record.lastStatus,
      lastError: record.lastError,
      runCount: record.runCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  delete(id: string): void {
    this.remove.run(id);
  }

  /**
   * Atomically claim a schedule for execution (running 0 -> 1).
   * Returns true when this caller won the claim — the duplicate-execution guard.
   */
  claimRun(id: string): boolean {
    const info = this.claim.run(Date.now(), id) as { changes: number };
    return info.changes === 1;
  }

  releaseRun(id: string): void {
    this.release.run(Date.now(), id);
  }

  /** On boot: no execution can still be running after a restart. */
  resetRunningFlags(): void {
    this.clearRunning.run();
  }
}
