import type { MemoryAgentRunsRepo } from "../../database/repositories/memoryAgentRunsRepo.js";

/** Delta events merged into a single database row when they arrive back-to-back. */
const COALESCABLE = new Set(["token", "reasoning"]);

interface PendingRow {
  eventId: number;
  firstEventId: number;
  event: string;
  data: Record<string, unknown>;
}

/**
 * Batches a memory-agent run's stream events into SQLite. Consecutive token/reasoning
 * deltas are coalesced into single rows (concatenated `value`), and rows are flushed on a
 * short timer so a fast token stream produces a handful of inserts per flush instead of
 * one insert per token. Mirrors the main write queue's coalescing strategy, scoped to one run.
 */
export class MemoryAgentEventPersister {
  private pending: PendingRow[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly repo: MemoryAgentRunsRepo,
    private readonly runId: string,
    private readonly flushIntervalMs = 300,
  ) {}

  /** O(1), non-throwing — safe as a SessionEventBuffer sink on the hot path. */
  append(eventId: number, event: string, data: Record<string, unknown>): void {
    if (this.closed) return;
    try {
      const last = this.pending[this.pending.length - 1];
      if (
        last &&
        COALESCABLE.has(event) &&
        last.event === event &&
        last.eventId === eventId - 1 &&
        typeof last.data.value === "string" &&
        typeof data.value === "string"
      ) {
        last.data = { ...last.data, value: `${last.data.value}${data.value}`, _event_id: eventId };
        last.eventId = eventId;
      } else {
        // Store a copy so later coalescing never mutates the live buffer's payload.
        this.pending.push({ eventId, firstEventId: eventId, event, data: { ...data } });
      }
      if (!this.timer) {
        this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
        this.timer.unref?.();
      }
    } catch {
      // Persistence must never break live streaming.
    }
  }

  /** Write everything pending to the database (never throws). */
  flush(): void {
    if (this.pending.length === 0) return;
    const rows = this.pending;
    this.pending = [];
    try {
      this.repo.appendEvents(this.runId, rows);
    } catch {
      // best effort — a failed batch is dropped rather than breaking the run
    }
  }

  /** Final flush + stop the timer. Safe to call multiple times. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}
