import type Database from "better-sqlite3";
import type { StoredMessage } from "../../services/sessionStore.js";

/**
 * Provider-format transcript per session. Bulk writes go through the write queue
 * (`enqueueMessages`); this repo serves the indexed reads and restart hydration.
 */
export class MessagesRepo {
  private readonly selectBySession: Database.Statement;
  private readonly countBySession: Database.Statement;

  constructor(db: Database.Database) {
    this.selectBySession = db.prepare(
      `SELECT data FROM messages WHERE session_id = ? ORDER BY seq ASC`,
    );
    this.countBySession = db.prepare(
      `SELECT COUNT(*) AS n FROM messages WHERE session_id = ?`,
    );
  }

  list(sessionId: string): StoredMessage[] {
    const rows = this.selectBySession.all(sessionId) as Array<{ data: string }>;
    const out: StoredMessage[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.data) as StoredMessage;
        if (parsed && typeof parsed === "object" && typeof parsed.role === "string") {
          out.push(parsed);
        }
      } catch {
        // Skip unreadable rows rather than failing the whole transcript.
      }
    }
    return out;
  }

  count(sessionId: string): number {
    const row = this.countBySession.get(sessionId) as { n: number } | undefined;
    return row?.n ?? 0;
  }
}
