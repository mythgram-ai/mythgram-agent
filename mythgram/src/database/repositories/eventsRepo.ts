import type Database from "better-sqlite3";

export interface StoredStreamEvent {
  turn: number;
  eventId: number;
  firstEventId: number;
  event: string;
  data: Record<string, unknown>;
  createdAt: number;
}

/**
 * Read side of the stream-event log (writes happen in the write queue). Every query
 * is a clustered-index range scan on (session_id, turn, event_id) — replay speed is
 * independent of total database size.
 */
export class EventsRepo {
  private readonly selectTurnSince: Database.Statement;
  private readonly selectLastTurn: Database.Statement;
  private readonly countBySession: Database.Statement;
  private readonly selectLatestUsage: Database.Statement;

  constructor(db: Database.Database) {
    this.selectTurnSince = db.prepare(
      `SELECT turn, event_id, first_event_id, event, data, created_at
       FROM stream_events
       WHERE session_id = ? AND turn = ? AND event_id > ?
       ORDER BY event_id ASC`,
    );
    this.selectLastTurn = db.prepare(
      `SELECT MAX(turn) AS turn FROM stream_events WHERE session_id = ?`,
    );
    this.countBySession = db.prepare(
      `SELECT COUNT(*) AS n FROM stream_events WHERE session_id = ?`,
    );
    // Newest-first scan of one session's context_usage log rows, across all turns.
    // context_usage rows are rare (one per LLM request), so this stays cheap no
    // matter how large the token/reasoning history grows.
    this.selectLatestUsage = db.prepare(
      `SELECT turn, event_id, first_event_id, event, data, created_at
       FROM stream_events
       WHERE session_id = ? AND event = 'context_usage'
       ORDER BY turn DESC, event_id DESC
       LIMIT ?`,
    );
  }

  /** Events of one turn after `sinceEventId` (exclusive), in stream order. */
  listTurnSince(sessionId: string, turn: number, sinceEventId = -1): StoredStreamEvent[] {
    const rows = this.selectTurnSince.all(sessionId, turn, sinceEventId) as Array<{
      turn: number;
      event_id: number;
      first_event_id: number;
      event: string;
      data: string;
      created_at: number;
    }>;
    const out: StoredStreamEvent[] = [];
    for (const row of rows) {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(row.data) as Record<string, unknown>;
      } catch {
        // keep an empty payload rather than dropping the event marker
      }
      out.push({
        turn: row.turn,
        eventId: row.event_id,
        firstEventId: row.first_event_id,
        event: row.event,
        data,
        createdAt: row.created_at,
      });
    }
    return out;
  }

  /** The latest turn number that has any persisted events (0 when none). */
  lastTurn(sessionId: string): number {
    const row = this.selectLastTurn.get(sessionId) as { turn: number | null } | undefined;
    return row?.turn ?? 0;
  }

  /**
   * Latest `context_usage` log rows for a session, newest first across all turns
   * (callers pick the newest entry for the agent scope they need). Empty when the
   * session never logged usage (e.g. silent provider or pre-usage history).
   * Never throws — malformed rows are skipped, never surfaced.
   */
  latestContextUsage(sessionId: string, limit = 25): StoredStreamEvent[] {
    let rows: Array<{
      turn: number;
      event_id: number;
      first_event_id: number;
      event: string;
      data: string;
      created_at: number;
    }>;
    try {
      const n = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 25;
      rows = this.selectLatestUsage.all(sessionId, n) as typeof rows;
    } catch {
      return [];
    }
    const out: StoredStreamEvent[] = [];
    for (const row of rows ?? []) {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(row.data) as Record<string, unknown>;
      } catch {
        // keep an empty payload rather than dropping the event marker
      }
      out.push({
        turn: row.turn,
        eventId: row.event_id,
        firstEventId: row.first_event_id,
        event: row.event,
        data,
        createdAt: row.created_at,
      });
    }
    return out;
  }

  count(sessionId: string): number {
    const row = this.countBySession.get(sessionId) as { n: number } | undefined;
    return row?.n ?? 0;
  }
}
