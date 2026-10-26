import type Database from "better-sqlite3";

/**
 * DatabaseWriteQueue — the ONLY path through which streaming-rate data reaches SQLite.
 *
 * Why it exists: the agent can emit 10,000-100,000+ tokens/second (and dozens of
 * sub-agents can stream concurrently). Writing each delta synchronously would block
 * the event loop and freeze the app + device. Instead:
 *
 * 1. `enqueueEvent()` is O(1) and allocation-light: it appends to an in-memory list.
 *    No JSON serialization, no SQLite call, no disk I/O on the hot path.
 * 2. Consecutive token/reasoning deltas of the same stream are COALESCED in memory:
 *    a whole flush window of a 100k tok/s stream collapses into a single row whose
 *    `value` is the concatenated text and whose (first_event_id, event_id) records
 *    the covered range. Ordering is preserved: any structural event (tool call,
 *    sub-agent boundary, ...) closes the open coalescing buckets for that session.
 * 3. A timer flushes every FLUSH_INTERVAL_MS inside ONE WAL transaction using
 *    prepared statements — sequential appends, no fsync on the caller's path
 *    (synchronous=NORMAL). Large backlogs are written in chunks with event-loop
 *    yields between chunks so the server never stalls, even under a burst.
 *
 * The same flush also derives the structured `tool_calls` and `sub_agent_runs` rows
 * from the event stream, so structured records cost nothing on the hot path either.
 */

/** Delta events that may be coalesced into a single row per flush window. */
const COALESCABLE = new Set(["token", "reasoning", "sub_agent_token", "sub_agent_reasoning"]);

const FLUSH_INTERVAL_MS = 200;
/** Force an immediate (next-tick) flush when this many rows are pending. */
const HIGH_WATER_ROWS = 8_000;
/** Max rows written per transaction chunk before yielding back to the event loop. */
const CHUNK_ROWS = 2_000;

interface PendingEvent {
  sessionId: string;
  turn: number;
  /** Last event id covered by this row. */
  eventId: number;
  /** First event id covered by this row (== eventId unless coalesced). */
  firstEventId: number;
  event: string;
  /** For coalesced rows the `value` field is accumulated separately in `text`. */
  data: Record<string, unknown>;
  /** Accumulated delta text for coalescable events. */
  text?: string;
  createdAt: number;
}

interface PendingMessages {
  sessionId: string;
  messages: unknown[];
  updatedAt: number;
}

export class DatabaseWriteQueue {
  private pendingEvents: PendingEvent[] = [];
  /**
   * Open coalescing buckets indexed per session, so closing one session's buckets on a
   * structural event is a single Map delete instead of a scan over every live stream.
   * Inner key: "<event> <subAgentToolId>".
   */
  private coalesceHeads = new Map<string, Map<string, PendingEvent>>();
  private pendingMessages = new Map<string, PendingMessages>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private closed = false;

  private readonly insertEvent: Database.Statement;
  private readonly upsertToolCall: Database.Statement;
  private readonly finishToolCall: Database.Statement;
  private readonly insertSubAgentRun: Database.Statement;
  private readonly finishSubAgentRun: Database.Statement;
  private readonly deleteMessages: Database.Statement;
  private readonly insertMessage: Database.Statement;
  private readonly updateMessageCount: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertEvent = db.prepare(
      `INSERT OR REPLACE INTO stream_events
         (session_id, turn, event_id, first_event_id, event, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.upsertToolCall = db.prepare(
      `INSERT INTO tool_calls (session_id, tool_call_id, sub_agent_run_id, name, label, args, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, tool_call_id) DO UPDATE SET
         name = excluded.name, label = excluded.label, args = excluded.args,
         sub_agent_run_id = COALESCE(excluded.sub_agent_run_id, tool_calls.sub_agent_run_id)`,
    );
    this.finishToolCall = db.prepare(
      `INSERT INTO tool_calls (session_id, tool_call_id, sub_agent_run_id, name, label, ok, result, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, tool_call_id) DO UPDATE SET
         ok = excluded.ok, result = excluded.result, finished_at = excluded.finished_at,
         name = CASE WHEN excluded.name != '' THEN excluded.name ELSE tool_calls.name END,
         label = COALESCE(excluded.label, tool_calls.label)`,
    );
    this.insertSubAgentRun = db.prepare(
      `INSERT INTO sub_agent_runs (id, session_id, turn, tool_call_id, agent, task, background, status, output_file, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         agent = excluded.agent, task = excluded.task, background = excluded.background,
         tool_call_id = excluded.tool_call_id,
         output_file = COALESCE(excluded.output_file, sub_agent_runs.output_file)`,
    );
    this.finishSubAgentRun = db.prepare(
      `UPDATE sub_agent_runs SET status = ?, output = ?, error = ?, finished_at = ? WHERE id = ?`,
    );
    this.deleteMessages = db.prepare(`DELETE FROM messages WHERE session_id = ?`);
    this.insertMessage = db.prepare(
      `INSERT INTO messages (session_id, seq, role, data, created_at) VALUES (?, ?, ?, ?, ?)`,
    );
    this.updateMessageCount = db.prepare(
      `UPDATE sessions SET message_count = ? WHERE id = ?`,
    );
  }

  /** Rows waiting to be flushed (for observability/tests). */
  get pendingCount(): number {
    return this.pendingEvents.length + this.pendingMessages.size;
  }

  /**
   * Record one SSE event. O(1), no serialization, no I/O — safe at any token rate.
   * Consecutive deltas of the same stream are merged in place.
   */
  enqueueEvent(
    sessionId: string,
    turn: number,
    eventId: number,
    event: string,
    data: Record<string, unknown>,
  ): void {
    if (this.closed) return;

    if (COALESCABLE.has(event)) {
      // Sub-agent deltas coalesce per sub-agent (keyed by the parent tool-call id).
      const subId = typeof data.id === "string" ? (data.id as string) : "";
      const key = `${event} ${subId}`;
      const sessionHeads = this.coalesceHeads.get(sessionId);
      const head = sessionHeads?.get(key);
      const value = typeof data.value === "string" ? (data.value as string) : "";
      if (head && head.turn === turn) {
        head.text! += value;
        head.eventId = eventId;
        return;
      }
      const row: PendingEvent = {
        sessionId,
        turn,
        eventId,
        firstEventId: eventId,
        event,
        data,
        text: value,
        createdAt: Date.now(),
      };
      if (sessionHeads) sessionHeads.set(key, row);
      else this.coalesceHeads.set(sessionId, new Map([[key, row]]));
      this.pendingEvents.push(row);
      this.schedule();
      return;
    }

    // A structural event closes every open delta bucket for this session so the
    // persisted order stays faithful to what actually streamed.
    this.coalesceHeads.delete(sessionId);

    this.pendingEvents.push({
      sessionId,
      turn,
      eventId,
      firstEventId: eventId,
      event,
      data,
      createdAt: Date.now(),
    });
    this.schedule();
  }

  /** Queue a full transcript replacement for a session (last write wins). */
  enqueueMessages(sessionId: string, messages: unknown[]): void {
    if (this.closed) return;
    this.pendingMessages.set(sessionId, {
      sessionId,
      messages: messages.slice(),
      updatedAt: Date.now(),
    });
    this.schedule();
  }

  /** Flush everything synchronously (shutdown path). */
  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.pendingEvents.length > 0 || this.pendingMessages.size > 0) {
      this.flushChunk(Number.MAX_SAFE_INTEGER);
    }
  }

  /** Stop accepting writes and flush the backlog. */
  close(): void {
    this.flushSync();
    this.closed = true;
  }

  private schedule(): void {
    if (this.pendingEvents.length >= HIGH_WATER_ROWS) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      setImmediate(() => this.flushAsync());
      return;
    }
    if (this.timer || this.flushing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushAsync();
    }, FLUSH_INTERVAL_MS);
    // Never keep the process alive just for a pending flush.
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  /** Flush in bounded chunks, yielding to the event loop between chunks. */
  private flushAsync(): void {
    if (this.flushing || this.closed) return;
    this.flushing = true;
    const step = (): void => {
      try {
        this.flushChunk(CHUNK_ROWS);
      } catch (error) {
        // Persistence must never take down streaming; drop the failed chunk and log.
        // eslint-disable-next-line no-console
        console.error("[mythgram-db] flush failed:", error);
      }
      if (this.pendingEvents.length > 0 || this.pendingMessages.size > 0) {
        setImmediate(step);
        return;
      }
      // Anything enqueued after this point schedules its own timer via enqueue*().
      this.flushing = false;
    };
    step();
  }

  private flushChunk(maxRows: number): void {
    const events = this.pendingEvents.splice(0, maxRows);
    // Any head that was taken out of pending must stop accumulating (O(rows + heads)).
    if (this.coalesceHeads.size > 0 && events.length > 0) {
      const taken = new Set<PendingEvent>(events);
      for (const [sessionId, sessionHeads] of this.coalesceHeads) {
        for (const [key, head] of sessionHeads) {
          if (taken.has(head)) sessionHeads.delete(key);
        }
        if (sessionHeads.size === 0) this.coalesceHeads.delete(sessionId);
      }
    }

    const messages = Array.from(this.pendingMessages.values());
    this.pendingMessages.clear();

    if (events.length === 0 && messages.length === 0) return;

    const write = this.db.transaction(() => {
      for (const row of events) {
        const payload =
          row.text !== undefined ? { ...row.data, value: row.text } : row.data;
        let json: string;
        try {
          json = JSON.stringify(payload);
        } catch {
          json = "{}";
        }
        this.insertEvent.run(
          row.sessionId,
          row.turn,
          row.eventId,
          row.firstEventId,
          row.event,
          json,
          row.createdAt,
        );
        this.deriveStructured(row);
      }

      for (const entry of messages) {
        this.deleteMessages.run(entry.sessionId);
        this.updateMessageCount.run(entry.messages.length, entry.sessionId);
        for (let seq = 0; seq < entry.messages.length; seq += 1) {
          const message = entry.messages[seq] as Record<string, unknown> | null;
          if (!message || typeof message !== "object") continue;
          let json: string;
          try {
            json = JSON.stringify(message);
          } catch {
            continue;
          }
          this.insertMessage.run(
            entry.sessionId,
            seq,
            typeof message.role === "string" ? (message.role as string) : "unknown",
            json,
            entry.updatedAt,
          );
        }
      }
    });
    write();
  }

  /** Derive structured tool_calls / sub_agent_runs rows from the raw event stream. */
  private deriveStructured(row: PendingEvent): void {
    const data = row.data;
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    const json = (v: unknown): string | null => {
      if (v === undefined || v === null) return null;
      try {
        return typeof v === "string" ? v : JSON.stringify(v);
      } catch {
        return null;
      }
    };

    switch (row.event) {
      case "tool_call":
        this.upsertToolCall.run(
          row.sessionId,
          str(data.id) || `tool_${row.turn}_${row.eventId}`,
          null,
          str(data.name),
          str(data.label) || null,
          json(data.args),
          row.createdAt,
        );
        break;
      case "tool_result":
        this.finishToolCall.run(
          row.sessionId,
          str(data.id) || `tool_${row.turn}_${row.eventId}`,
          null,
          str(data.name),
          str(data.label) || null,
          data.ok === false ? 0 : 1,
          json(data.result),
          row.createdAt,
          row.createdAt,
        );
        break;
      case "sub_agent_tool_call":
        this.upsertToolCall.run(
          row.sessionId,
          str(data.tool_id) || `subtool_${row.turn}_${row.eventId}`,
          str(data.sub_session_id) || null,
          str(data.name),
          str(data.label) || null,
          json(data.args),
          row.createdAt,
        );
        break;
      case "sub_agent_tool_result":
        this.finishToolCall.run(
          row.sessionId,
          str(data.tool_id) || `subtool_${row.turn}_${row.eventId}`,
          str(data.sub_session_id) || null,
          str(data.name),
          str(data.label) || null,
          data.ok === false ? 0 : 1,
          json(data.result),
          row.createdAt,
          row.createdAt,
        );
        break;
      case "sub_agent_start":
      case "sub_agent_background_started": {
        const runId = str(data.sub_session_id);
        if (!runId) break;
        this.insertSubAgentRun.run(
          runId,
          row.sessionId,
          row.turn,
          str(data.id),
          str(data.agent),
          str(data.task),
          row.event === "sub_agent_background_started" || data.background === true ? 1 : 0,
          str(data.output_file) || null,
          row.createdAt,
        );
        break;
      }
      case "sub_agent_done": {
        const runId = str(data.sub_session_id);
        if (!runId) break;
        const status =
          data.aborted === true ? "aborted" : data.ok === true ? "completed" : "failed";
        this.finishSubAgentRun.run(
          status,
          str(data.output),
          str(data.error) || null,
          row.createdAt,
          runId,
        );
        break;
      }
      default:
        break;
    }
  }
}
