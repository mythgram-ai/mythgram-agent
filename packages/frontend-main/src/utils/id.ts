/** Generate a short unique id, falling back when crypto.randomUUID is unavailable. */
export function uid(prefix = ""): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${rand}` : rand;
}

/** Alphabet used for session ids: ALL the numbers (0-9) and ALL the letters (a-z, A-Z). */
const SESSION_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Generate a 20-character chat-session id (matches the backend's SQLite session ids).
 * Uses crypto randomness when available; 62^20 possible values.
 */
export function newSessionId(length = 20): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += SESSION_ID_ALPHABET[bytes[i]! % SESSION_ID_ALPHABET.length];
  }
  return out;
}
