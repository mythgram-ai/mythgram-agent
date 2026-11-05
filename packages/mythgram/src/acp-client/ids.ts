import crypto from "node:crypto";
import { ACP_NUMERIC_ID_PATTERN } from "./types.js";

/**
 * ACP client ids are ALWAYS minted by this application, never by the connected
 * agent:
 *  - every configured connection gets its own 20-digit numeric id;
 *  - every chat session gets its own 20-digit numeric id.
 *
 * The connected agent's internal session id is stored separately and is never
 * exposed to the browser.
 */

const ID_LENGTH = 20;

/** Generate a cryptographically-random 20-digit numeric id. */
export function createAcpNumericId(): string {
  const bytes = crypto.randomBytes(ID_LENGTH);
  let out = "";
  for (let i = 0; i < ID_LENGTH; i += 1) out += String(bytes[i]! % 10);
  return out;
}

/** True when a value is an exact 20-digit numeric id minted by this app. */
export function isAcpNumericId(value: unknown): value is string {
  return typeof value === "string" && ACP_NUMERIC_ID_PATTERN.test(value);
}

/** Create an id that is not already in `taken` (collision check is best-effort). */
export function createUniqueAcpId(taken: (id: string) => boolean = () => false): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = createAcpNumericId();
    if (!taken(id)) return id;
  }
  // 10^20 space: reaching this is practically impossible; still guarantee a shape.
  return createAcpNumericId();
}

/** Short opaque id for pending permission/elicitation requests (not user-facing). */
export function createPendingRequestId(): string {
  return crypto.randomBytes(10).toString("hex");
}