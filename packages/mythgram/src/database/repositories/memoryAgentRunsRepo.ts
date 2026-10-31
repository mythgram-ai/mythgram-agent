import type Database from "better-sqlite3";

/** Lifecycle states of a background memory-agent run. */
export type MemoryAgentRunStatus = "queued" | "running" | "completed" | "failed";

export interface MemoryAgentRunRow {
  id: string;
  chatSessionId: string;
  status: MemoryAgentRunStatus;
  provider: string;
  model: string;
  summary: string;
  error: string | null;
  /** Memory file paths this run wrote/edited/deleted. */
  updatedFiles: string[];
  lastEventId: number;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** Counters shown in the memory-agent sessions popup. */
export interface MemoryAgentRunCounts {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

/** One persisted (possibly coalesced) memory-agent stream event. */
export interface StoredMemoryAgentEvent {
  eventId: number;
  firstEventId: number;
  event: string;
  data: Record<string, unknown>;
}

/**
 * Persistence for the background memory agent: one row per run (each run is a brand-new
 * memory-agent session) plus the full, coalesced stream-event log of every run. Everything
 * the memory agent produces lives here, in the local SQLite database — nothing is stored
 * in the browser.
 */
export class MemoryAgentRunsRepo {
  private readonly insertRun: Database.Statement;
  private readonly updateRunning: Database.Statement;
  private readonly updateFinished: Database.Statement;
  private readonly selectOne: Database.Statement;
  private readonly selectRecent: Database.Statement;
  private readonly selectCounts: Database.Statement;
  private readonly failStale: Database.Statement;
  private readonly insertEvent: Database.Statement;
  private readonly selectEventsSince: Database.Statement;
  private readonly deleteOldRuns: Database.Statement;
  private readonly deleteEventsOfOldRuns: Database.Statement;
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.insertRun = db.prepare(
      `INSERT INTO memory_agent_runs (id, chat_session_id, status, provider, model, queued_at)
       VALUES (?, ?, 'queued', ?, ?, ?)`,
    );
    this.updateRunning = db.prepare(
      `UPDATE memory_agent_runs SET status = 'running', started_at = ? WHERE id = ?`,
    );
    this.updateFinished = db.prepare(
      `UPDATE memory_agent_runs
       SET status = ?, summary = ?, error = ?, updated_files = ?, last_event_id = ?, finished_at = ?
       WHERE id = ?`,
    );
    this.selectOne = db.prepare(`SELECT * FROM memory_agent_runs WHERE id = ?`);
    this.selectRecent = db.prepare(
      `SELECT * FROM memory_agent_runs ORDER BY queued_at DESC LIMIT ?`,
    );
    this.selectCounts = db.prepare(
      `SELECT status, COUNT(*) AS n FROM memory_agent_runs GROUP BY status`,
    );
    this.failStale = db.prepare(
      `UPDATE memory_agent_runs
       SET status = 'failed', error = ?, finished_at = ?
       WHERE status IN ('queued', 'running')`,
    );
    this.insertEvent = db.prepare(
      `INSERT OR REPLACE INTO memory_agent_events (run_id, event_id, first_event_id, event, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.selectEventsSince = db.prepare(
      `SELECT event_id, first_event_id, event, data FROM memory_agent_events
       WHERE run_id = ? AND event_id > ? ORDER BY event_id ASC`,
    );
    this.deleteOldRuns = db.prepare(
      `DELETE FROM memory_agent_runs WHERE id IN (
         SELECT id FROM memory_agent_runs ORDER BY queued_at DESC LIMIT -1 OFFSET ?
       )`,
    );
    this.deleteEventsOfOldRuns = db.prepare(
      `DELETE FROM memory_agent_events WHERE run_id NOT IN (SELECT id FROM memory_agent_runs)`,
    );
  }

  /** Register a freshly enqueued run (status "queued"). */
  createQueued(id: string, chatSessionId: string, provider: string, model: string): void {
    this.insertRun.run(id, chatSessionId, provider, model, Date.now());
  }

  markRunning(id: string): void {
    this.updateRunning.run(Date.now(), id);
  }

  markFinished(
    id: string,
    outcome: {
      status: "completed" | "failed";
      summary: string;
      error?: string | null;
      updatedFiles: string[];
      lastEventId: number;
    },
  ): void {
    let updatedFiles = "[]";
    try {
      updatedFiles = JSON.stringify(outcome.updatedFiles);
    } catch {
      // keep "[]"
    }
    this.updateFinished.run(
      outcome.status,
      outcome.summary,
      outcome.error ?? null,
      updatedFiles,
      outcome.lastEventId,
      Date.now(),
      id,
    );
  }

  get(id: string): MemoryAgentRunRow | undefined {
    const row = this.selectOne.get(id) as RawRow | undefined;
    return row ? toRow(row) : undefined;
  }

  /** Most recent runs first (bounded, indexed read). */
  list(limit = 50): MemoryAgentRunRow[] {
    const bounded = Math.max(1, Math.min(Math.floor(limit), 200));
    return (this.selectRecent.all(bounded) as RawRow[]).map(toRow);
  }

  counts(): MemoryAgentRunCounts {
    const rows = this.selectCounts.all() as Array<{ status: string; n: number }>;
    const counts: MemoryAgentRunCounts = { queued: 0, running: 0, completed: 0, failed: 0, total: 0 };
    for (const row of rows) {
      if (row.status === "queued") counts.queued = row.n;
      else if (row.status === "running") counts.running = row.n;
      else if (row.status === "completed") counts.completed = row.n;
      else if (row.status === "failed") counts.failed = row.n;
      counts.total += row.n;
    }
    return counts;
  }

  /** After a restart nothing can still be queued or running — mark leftovers failed. */
  failInterrupted(): void {
    this.failStale.run("Interrupted by a backend restart.", Date.now());
  }

  /** Persist a batch of (possibly coalesced) stream events for a run in one transaction. */
  appendEvents(
    runId: string,
    events: Array<{ eventId: number; firstEventId: number; event: string; data: Record<string, unknown> }>,
  ): void {
    if (events.length === 0) return;
    const now = Date.now();
    const insert = this.insertEvent;
    const tx = this.db.transaction(() => {
      for (const e of events) {
        let data = "{}";
        try {
          data = JSON.stringify(e.data);
        } catch {
          // keep "{}"
        }
        insert.run(runId, e.eventId, e.firstEventId, e.event, data, now);
      }
    });
    tx();
  }

  /** Replay a run's event log from `sinceId` (exclusive) — one indexed range read. */
  listEventsSince(runId: string, sinceId: number): StoredMemoryAgentEvent[] {
    const rows = this.selectEventsSince.all(runId, sinceId) as Array<{
      event_id: number;
      first_event_id: number;
      event: string;
      data: string;
    }>;
    const out: StoredMemoryAgentEvent[] = [];
    for (const row of rows) {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(row.data) as Record<string, unknown>;
      } catch {
        // skip corrupted payload, keep the event envelope
      }
      out.push({ eventId: row.event_id, firstEventId: row.first_event_id, event: row.event, data });
    }
    return out;
  }

  /** Keep only the newest `keep` runs (and their events) — bounds long-term growth. */
  pruneOldRuns(keep = 200): void {
    this.deleteOldRuns.run(Math.max(1, Math.floor(keep)));
    this.deleteEventsOfOldRuns.run();
  }
}

interface RawRow {
  id: string;
  chat_session_id: string;
  status: string;
  provider: string;
  model: string;
  summary: string;
  error: string | null;
  updated_files: string;
  last_event_id: number;
  queued_at: number;
  started_at: number | null;
  finished_at: number | null;
}

function toRow(row: RawRow): MemoryAgentRunRow {
  let updatedFiles: string[] = [];
  try {
    const parsed = JSON.parse(row.updated_files) as unknown;
    if (Array.isArray(parsed)) updatedFiles = parsed.filter((p): p is string => typeof p === "string");
  } catch {
    // keep []
  }
  return {
    id: row.id,
    chatSessionId: row.chat_session_id,
    status: isStatus(row.status) ? row.status : "failed",
    provider: row.provider,
    model: row.model,
    summary: row.summary,
    error: row.error,
    updatedFiles,
    lastEventId: row.last_event_id,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function isStatus(value: string): value is MemoryAgentRunStatus {
  return value === "queued" || value === "running" || value === "completed" || value === "failed";
}
