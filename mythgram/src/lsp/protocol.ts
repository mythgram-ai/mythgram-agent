/**
 * Minimal JSON-RPC 2.0 framing for the Language Server Protocol.
 *
 * LSP messages are UTF-8 JSON bodies prefixed with HTTP-like headers and a
 * blank line. The only required header is `Content-Length`, measured in bytes.
 */

/** A decoded JSON-RPC message. Fields are optional because notifications,
 * requests, and responses all share the same envelope. */
export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/** Encode a JSON-RPC message into an LSP transport frame. */
export function encodeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, body]);
}

/**
 * Incremental frame parser. Feed it raw stdout chunks; it returns every complete
 * JSON-RPC message and retains partial data for the next chunk.
 */
export class MessageBuffer {
  private buffer: Buffer = Buffer.alloc(0);

  /** Number of bytes of an incomplete message currently buffered. */
  get pendingBytes(): number {
    return this.buffer.length;
  }

  /** Parse and return all complete messages from `chunk`. Throws on malformed frames. */
  push(chunk: Buffer): JsonRpcMessage[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const messages: JsonRpcMessage[] = [];

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const contentLength = parseContentLength(header);
      if (contentLength === null) {
        // Drop the malformed header so the stream can recover on the next frame.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        throw new Error("Malformed LSP frame: missing or invalid Content-Length header.");
      }

      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.length < bodyEnd) break;

      const body = this.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.subarray(bodyEnd);

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (error) {
        throw new Error(
          `Malformed LSP frame: invalid JSON body (${error instanceof Error ? error.message : String(error)}).`,
        );
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Malformed LSP frame: JSON body must be an object.");
      }
      messages.push(parsed as JsonRpcMessage);
    }

    return messages;
  }
}

function parseContentLength(header: string): number | null {
  for (const line of header.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (name !== "content-length") continue;
    const value = Number.parseInt(line.slice(colon + 1).trim(), 10);
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  }
  return null;
}