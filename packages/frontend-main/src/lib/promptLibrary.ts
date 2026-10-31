import type { PromptLibraryItem } from "@/types";

/**
 * Prompt Library — user-saved reusable prompts.
 *
 * Each entry has a title, an optional short description (both unlimited in
 * length), and the prompt text itself. Entries persist in the backend SQLite
 * database via the shared app-state sync (`promptLibrary`), exactly like
 * Custom Agents / task modes. This module owns the defensive normalization,
 * the 20-character id generation (mirroring the backend), and the blank
 * scaffold for the create form.
 */

/** Alphabet matching the backend 20-char ids: 0-9a-zA-Z. */
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Length of every prompt-library id (matches the backend requirement). */
export const PROMPT_LIBRARY_ID_LENGTH = 20;

/**
 * Generate a 20-character prompt-library id. Uses crypto randomness when
 * available; 62^20 possible values.
 */
export function newPromptLibraryId(length = PROMPT_LIBRARY_ID_LENGTH): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  }
  return out;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Defensive normalize of one stored/loaded entry into a well-formed value, or null when unusable. */
export function normalizePromptLibraryItem(raw: unknown): PromptLibraryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  const title = (str(r.title) || str(r.name)).trim();
  const content = (str(r.content) || str(r.prompt) || str(r.text)).trim();
  if (!id || (!title && !content)) return null;
  return {
    id,
    title: title || "(untitled)",
    description: (str(r.description) || str(r.short_description) || str(r.shortDescription)).trim(),
    content,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

/** Normalize a persisted array of entries, dropping malformed entries and duplicate ids. */
export function normalizePromptLibrary(raw: unknown): PromptLibraryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PromptLibraryItem[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const entry = normalizePromptLibraryItem(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

/** A blank entry scaffold for the create form. */
export function blankPromptLibraryItem(): Omit<PromptLibraryItem, "id" | "createdAt" | "updatedAt"> {
  return { title: "", description: "", content: "" };
}
