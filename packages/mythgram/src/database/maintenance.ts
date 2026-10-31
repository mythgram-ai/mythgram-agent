import type Database from "better-sqlite3";

/**
 * Background maintenance that keeps the database fast FOREVER, no matter how large
 * it grows — this is what prevents the "agent gets slower as the DB grows" failure:
 *
 * - PASSIVE WAL checkpoints on an idle timer move WAL pages into the main file
 *   without ever blocking a writer, so the WAL never balloons and reads stay fast.
 * - `PRAGMA optimize` periodically refreshes the query planner's statistics so
 *   index selection stays optimal as tables grow.
 *
 * Both operations are incremental and cheap; they run every 60s and on shutdown.
 */

const MAINTENANCE_INTERVAL_MS = 60_000;

export class DatabaseMaintenance {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: Database.Database) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runOnce(), MAINTENANCE_INTERVAL_MS);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  runOnce(): void {
    try {
      // PASSIVE: checkpoints as many frames as possible without blocking anyone.
      this.db.pragma("wal_checkpoint(PASSIVE)");
      this.db.pragma("optimize");
    } catch {
      // Maintenance must never take the app down.
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      // Final full checkpoint + stats refresh on clean shutdown.
      this.db.pragma("wal_checkpoint(TRUNCATE)");
      this.db.pragma("optimize");
    } catch {
      // best effort
    }
  }
}
