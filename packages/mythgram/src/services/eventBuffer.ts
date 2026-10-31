export interface BufferedEvent {
  id: number;
  event: string;
  data: Record<string, unknown>;
}

/**
 * Append-only event buffer that lets one producer (the agent loop) push SSE events and
 * multiple consumers subscribe — with replay from any event id so clients can reconnect
 * without losing tokens. This is what makes the streaming resilient for a 24/7 harness.
 */
export class SessionEventBuffer {
  private readonly events: BufferedEvent[] = [];
  private done = false;
  private waiters: Array<() => void> = [];

  /**
   * @param sink Optional persistence hook invoked for every appended event (the
   *             database write queue). It must be O(1) and non-throwing on the hot
   *             path — a failure to persist must never break live streaming.
   */
  constructor(private readonly sink?: (id: number, event: string, data: Record<string, unknown>) => void) {}

  append(event: string, data: Record<string, unknown>): number {
    const id = this.events.length;
    const payload = { _event_id: id, ...data };
    this.events.push({ id, event, data: payload });
    if (this.sink) {
      try {
        this.sink(id, event, payload);
      } catch {
        // Persistence must never break live streaming.
      }
    }
    this.notify();
    return id;
  }

  setDone(): void {
    this.done = true;
    this.notify();
  }

  get isDone(): boolean {
    return this.done;
  }

  get lastEventId(): number {
    return this.events.length - 1;
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  private wait(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== onSignal);
        resolve();
      }, timeoutMs);
      const onSignal = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.push(onSignal);
    });
  }

  /** Async iterator over events from `sinceId` (exclusive), replaying history then live-tailing. */
  async *subscribe(sinceId = -1): AsyncGenerator<BufferedEvent, void, unknown> {
    let cursor = sinceId;
    while (true) {
      while (cursor + 1 < this.events.length) {
        cursor += 1;
        yield this.events[cursor]!;
      }
      if (this.done) {
        // Flush anything that arrived between the last check and done.
        while (cursor + 1 < this.events.length) {
          cursor += 1;
          yield this.events[cursor]!;
        }
        return;
      }
      await this.wait(15_000);
    }
  }
}
