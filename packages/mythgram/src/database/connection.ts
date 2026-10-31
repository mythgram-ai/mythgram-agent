import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * SQLite connection management.
 *
 * The database file lives at `<workspace>/.mythgram/mythgram.db` and is created automatically
 * the first time the agent starts. better-sqlite3 bundles SQLite 3.53.4 and executes
 * statements synchronously — every write on a request/streaming path therefore goes
 * through the batched {@link ../writeQueue.ts DatabaseWriteQueue}, never directly,
 * so token streaming at 10k-100k+ tokens/second can never block the event loop.
 */

/** Directory (inside the workspace) that holds the database file. */
export const MYTHGRAM_DATA_DIR = ".mythgram";

/** Database file name inside the `.mythgram` folder. */
export const DATABASE_FILE_NAME = "mythgram.db";

/** Resolve the absolute path of the database file for a workspace. */
export function resolveDatabasePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, MYTHGRAM_DATA_DIR, DATABASE_FILE_NAME);
}

export interface ConnectionOptions {
  /**
   * Lock the file strictly to this process (removes per-statement OS lock overhead).
   * Defaults to true — this is a local, single-process application. Set the
   * MYTHGRAM_DB_EXCLUSIVE=0 env var to disable (e.g. to inspect the DB while running).
   */
  exclusiveLocking?: boolean;
}

/**
 * Open (creating if needed) the SQLite database and apply the performance PRAGMAs.
 *
 * Tuning rationale (validated for extreme-throughput streaming):
 * - `journal_mode = WAL`         — Write-Ahead Logging: writers never block readers and
 *                                  appends are sequential I/O, so concurrent streams and
 *                                  UI reads never contend.
 * - `synchronous = NORMAL`       — decouples fsync from the application thread; with WAL
 *                                  this is durable against app crashes and loses at most
 *                                  the last checkpoint window on power loss.
 * - `cache_size = -64000`        — exactly 64MB of page cache in RAM, keeping hot index
 *                                  pages memory-resident as the database grows.
 * - `locking_mode = EXCLUSIVE`   — locks the file to this process, removing OS
 *                                  lock/unlock syscalls from every transaction.
 * - `temp_store = MEMORY`        — temp tables/indices never touch disk.
 * - `mmap_size = 256MB`          — reads go through the OS page cache via mmap instead
 *                                  of read() syscalls.
 * - `wal_autocheckpoint = 2000`  — larger checkpoint interval (~8MB WAL) so checkpoints
 *                                  are rare; an idle-time PASSIVE checkpoint in
 *                                  maintenance.ts keeps the WAL small without ever
 *                                  stalling a writer.
 * - `busy_timeout = 5000`        — belt-and-braces; with exclusive locking it never fires.
 * - `foreign_keys = ON`          — referential integrity for cascading deletes.
 */
export function openDatabase(
  dbPath: string,
  options: ConnectionOptions = {},
): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -64000");
  if (options.exclusiveLocking !== false) {
    db.pragma("locking_mode = EXCLUSIVE");
  }
  db.pragma("temp_store = MEMORY");
  db.pragma("mmap_size = 268435456");
  db.pragma("wal_autocheckpoint = 2000");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  return db;
}

/** The SQLite library version actually linked (expected: 3.53.4). */
export function sqliteVersion(db: Database.Database): string {
  const row = db.prepare("SELECT sqlite_version() AS version").get() as
    | { version?: string }
    | undefined;
  return row?.version ?? "unknown";
}
