import type Database from "better-sqlite3";
import { createChatSessionId } from "../ids.js";

export interface SessionRow {
  id: string;
  title: string;
  running: boolean;
  turnCount: number;
  lastEventId: number;
  /** Transcript length, maintained by the write queue — read without COUNT scans. */
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

interface RawSessionRow {
  id: string;
  title: string;
  running: number;
  turn_count: number;
  last_event_id: number;
  message_count: number;
  created_at: number;
  updated_at: number;
}

function toSession(row: RawSessionRow): SessionRow {
  return {
    id: row.id,
    title: row.title,
    running: row.running === 1,
    turnCount: row.turn_count,
    lastEventId: row.last_event_id,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Chat sessions (20-char alphanumeric ids). All lookups are indexed point reads. */
export class SessionsRepo {
  private readonly selectOne: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly insert: Database.Statement;
  private readonly updateTitle: Database.Statement;
  private readonly beginTurn: Database.Statement;
  private readonly endTurn: Database.Statement;
  private readonly removeSession: Database.Statement;
  private readonly removeEvents: Database.Statement;
  private readonly removeMessages: Database.Statement;
  private readonly removeSnapshot: Database.Statement;
  private readonly removeToolCalls: Database.Statement;
  private readonly removeSubAgentRuns: Database.Statement;
  private readonly clearRunning: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.selectOne = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
    this.selectAll = db.prepare(`SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`);
    this.insert = db.prepare(
      `INSERT INTO sessions (id, title, running, turn_count, last_event_id, message_count, created_at, updated_at)
       VALUES (?, ?, 0, 0, -1, 0, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    this.updateTitle = db.prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`);
    this.beginTurn = db.prepare(
      `UPDATE sessions SET running = 1, turn_count = turn_count + 1, last_event_id = -1, updated_at = ?
       WHERE id = ?`,
    );
    this.endTurn = db.prepare(
      `UPDATE sessions SET running = 0, last_event_id = ?, updated_at = ? WHERE id = ?`,
    );
    this.removeSession = db.prepare(`DELETE FROM sessions WHERE id = ?`);
    this.removeEvents = db.prepare(`DELETE FROM stream_events WHERE session_id = ?`);
    this.removeMessages = db.prepare(`DELETE FROM messages WHERE session_id = ?`);
    this.removeSnapshot = db.prepare(`DELETE FROM session_snapshots WHERE session_id = ?`);
    this.removeToolCalls = db.prepare(`DELETE FROM tool_calls WHERE session_id = ?`);
    this.removeSubAgentRuns = db.prepare(`DELETE FROM sub_agent_runs WHERE session_id = ?`);
    this.clearRunning = db.prepare(`UPDATE sessions SET running = 0 WHERE running = 1`);
  }

  /** Create a brand-new session with a generated 20-char id. */
  create(title = ""): SessionRow {
    const id = createChatSessionId();
    this.ensure(id, title);
    return this.get(id)!;
  }

  /** Idempotently ensure a session row exists (client-generated ids arrive here). */
  ensure(id: string, title = ""): void {
    const now = Date.now();
    this.insert.run(id, title, now, now);
  }

  get(id: string): SessionRow | undefined {
    const row = this.selectOne.get(id) as RawSessionRow | undefined;
    return row ? toSession(row) : undefined;
  }

  list(limit = 500): SessionRow[] {
    return (this.selectAll.all(limit) as RawSessionRow[]).map(toSession);
  }

  rename(id: string, title: string): void {
    this.updateTitle.run(title, Date.now(), id);
  }

  /** Mark a new turn as running; returns the turn number just started. */
  startTurn(id: string, title?: string): number {
    this.ensure(id, title ?? "");
    if (title && title.trim().length > 0) {
      const existing = this.get(id);
      if (existing && existing.title.trim().length === 0) this.rename(id, title);
    }
    this.beginTurn.run(Date.now(), id);
    return this.get(id)?.turnCount ?? 1;
  }

  /** Mark the running turn as finished and record the last stream event id. */
  finishTurn(id: string, lastEventId: number): void {
    this.endTurn.run(lastEventId, Date.now(), id);
  }

  /** On boot: no turn can still be running after a restart. */
  resetRunningFlags(): void {
    this.clearRunning.run();
  }

  /** Delete a session and every dependent row. */
  delete(id: string): void {
    const tx = this.db.transaction(() => {
      this.removeEvents.run(id);
      this.removeMessages.run(id);
      this.removeSnapshot.run(id);
      this.removeToolCalls.run(id);
      this.removeSubAgentRuns.run(id);
      this.removeSession.run(id);
    });
    tx();
  }
}
