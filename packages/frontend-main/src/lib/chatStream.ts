import { openChatStream } from "@/lib/api";
import { parseSSEStream } from "@/lib/sse";
import { delay, isAbortError, isOnline, reconnectBackoff, waitUntilOnline } from "@/lib/net";
import type { SSEEventData, StreamRequest } from "@/types";

export type StreamPhase = "connecting" | "streaming" | "reconnecting" | "offline";

/** Terminal outcome of a run's client stream. */
export type StreamResult =
  | "done" // backend emitted `done`
  | "gone" // backend has no such run (finished + evicted, or restarted) — stop cleanly
  | "aborted" // explicit user cancellation
  | "error"; // fatal error on the very first connect of a fresh turn

export interface RunChatStreamOptions {
  chatId: string;
  /**
   * Full start payload for a fresh turn. Omit for a pure reconnect/resume — then the backend
   * attaches to the already-running agent instead of starting a new one.
   */
  start?: StreamRequest;
  /** Resume cursor: replay events after this id. -1 = from the very beginning. */
  initialSinceId: number;
  /** Aborted ONLY on explicit user cancellation. A disconnect/refresh never aborts the agent. */
  signal: AbortSignal;
  onEvent: (event: string, data: SSEEventData) => void;
  onPhase?: (phase: StreamPhase) => void;
  /** Called whenever the resume cursor advances, so callers can persist it durably. */
  onCursor?: (lastEventId: number) => void;
}

/**
 * Drive a chat stream with automatic, indefinite reconnection.
 *
 * Design guarantees:
 *  - No client-side timeout: a slow trickle (even < 1 KB/s) keeps the stream alive.
 *  - A dropped/closed stream (without `done`) transparently reconnects from the last event id,
 *    so no tokens are lost or duplicated.
 *  - When the device is offline we wait for `online` rather than failing; the agent keeps
 *    running on the backend the whole time.
 *  - Only an explicit user abort (or a run the backend no longer knows about) ends the loop.
 */
export async function runChatStream(opts: RunChatStreamOptions): Promise<StreamResult> {
  const { chatId, start, signal, onEvent, onPhase, onCursor } = opts;
  let sinceId = opts.initialSinceId;
  let attempt = 0;
  let firstConnect = true;

  while (true) {
    if (signal.aborted) return "aborted";

    // Wait for connectivity before attempting — don't burn attempts while the interface is down.
    if (!isOnline()) {
      onPhase?.("offline");
      try {
        await waitUntilOnline(signal);
      } catch {
        return "aborted";
      }
    }

    onPhase?.(firstConnect ? "connecting" : "reconnecting");

    let res: Response;
    try {
      const body: StreamRequest =
        start && firstConnect
          ? { ...start, since_event_id: sinceId }
          : { chat_id: chatId, since_event_id: sinceId };
      res = await openChatStream(body, signal);
    } catch (error) {
      if (isAbortError(error)) return "aborted";
      // Failed to even open the connection → transient. Back off (or wait for online) and retry.
      firstConnect = false;
      if (!(await backoff(attempt++, signal, onPhase))) return "aborted";
      continue;
    }

    if (!res.ok) {
      // The very first connect of a fresh turn failing is a real, user-visible error
      // (bad request, provider/auth failure) — surface it and stop.
      if (start && firstConnect) {
        const text = await res.text().catch(() => "");
        onEvent("error", { message: text || `Request failed (${res.status})` });
        return "error";
      }
      // A reconnect getting a 4xx means the backend has no such live run — stop cleanly.
      if (res.status >= 400 && res.status < 500) {
        await res.body?.cancel().catch(() => {});
        return "gone";
      }
      // 5xx → transient; retry.
      await res.body?.cancel().catch(() => {});
      firstConnect = false;
      if (!(await backoff(attempt++, signal, onPhase))) return "aborted";
      continue;
    }

    // Connected successfully — reset backoff and stream.
    attempt = 0;
    onPhase?.("streaming");
    let sawDone = false;

    try {
      await parseSSEStream(
        res,
        ({ event, data }) => {
          if (typeof data._event_id === "number") {
            sinceId = data._event_id;
            onCursor?.(sinceId);
          }
          if (event === "done") sawDone = true;
          onEvent(event, data);
        },
        signal,
      );
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return "aborted";
      // Read failed mid-stream (connection dropped). Fall through to reconnect from `sinceId`.
    }

    if (signal.aborted) return "aborted";
    if (sawDone) return "done";

    // Stream closed without `done` → the connection dropped while the agent is still running.
    // Reconnect from the last event id we applied (incremental — no re-render of prior tokens).
    firstConnect = false;
    if (!(await backoff(attempt++, signal, onPhase))) return "aborted";
  }
}

/** Pause between reconnect attempts; waits for `online` if offline. Returns false if aborted. */
async function backoff(
  attempt: number,
  signal: AbortSignal,
  onPhase?: (phase: StreamPhase) => void,
): Promise<boolean> {
  try {
    if (!isOnline()) {
      onPhase?.("offline");
      await waitUntilOnline(signal);
    } else {
      onPhase?.("reconnecting");
      await delay(reconnectBackoff(attempt), signal);
    }
    return true;
  } catch {
    return false;
  }
}
