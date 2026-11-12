import type { ComboEntry, ComboSettings } from "./types.js";

/** A combo requires at least this many entries to take effect. */
export const MIN_COMBO_ENTRIES = 2;
/** Upper bound on the number of combo entries (guards against abuse). */
const MAX_ENTRIES = 20;
/** Longest API key / model / URL we persist (guards against oversized payloads). */
const MAX_FIELD = 8_192;

/** A fresh mutable copy of the default combo settings (combo OFF, no entries). */
export function defaultComboSettings(): ComboSettings {
  return { enabled: false, entries: [] };
}

/** Boolean coercion that understands the frontend's "yes"/"no" settings shape. */
function toBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "yes" || value === "on" || value === 1 || value === "true") return true;
  if (value === false || value === "no" || value === "off" || value === 0 || value === "false") return false;
  return fallback;
}

function toText(value: unknown): string {
  return (typeof value === "string" ? value : "").slice(0, MAX_FIELD);
}

/** Read the first defined alias for a field (camelCase preferred, snake_case accepted). */
function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

/**
 * Coerce one untrusted entry into a {@link ComboEntry}, or null when it has no
 * usable provider id. Never throws.
 */
function coerceEntry(raw: unknown, index: number): ComboEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const provider = toText(pick(record, "provider")).trim();
  if (!provider) return null;
  const baseUrl = toText(pick(record, "baseUrl", "base_url")).trim();
  return {
    id: toText(pick(record, "id")).trim() || `combo_${index}`,
    provider,
    model: toText(pick(record, "model")).trim(),
    apiKey: toText(pick(record, "apiKey", "api_key")).trim(),
    baseUrl: baseUrl || undefined,
    customProvider: pick(record, "customProvider", "custom_provider"),
  };
}

/** Coerce an untrusted entry list (drops invalid entries, caps the length). */
function coerceEntries(raw: unknown): ComboEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ComboEntry[] = [];
  for (let i = 0; i < raw.length && out.length < MAX_ENTRIES; i++) {
    const entry = coerceEntry(raw[i], i);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Defensively normalize a combo payload from the wire (or persisted state) into a
 * valid {@link ComboSettings}. Never throws; absent fields fall back to the
 * defaults (combo OFF, no entries).
 */
export function sanitizeComboSettings(raw: unknown): ComboSettings {
  const defaults = defaultComboSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const record = raw as Record<string, unknown>;
  const comboId = toText(pick(record, "comboId", "combo_id", "id")).trim();
  const name = toText(pick(record, "name")).trim();
  return {
    enabled: toBoolean(record.enabled, defaults.enabled),
    comboId: comboId || undefined,
    name: name || undefined,
    entries: "entries" in record ? coerceEntries(record.entries) : defaults.entries,
  };
}

/** Entries without a model are meaningless — skip them rather than guess a model. */
export function usableComboEntries(settings: ComboSettings): ComboEntry[] {
  return settings.entries.filter((entry) => entry.model.trim().length > 0);
}

/** A combo is usable only when it is enabled and has enough valid (model-bearing) entries. */
export function comboIsUsable(settings: ComboSettings): boolean {
  return settings.enabled && usableComboEntries(settings).length >= MIN_COMBO_ENTRIES;
}
