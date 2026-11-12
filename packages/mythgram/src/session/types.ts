import type { SessionEventBuffer } from "../services/eventBuffer.js";
import type { ChatSession } from "../services/sessionStore.js";

/**
 * A single in-flight turn ("run") owned by the multi-session system.
 *
 * Every chat session runs independently: its own provider transcript, its own
 * append-only event buffer, and its own abort controller. Many runs may exist at
 * the same time — one per chat id — which is what lets the user start a second
 * task while the first is still streaming.
 */
export interface LiveRun {
  /** The chat session this run belongs to (also the event-buffer / transcript key). */
  chatId: string;
  /** The session record the runner mutates (messages, running flag, ...). */
  session: ChatSession;
  /** Append-only SSE buffer this run streams onto (supports replay + reconnects). */
  buffer: SessionEventBuffer;
  /** Aborts ONLY this run; sibling runs are untouched. */
  abortController: AbortController;
  /** Wall-clock start, surfaced to the client for "running" indicators. */
  startedAt: number;
}

/** Public, serializable description of a currently running session. */
export interface RunningSessionInfo {
  chatId: string;
  startedAt: number;
  /** Last event id appended so far (-1 before the first event). */
  lastEventId: number;
}

/** Per-event persistence hook wired into a run's buffer (the database write queue). */
export type EventSink = (
  id: number,
  event: string,
  data: Record<string, unknown>,
) => void;

/** Options accepted when starting a run. */
export interface StartRunOptions {
  /** Persistence hook invoked for every appended event (batched, off the hot path). */
  sink?: EventSink;
}
