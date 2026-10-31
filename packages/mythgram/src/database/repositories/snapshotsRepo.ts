import type Database from "better-sqlite3";

/**
 * UI-shaped conversation snapshots — the JSON the frontend renders for a session
 * (messages with tool chips, sub-agent runs, plan/question blocks...). One document
 * per session, replaced wholesale; reads/writes are point lookups on the PK.
 */
export class SnapshotsRepo {
  private readonly selectOne: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly remove: Database.Statement;

  constructor(db: Database.Database) {
    this.selectOne = db.prepare(`SELECT data FROM session_snapshots WHERE session_id = ?`);
    this.upsert = db.prepare(
      `INSERT INTO session_snapshots (session_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    );
    this.remove = db.prepare(`DELETE FROM session_snapshots WHERE session_id = ?`);
  }

  get(sessionId: string): unknown | null {
    const row = this.selectOne.get(sessionId) as { data: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.data) as unknown;
    } catch {
      return null;
    }
  }

  set(sessionId: string, snapshot: unknown): void {
    let json: string;
    try {
      json = JSON.stringify(snapshot ?? null);
    } catch {
      return;
    }
    this.upsert.run(sessionId, json, Date.now());
  }

  delete(sessionId: string): void {
    this.remove.run(sessionId);
  }
}
