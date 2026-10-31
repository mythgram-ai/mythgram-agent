import type { JsonRpcMessage } from "./types.js";

/**
 * Newline-delimited JSON-RPC 2.0 transport over stdio (the ACP stdio transport).
 * Each JSON message is written as a single line on stdout; stdin is consumed
 * line-by-line. Nothing else may be written to stdout (logs go to stderr).
 */

/** Write one JSON-RPC message (request, response, or notification) to stdout. */
export function writeMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Consume stdin line-by-line and deliver each parsed JSON-RPC message.
 * Malformed lines are ignored (never crash the connection).
 */
export function readMessages(onMessage: (message: JsonRpcMessage) => void): void {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) {
        try {
          onMessage(JSON.parse(line) as JsonRpcMessage);
        } catch {
          // Ignore malformed frames; a well-behaved client only sends valid JSON.
        }
      }
      index = buffer.indexOf("\n");
    }
  });
}
