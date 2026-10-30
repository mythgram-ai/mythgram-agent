import type { AcpTurnDescriptor } from "./types.js";

/**
 * Thin HTTP/SSE client the ACP stdio bridge uses to reach the running Mythgram
 * backend. It never holds provider keys: the backend resolves the full turn from
 * the persisted app-state (the same documents the web console writes) and streams
 * the standard turn events, which the bridge translates into ACP `session/update`
 * notifications.
 */

export interface AcpPromptParams {
  /** The chat/session id (reused across turns of one ACP session for continuity). */
  chatId: string;
  /** The flattened user message. */
  text: string;
  /** Aborted when the client sends `session/cancel`. */
  signal: AbortSignal;
  /** Called for every SSE event of the turn (event name + decoded data). */
  onEvent: (event: string, data: Record<string, unknown>) => void;
}

export class AcpBackendClient {
  constructor(private readonly baseUrl: string) {}

  /** Fetch the resolved turn body for the current ACP configuration. */
  async fetchTurn(): Promise<AcpTurnDescriptor> {
    const res = await fetch(`${this.baseUrl}/api/acp/turn`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Partial<AcpTurnDescriptor> & { error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? `Backend returned ${res.status}`);
    }
    if (!data.body || typeof data.body !== "object") {
      throw new Error("The backend did not return a usable ACP turn configuration.");
    }
    return {
      body: data.body as Record<string, unknown>,
      mode: (data.mode as AcpTurnDescriptor["mode"]) ?? "default",
      label: typeof data.label === "string" ? data.label : "Default Agent",
    };
  }

  /** Run one prompt turn and stream its events until it completes. */
  async prompt(params: AcpPromptParams): Promise<void> {
    const turn = await this.fetchTurn();
    const body = { ...turn.body, chat_id: params.chatId, user_message: params.text };
    const res = await fetch(`${this.baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: params.signal,
    });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Backend returned ${res.status}`);
    }
    await parseSse(res.body, params.onEvent);
  }

  /** Ask the backend to abort the running turn for a chat (best effort). */
  async abort(chatId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/chat/abort/${encodeURIComponent(chatId)}`, { method: "POST" });
    } catch {
      // Best effort — aborting the local fetch also ends the turn promptly.
    }
  }
}

/** Parse an SSE byte stream into `{ event, data }` callbacks. */
async function parseSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length === 0) {
      eventName = "";
      return;
    }
    const payload = dataLines.join("\n");
    try {
      onEvent(eventName || "message", JSON.parse(payload) as Record<string, unknown>);
    } catch {
      // Ignore malformed event payloads.
    }
    eventName = "";
    dataLines = [];
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        let line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.length === 0) {
          flush();
        } else if (line.startsWith(":")) {
          // comment / heartbeat
        } else if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        index = buffer.indexOf("\n");
      }
    }
    flush();
  } finally {
    reader.releaseLock();
  }
}
