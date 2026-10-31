/**
 * Structured error used across the LSP subsystem. It carries a stable machine
 * readable `code` so the `lsp` tool can surface actionable failures (missing
 * server, timeout, invalid position, ...) instead of a generic message.
 */
export class LspError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "LspError";
    this.code = code;
    this.details = details;
  }
}

/** Narrow an unknown thrown value to an {@link LspError}. */
export function isLspError(error: unknown): error is LspError {
  return error instanceof LspError;
}

/** Human readable message for an unknown thrown value. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Convert any thrown value into an {@link LspError} with a fallback code. */
export function toLspError(error: unknown, fallbackCode = "lsp_error"): LspError {
  if (isLspError(error)) return error;
  return new LspError(fallbackCode, messageOf(error));
}