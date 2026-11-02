import type { ImageModel } from "../types.js";

/**
 * Shared helpers for image provider adapters: URL/format normalization,
 * base64 decoding, and defensive JSON field extraction. Kept dependency-free
 * so every adapter can reuse them.
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
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/** MIME type for an image container format (defaults to image/png). */
export function mimeForFormat(format: string): string {
  return FORMAT_MIME[(format ?? "").trim().toLowerCase()] ?? "image/png";
}

/** Guess the image format from a response Content-Type. */
export function formatFromContentType(contentType: string, fallback = "png"): string {
  const value = (contentType ?? "").toLowerCase();
  if (value.includes("jpeg") || value.includes("jpg")) return "jpeg";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  if (value.includes("bmp")) return "bmp";
  if (value.includes("svg")) return "svg";
  if (value.includes("png")) return "png";
  return fallback;
}

/** The file extension for an image format (jpg normalizes to jpeg). */
export function extensionForFormat(format: string): string {
  const value = (format ?? "").trim().toLowerCase();
  if (value === "jpeg" || value === "jpg") return "jpg";
  return value || "png";
}

/** Decode base64 (optionally a `data:` URI) into bytes. */
export function decodeBase64(value: string): Uint8Array {
  const text = (value ?? "").trim();
  const comma = text.indexOf(",");
  const payload = text.startsWith("data:") && comma !== -1 ? text.slice(comma + 1) : text;
  return new Uint8Array(Buffer.from(payload, "base64"));
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

/** Normalize a raw `/models` item into an ImageModel, or null when it has no id. */
export function toModel(item: unknown): ImageModel | null {
  if (typeof item === "string") {
    const id = item.trim();
    return id ? { id, name: id } : null;
  }
  const record = asRecord(item);
  if (!record) return null;
  const id = pickString(record, "id", "name", "model");
  if (!id) return null;
  const name = pickString(record, "name", "label") || id;
  return { id, name };
}

/** Fallback ImageModel list from plain id strings. */
export function fallbackModels(ids: readonly string[]): ImageModel[] {
  return ids.map((id) => ({ id, name: id }));
}

/** The width/height for an aspect ratio, scaled to a bounding box (default 1024). */
export function sizeForAspectRatio(ratio: string | undefined, base = 1024): { width: number; height: number } {
  switch ((ratio ?? "1:1").trim()) {
    case "16:9":
      return { width: Math.round(base * (16 / 9)), height: base };
    case "9:16":
      return { width: base, height: Math.round(base * (16 / 9)) };
    case "4:3":
      return { width: Math.round(base * (4 / 3)), height: base };
    case "3:4":
      return { width: base, height: Math.round(base * (4 / 3)) };
    default:
      return { width: base, height: base };
  }
}

/** A provider-supported aspect ratio, or "1:1" when the value is unsupported. */
export function clampAspectRatio(ratio: string | undefined, supported: readonly string[]): string {
  const value = (ratio ?? "").trim();
  if (value && supported.includes(value)) return value;
  return supported.includes("1:1") ? "1:1" : supported[0]!;
}

/** Detect an image format from its magic bytes, falling back to the provided value. */
export function detectImageFormat(bytes: Uint8Array, fallback = "png"): string {
  if (bytes.length >= 8) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return "png";
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
    // GIF: "GIF8"
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return "gif";
    }
    // BMP: "BM"
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  }
  if (bytes.length >= 12) {
    // WEBP: "RIFF"...."WEBP"
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return "webp";
    }
  }
  return fallback;
}
