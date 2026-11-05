import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import type {
  JsonRpcErrorObject,
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.js";
import { ACP_ERRORS } from "./types.js";

/** JSON-RPC error carrying the ACP error code/data. */
export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }

  toObject(): JsonRpcErrorObject {
    return { code: this.code, message: this.message, ...(this.data !== undefined ? { data: this.data } : {}) };
  }
}

export interface JsonRpcPeerOptions {
  /** Called for every notification (messages without an id). */
  onNotification(method: string, params: unknown): void;
  /** Called for every incoming request (messages with an id + method). */
  onRequest(method: string, params: unknown): Promise<unknown>;
  /** Called for non-protocol stdout lines some agents mistakenly log. */
  onLog?(line: string): void;
  /** Called once when the transport closes or fails. */
  onClose?(error: Error | null): void;
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

/**
 * Newline-delimited JSON-RPC 2.0 peer over a child process's stdio.
 *
 * ACP requires the agent to write one JSON message per line on stdout. Some
 * agents also emit incidental log lines; those are surfaced through `onLog`
 * and never crash the connection. Requests we send are matched by id, support
 * an optional timeout, and are rejected promptly when the process exits.
 */
export class JsonRpcPeer {
  private readonly reader: readline.Interface;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextId = 1;
  private closed = false;
  private closeNotified = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    input: Readable,
    private readonly output: Writable,
    private readonly options: JsonRpcPeerOptions,
  ) {
    this.reader = readline.createInterface({ input, crlfDelay: Infinity });
    this.reader.on("line", (line) => this.handleLine(line));
    this.reader.on("close", () => this.close(new Error("ACP agent closed its output stream.")));
    input.on("error", (error) => this.close(error));
    output.on("error", (error) => this.close(error));
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Send a request and wait for its response. */
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("ACP connection is closed."));
    }
    const id = this.nextId++;
    const message: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
    return new Promise<T>((resolve, reject) => {
      const timer =
        typeof timeoutMs === "number" && timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`ACP request "${method}" timed out after ${timeoutMs}ms.`));
            }, timeoutMs)
          : null;
      // Keep timers from holding the process open in short-lived validation.
      timer?.unref?.();
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.writeMessage(message).catch((error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  /** Send a one-way notification. */
  notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) return Promise.resolve();
    const message: JsonRpcNotification = { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) };
    return this.writeMessage(message);
  }

  /** Send `$/cancel_request` for an outgoing request (cooperative cancellation). */
  cancelRequest(id: JsonRpcId): Promise<void> {
    return this.notify("$/cancel_request", { requestId: id });
  }

  /** Close the peer, rejecting every pending request. Safe to call repeatedly. */
  close(error: Error | null = null): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.reader.close();
    } catch {
      // ignore
    }
    const reason = error ?? new Error("ACP connection closed.");
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(reason);
    }
    if (!this.closeNotified) {
      this.closeNotified = true;
      this.options.onClose?.(error);
    }
  }

  private writeMessage(message: unknown): Promise<void> {
    const line = `${JSON.stringify(message)}\n`;
    this.writeChain = this.writeChain
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            if (this.closed) {
              reject(new Error("ACP connection is closed."));
              return;
            }
            this.output.write(line, (error) => {
              if (error) reject(error);
              else resolve();
            });
          }),
      )
      .catch((error) => {
        this.close(error instanceof Error ? error : new Error(String(error)));
        throw error;
      });
    return this.writeChain;
  }

  private handleLine(rawLine: string): void {
    const line = rawLine.trim();
    if (!line) return;
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      this.options.onLog?.(line);
      return;
    }
    if (!isRecord(message)) {
      this.options.onLog?.(line);
      return;
    }

    const hasId = Object.prototype.hasOwnProperty.call(message, "id") && isValidId(message.id);
    const method = typeof message.method === "string" ? message.method : "";

    if (method && hasId) {
      void this.handleIncomingRequest(message.id as JsonRpcId, method, message.params);
      return;
    }
    if (method) {
      try {
        this.options.onNotification(method, message.params);
      } catch {
        // Notification handlers must never tear down the transport.
      }
      return;
    }
    if (hasId) {
      this.handleResponse(message as unknown as JsonRpcResponse);
      return;
    }
    this.options.onLog?.(line);
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (response.error) {
      pending.reject(
        new JsonRpcError(
          typeof response.error.code === "number" ? response.error.code : ACP_ERRORS.internalError,
          typeof response.error.message === "string" ? response.error.message : "ACP request failed.",
          response.error.data,
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  private async handleIncomingRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.options.onRequest(method, params);
      await this.writeMessage({ jsonrpc: "2.0", id, result: result ?? {} });
    } catch (error) {
      const rpcError =
        error instanceof JsonRpcError
          ? error
          : new JsonRpcError(
              ACP_ERRORS.internalError,
              error instanceof Error ? error.message : String(error),
            );
      await this.writeMessage({ jsonrpc: "2.0", id, error: rpcError.toObject() }).catch(() => undefined);
    }
  }
}