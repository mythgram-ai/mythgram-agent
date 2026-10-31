import type { TtsModel, TtsVoice } from "../types.js";

/**
 * Shared helpers for provider adapters: URL/format normalization, base64/hex
 * decoding, and defensive JSON field extraction. Kept dependency-free so every
 * adapter (OpenAI-compatible or bespoke wire protocol) can reuse them.
 */

/** Trim a base URL and strip trailing slashes. */
export function stripTrailingSlash(url: string): string {
  return (url ?? "").trim().replace(/\/+$/, "");
}

/** The base URL for a request (per-call override wins over the runtime value). */
export function resolveBase(runtimeBase: string, override?: string): string {
  return stripTrailingSlash(override || runtimeBase);
}

const FORMAT_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  pcm: "audio/pcm",
  pcm16: "audio/pcm",
  linear16: "audio/wav",
  ulaw: "audio/basic",
  alaw: "audio/basic",
  mulaw: "audio/basic",
};

/** MIME type for a container format (defaults to audio/mpeg). */
export function mimeForFormat(format: string): string {
  return FORMAT_MIME[(format ?? "").trim().toLowerCase()] ?? "audio/mpeg";
}

/** Guess the container format from a response Content-Type. */
export function formatFromContentType(contentType: string, fallback: string): string {
  const value = (contentType ?? "").toLowerCase();
  if (value.includes("mpeg") || value.includes("mp3")) return "mp3";
  if (value.includes("wav")) return "wav";
  if (value.includes("flac")) return "flac";
  if (value.includes("aac")) return "aac";
  if (value.includes("ogg") || value.includes("opus")) return "opus";
  if (value.includes("pcm") || value.includes("l16")) return "pcm";
  return fallback;
}

/** Decode base64 (optionally a `data:` URI) into bytes. */
export function decodeBase64(value: string): Uint8Array {
  const text = (value ?? "").trim();
  const comma = text.indexOf(",");
  const payload = text.startsWith("data:") && comma !== -1 ? text.slice(comma + 1) : text;
  return new Uint8Array(Buffer.from(payload, "base64"));
}

/** Decode a hex-encoded audio string into bytes. */
export function decodeHex(value: string): Uint8Array {
  return new Uint8Array(Buffer.from((value ?? "").trim(), "hex"));
}

/** True when the value is a non-empty record. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The first non-empty string among the given keys, or "". */
export function pickString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** The first array among the given keys, or []. */
export function pickArray(record: Record<string, unknown>, ...keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** Build a TtsVoice from a provider voice object, or null when it has no id. */
export function toVoice(
  raw: unknown,
  modelId: string,
  idKeys: string[],
  nameKeys: string[],
  languageKeys: string[],
): TtsVoice | null {
  if (typeof raw === "string") {
    const id = raw.trim();
    return id ? { id, name: id, model: modelId || undefined } : null;
  }
  const record = asRecord(raw);
  if (!record) return null;
  const id = pickString(record, ...idKeys);
  if (!id) return null;
  const name = pickString(record, ...nameKeys) || id;
  const voice: TtsVoice = { id, name };
  const language = pickString(record, ...languageKeys);
  if (language) voice.language = language;
  if (modelId) voice.model = modelId;
  return voice;
}

/** Fallback TtsModel list from plain id strings. */
export function fallbackModels(ids: readonly string[]): TtsModel[] {
  return ids.map((id) => ({ id, name: id, voices: [], languages: [] }));
}

/** Escape the five XML metacharacters for SSML text. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
