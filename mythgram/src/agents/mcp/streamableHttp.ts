/**
 * Streamable HTTP transport for MCP (spec 2025-06-18 § Transports).
 *
 * Every JSON-RPC message is a fresh HTTP POST to the MCP endpoint with
 * `Accept: application/json, text/event-stream`. A request resolves to either
 * a single JSON response or an SSE stream whose `data:` frames are JSON-RPC
 * messages (the frame carrying our request `id` is the response; anything else
 * is a server notification/request we acknowledge and ignore for tool calls).
 *
 * Session handling: when the server returns `Mcp-Session-Id` on the initialize
 * response, it is sent back on every later request plus the negotiated
 * `MCP-Protocol-Version` header. A 404 on a sessioned request means the session
 * died — the client re-initializes once and retries.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SESSION_HEADER = "Mcp-Session-Id";
export const MCP_VERSION_HEADER = "MCP-Protocol-Version";

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly wwwAuthenticate?: string,
  ) {
    super(message);
    this.name = "McpHttpError";
  }
}

export interface StreamableHttpOptions {
  url: string;
  /** Extra headers merged into every request (auth, custom headers). */
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function timeoutSignal(parent: AbortSignal | undefined, ms: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

/** Parse SSE `data:` frames out of a response body (tolerant of chunk splits). */
async function readSseFrames(body: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: unknown[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLines: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        const text = dataLines.join("\n");
        if (text === "[DONE]") continue;
        try {
          frames.push(JSON.parse(text) as unknown);
        } catch {
          // ignore a malformed frame, keep reading
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return frames;
}

function errorMessage(status: number, text: string): string {
  const snippet = text.slice(0, 300).trim();
  try {
    const parsed = JSON.parse(snippet) as { error?: { message?: string }; message?: string };
    const inner = parsed?.error?.message ?? parsed?.message;
    if (typeof inner === "string" && inner.trim()) return `HTTP ${status}: ${inner.trim().slice(0, 300)}`;
  } catch {
    // fall through to the raw snippet
  }
  return snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`;
}

export class StreamableHttpTransport {
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private closed = false;

  constructor(private readonly options: StreamableHttpOptions) {}

  get hasSession(): boolean {
    return this.sessionId !== null;
  }

  /** POST one JSON-RPC message; resolves the matching response (or null for 202s). */
  async post(message: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<JsonRpcResponse | null> {
    if (this.closed) throw new Error("The MCP HTTP transport is closed.");
    const id = (message.id as string | number | null | undefined) ?? null;
    const timeoutMs = opts?.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { signal, cleanup } = timeoutSignal(this.options.signal, timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.options.headers ?? {}),
    };
    if (this.sessionId) headers[MCP_SESSION_HEADER] = this.sessionId;
    if (this.protocolVersion) headers[MCP_VERSION_HEADER] = this.protocolVersion;

    let res: Response;
    try {
      res = await fetch(this.options.url, { method: "POST", headers, body: JSON.stringify(message), signal });
    } catch (error) {
      if (signal.aborted && this.options.signal?.aborted) throw new Error("The MCP request was aborted.");
      throw new Error(`Could not reach the MCP server: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      cleanup();
    }

    if (res.status === 401) {
      throw new McpHttpError(401, "The MCP server requires authentication (HTTP 401).", res.headers.get("www-authenticate") ?? undefined);
    }
    if (res.status === 404 && this.sessionId) {
      const err = new McpHttpError(404, "The MCP session expired (HTTP 404).");
      (err as { sessionExpired?: boolean }).sessionExpired = true;
      throw err;
    }
    if (res.status === 202 || res.status === 204) {
      await res.arrayBuffer().catch(() => undefined);
      return null;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new McpHttpError(res.status, errorMessage(res.status, text));
    }

    // Adopt the session id when the server issues one (initialize response).
    const session = res.headers.get(MCP_SESSION_HEADER);
    if (session && session.trim()) this.sessionId = session.trim();

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("text/event-stream")) {
      if (!res.body) throw new Error("The MCP server opened an empty SSE stream.");
      const frames = await readSseFrames(res.body);
      for (const frame of frames) {
        const candidate = frame as Partial<JsonRpcResponse>;
        if (candidate && typeof candidate === "object" && "id" in candidate && candidate.id === id) {
          return candidate as JsonRpcResponse;
        }
      }
      throw new Error("The MCP SSE stream closed without a response to our request.");
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`The MCP server returned non-JSON: ${text.slice(0, 200)}`);
    }
    if (!parsed || typeof parsed !== "object" || !("id" in (parsed as Record<string, unknown>))) {
      throw new Error("The MCP server returned an unexpected response shape.");
    }
    return parsed as JsonRpcResponse;
  }

  /** Remember the negotiated protocol version (sent on every later request). */
  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  /** Best-effort session termination (DELETE), then mark closed. */
  async close(): Promise<void> {
    this.closed = true;
    if (!this.sessionId) return;
    try {
      const headers: Record<string, string> = { ...(this.options.headers ?? {}) };
      headers[MCP_SESSION_HEADER] = this.sessionId;
      await fetch(this.options.url, { method: "DELETE", headers, signal: AbortSignal.timeout(5000) });
    } catch {
      // best effort — the session expires server-side on its own
    } finally {
      this.sessionId = null;
    }
  }
}

/** True when an error means "the session died — re-initialize and retry once". */
export function isSessionExpiredError(error: unknown): boolean {
  return (
    error instanceof McpHttpError &&
    (error as { sessionExpired?: boolean }).sessionExpired === true
  );
}
