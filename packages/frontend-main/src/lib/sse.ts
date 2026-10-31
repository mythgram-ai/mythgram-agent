import type { SSEEventData } from "@/types";

export interface SSEMessage {
  event: string;
  data: SSEEventData;
}

/**
 * Parse a `text/event-stream` body and dispatch each event. Robust to chunk boundaries and
 * CRLF line endings so tokens stream smoothly across a proxy.
 *
 * Important for resilient networking: this reader has NO timeout. It blocks on `reader.read()`
 * for as long as the connection stays open — a slow trickle of bytes (even < 1 KB/s) is fine.
 * It only returns when the server closes the stream (`done`) or the caller aborts via `signal`.
 * A closed stream is reported by returning normally; the caller decides whether to reconnect.
 */
export async function parseSSEStream(
  res: Response,
  onMessage: (message: SSEMessage) => void,
  signal: AbortSignal,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const cancel = () => {
    reader.cancel().catch(() => {});
  };
  // If the caller aborts mid-read, cancel the reader so `read()` rejects/settles promptly.
  signal.addEventListener("abort", cancel, { once: true });

  try {
    while (true) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Normalize CRLF so both "\n\n" and "\r\n\r\n" delimit events.
      buffer = buffer.replace(/\r\n/g, "\n");

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        let event = "message";
        const dataLines: string[] = [];
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          // Lines starting with ":" are SSE comments/heartbeats — ignored.
        }
        if (dataLines.length === 0) continue;
        try {
          onMessage({ event, data: JSON.parse(dataLines.join("\n")) as SSEEventData });
        } catch {
          /* ignore a malformed event frame */
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
