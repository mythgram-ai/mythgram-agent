import type Database from "better-sqlite3";
import { openDatabase, resolveDatabasePath, sqliteVersion } from "./connection.js";
import { applySchema } from "./schema.js";
import { DatabaseWriteQueue } from "./writeQueue.js";
import { DatabaseMaintenance } from "./maintenance.js";
import { SessionsRepo } from "./repositories/sessionsRepo.js";
import { MessagesRepo } from "./repositories/messagesRepo.js";
import { EventsRepo } from "./repositories/eventsRepo.js";
import { SubAgentRunsRepo } from "./repositories/subAgentRunsRepo.js";
import { SnapshotsRepo } from "./repositories/snapshotsRepo.js";
import { AppStateRepo } from "./repositories/appStateRepo.js";
import { MemoryAgentRunsRepo } from "./repositories/memoryAgentRunsRepo.js";
import { SchedulesRepo } from "./repositories/schedulesRepo.js";
import { ScheduleRunsRepo } from "./repositories/scheduleRunsRepo.js";
import { ChannelChatsRepo } from "./repositories/channelChatsRepo.js";
import { ChannelMessagesRepo } from "./repositories/channelMessagesRepo.js";

export {
  createChatSessionId,
  createSubAgentSessionId,
  createCustomAgentId,
  createMainAgentPromptId,
  createUserProfileId,
  createScheduleId,
  createScheduleRunId,
  isSafeSessionId,
} from "./ids.js";
import { createChatSessionId as createChatSessionIdFn, isSafeSessionId as isSafeSessionIdFn } from "./ids.js";
export { resolveDatabasePath, MYTHGRAM_DATA_DIR, DATABASE_FILE_NAME } from "./connection.js";
export { APP_STATE_KEYS, isAppStateKey, type AppStateKey } from "./repositories/appStateRepo.js";
export type { SessionRow } from "./repositories/sessionsRepo.js";
export type { StoredStreamEvent } from "./repositories/eventsRepo.js";
export type { SubAgentRunRow } from "./repositories/subAgentRunsRepo.js";
export type { ScheduleRow, ScheduleRecord } from "./repositories/schedulesRepo.js";
export type {
  ScheduleRunRow,
  ScheduleRunStatus,
  ScheduleRunTrigger,
} from "./repositories/scheduleRunsRepo.js";
export type {
  MemoryAgentRunRow,
  MemoryAgentRunStatus,
  MemoryAgentRunCounts,
  StoredMemoryAgentEvent,
} from "./repositories/memoryAgentRunsRepo.js";
export type { ChannelChatRow } from "./repositories/channelChatsRepo.js";

/**
 * The application's persistence facade. Everything the system produces — main-agent
 * streaming, sub-agent streaming, tool calls + results, transcripts, UI snapshots,
 * settings/API keys, skills, knowledge, memory, custom sub-agents — is stored here,
 * in a single SQLite (3.53.4) database at `<workspace>/.mythgram/mythgram.db` that is
 * created automatically on boot.
 */
export class MythgramDatabase {
  readonly sessions: SessionsRepo;
  readonly messages: MessagesRepo;
  readonly events: EventsRepo;
  readonly subAgentRuns: SubAgentRunsRepo;
  readonly snapshots: SnapshotsRepo;
  readonly appState: AppStateRepo;
  readonly memoryAgentRuns: MemoryAgentRunsRepo;
  readonly schedules: SchedulesRepo;
  readonly scheduleRuns: ScheduleRunsRepo;
  readonly channelChats: ChannelChatsRepo;
  readonly channelMessages: ChannelMessagesRepo;
  readonly queue: DatabaseWriteQueue;

  private readonly maintenance: DatabaseMaintenance;
  private closed = false;

  private constructor(
    private readonly db: Database.Database,
    readonly path: string,
  ) {
    this.sessions = new SessionsRepo(db);
    this.messages = new MessagesRepo(db);
    this.events = new EventsRepo(db);
    this.subAgentRuns = new SubAgentRunsRepo(db);
    this.snapshots = new SnapshotsRepo(db);
    this.appState = new AppStateRepo(db);
    this.memoryAgentRuns = new MemoryAgentRunsRepo(db);
    this.schedules = new SchedulesRepo(db);
    this.scheduleRuns = new ScheduleRunsRepo(db);
    this.channelChats = new ChannelChatsRepo(db);
    this.channelMessages = new ChannelMessagesRepo(db);
    this.queue = new DatabaseWriteQueue(db);
    this.maintenance = new DatabaseMaintenance(db);
  }

  /** Open (creating if needed) the database for a workspace and start maintenance. */
  static open(workspaceRoot: string): MythgramDatabase {
    const dbPath = resolveDatabasePath(workspaceRoot);
    const exclusive = process.env.MYTHGRAM_DB_EXCLUSIVE !== "0";
    const db = openDatabase(dbPath, { exclusiveLocking: exclusive });
    applySchema(db);

    const instance = new MythgramDatabase(db, dbPath);
    // After a restart nothing can still be running.
    instance.sessions.resetRunningFlags();
    instance.memoryAgentRuns.failInterrupted();
    instance.schedules.resetRunningFlags();
    instance.scheduleRuns.failInterrupted();
    instance.maintenance.start();

    // eslint-disable-next-line no-console
    console.log(`[mythgram-db] SQLite ${sqliteVersion(db)} ready at ${dbPath}`);
    return instance;
  }

  /** SQLite library version in use. */
  get version(): string {
    return sqliteVersion(this.db);
  }

  /**
   * Fork a chat session: create a new session that is a full 100% copy of the
   * source session's stored data (transcript, stream events, tool calls, UI
   * snapshot). Global app-state (settings, memory, skills, teams, ...) is shared
   * by design, so the fork automatically runs with the same settings.
   *
   * Sub-agent run rows are intentionally NOT copied: their ids are globally
   * unique (PK on id alone) and the UI snapshot already embeds the full inline
   * sub-agent history, so the fork renders identically without PK conflicts.
   * Returns the new session row, or null when the source does not exist.
   */
  forkSession(sourceId: string, opts?: { newId?: string; title?: string }): import("./repositories/sessionsRepo.js").SessionRow | null {
    try {
      this.queue.flushSync();
    } catch {
      // best effort — copy whatever is already persisted
    }
    const source = this.sessions.get(sourceId);
    if (!source) return null;

    let newId = typeof opts?.newId === "string" ? opts.newId.trim() : "";
    if (!isSafeSessionIdFn(newId) || this.sessions.get(newId)) {
      do {
        newId = createChatSessionIdFn();
      } while (this.sessions.get(newId));
    }
    const title =
      typeof opts?.title === "string" && opts.title.trim().length > 0
        ? opts.title.slice(0, 200)
        : source.title;
    const now = Date.now();

    const db = this.db;
    const copyTx = db.transaction(() => {
      db.prepare(
        `INSERT INTO sessions (id, title, running, turn_count, last_event_id, message_count, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
      ).run(newId, title, source.turnCount, source.lastEventId, source.messageCount, now, now);
      db.prepare(
        `INSERT INTO messages (session_id, seq, role, data, created_at)
         SELECT ?, seq, role, data, created_at FROM messages WHERE session_id = ?`,
      ).run(newId, sourceId);
      db.prepare(
        `INSERT INTO stream_events (session_id, turn, event_id, first_event_id, event, data, created_at)
         SELECT ?, turn, event_id, first_event_id, event, data, created_at
         FROM stream_events WHERE session_id = ?`,
      ).run(newId, sourceId);
      db.prepare(
        `INSERT INTO tool_calls (session_id, tool_call_id, sub_agent_run_id, name, label, args, ok, result, created_at, finished_at)
         SELECT ?, tool_call_id, sub_agent_run_id, name, label, args, ok, result, created_at, finished_at
         FROM tool_calls WHERE session_id = ?`,
      ).run(newId, sourceId);
    });
    try {
      copyTx();
    } catch {
      return null;
    }

    try {
      const snapshot = this.snapshots.get(sourceId) as unknown as Record<string, unknown> | null;
      if (snapshot && typeof snapshot === "object") {
        let cloned: Record<string, unknown>;
        try {
          cloned = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
        } catch {
          cloned = { ...(snapshot as Record<string, unknown>) };
        }
        cloned.id = newId;
        if (typeof cloned.title === "string") cloned.title = title;
        cloned.updatedAt = now;
        this.snapshots.set(newId, cloned);
      }
    } catch {
      // snapshot copy is best-effort — transcript + session row already copied
    }

    return this.sessions.get(newId) ?? null;
  }

  /** Flush pending writes and close cleanly (safe to call multiple times). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.queue.close();
    } catch {
      // best effort
    }
    this.maintenance.stop();
    try {
      this.db.close();
    } catch {
      // best effort
    }
  }
}
