import { SessionEventBuffer } from "../services/eventBuffer.js";
import { SessionStore } from "../services/sessionStore.js";
import type {
  LiveRun,
  RunningSessionInfo,
  StartRunOptions,
} from "./types.js";

/**
 * Multi-session system.
 *
 * The application can drive many chat sessions at once: each chat id gets its own
 * provider transcript, its own append-only event buffer, and its own abort
 * controller. Starting a new chat (or a new turn in another chat) never touches a
 * run that is already streaming — only the SAME chat's previous turn is replaced
 * (rapid resend semantics), exactly like the single-session behavior but scoped to
 * one chat instead of the whole process.
 *
 * This manager extends {@link SessionStore} (the in-memory transcript map) with the
 * run registry: it is the single place that decides which chats are running, hands
 * out buffers/abort controllers, and settles turns without leaking state.
 */
export class SessionManager extends SessionStore {
  private readonly runs = new Map<string, LiveRun>();

  /**
   * Begin a new turn for `chatId`. Any turn already running for the SAME chat is
   * aborted first (a resend replaces its own turn); other chats are never affected.
   * Returns the fresh run so the caller can stream onto its buffer.
   */
  startRun(chatId: string, options: StartRunOptions = {}): LiveRun {
    const session = this.getOrCreate(chatId);

    // Replace only this chat's previous turn — concurrent chats keep streaming.
    const existing = this.runs.get(chatId);
    if (existing) {
      existing.abortController.abort();
      existing.buffer.setDone();
      this.runs.delete(chatId);
    }

    const buffer = new SessionEventBuffer(options.sink);
    const abortController = new AbortController();
    session.eventBuffer = buffer;
    session.abortController = abortController;
    session.running = true;

    const run: LiveRun = {
      chatId,
      session,
      buffer,
      abortController,
      startedAt: Date.now(),
    };
    this.runs.set(chatId, run);
    return run;
  }

  /** The live run for a chat, if one is currently streaming. */
  getRun(chatId: string): LiveRun | undefined {
    return this.runs.get(chatId);
  }

  /** Whether a turn is currently streaming for this chat. */
  isRunning(chatId: string): boolean {
    return this.runs.has(chatId);
  }

  /** Every chat currently streaming, for the "running sessions" surface. */
  runningSessions(): RunningSessionInfo[] {
    const out: RunningSessionInfo[] = [];
    for (const run of this.runs.values()) {
      out.push({
        chatId: run.chatId,
        startedAt: run.startedAt,
        lastEventId: run.buffer.lastEventId,
      });
    }
    return out;
  }

  /**
   * Abort the running turn for one chat (user "Stop"). Siblings are untouched.
   * Returns false when the chat had no live run.
   */
  abortRun(chatId: string): boolean {
    const run = this.runs.get(chatId);
    const session = this.get(chatId);
    if (!run && !session?.running) return false;
    if (run) {
      run.abortController.abort();
      run.buffer.setDone();
      this.runs.delete(chatId);
    }
    if (session) session.running = false;
    return true;
  }

  /**
   * Mark a run finished. Guards against stale settles: a late `.finally` from a run
   * that was already replaced by a newer turn for the same chat is ignored (returns
   * false) so it can never clear the new run's state. Returns true when this buffer
   * was still the chat's current run.
   */
  finishRun(chatId: string, buffer: SessionEventBuffer): boolean {
    const run = this.runs.get(chatId);
    if (run && run.buffer !== buffer) return false;
    const session = this.get(chatId);
    if (session) session.running = false;
    this.runs.delete(chatId);
    return true;
  }
}
