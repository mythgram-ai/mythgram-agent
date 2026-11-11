import type { FallbackMethod, FallbackSettings, FallbackTarget } from "./types.js";

/** Upper bound on the number of fallback targets per chain (guards against abuse). */
const MAX_TARGETS = 20;
/** Longest API key / model / URL we persist (guards against oversized payloads). */
const MAX_FIELD = 8_192;

/** A fresh mutable copy of the default fallback settings (fallback OFF, method "api"). */
export function defaultFallbackSettings(): FallbackSettings {
  return { enabled: false, method: "api", providers: [], apis: [] };
}

/** Boolean coercion that understands the frontend's "yes"/"no" settings shape. */
function toBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "yes" || value === "on" || value === 1 || value === "true") return true;
  if (value === false || value === "no" || value === "off" || value === 0 || value === "false") return false;
  return fallback;
}

/** Only the two known methods are accepted; anything else falls back to "api". */
function coerceMethod(value: unknown, fallback: FallbackMethod): FallbackMethod {
  return value === "provider" || value === "api" ? value : fallback;
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
 * Coerce one untrusted target into a {@link FallbackTarget}, or null when it has
 * no usable provider id. Never throws.
 */
function coerceTarget(raw: unknown, index: number): FallbackTarget | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const provider = toText(pick(record, "provider")).trim();
  if (!provider) return null;
  const baseUrl = toText(pick(record, "baseUrl", "base_url")).trim();
  return {
    id: toText(pick(record, "id")).trim() || `fallback_${index}`,
    provider,
    model: toText(pick(record, "model")).trim(),
    apiKey: toText(pick(record, "apiKey", "api_key")).trim(),
    baseUrl: baseUrl || undefined,
    customProvider: pick(record, "customProvider", "custom_provider"),
  };
}

/** Coerce an untrusted target list (drops invalid entries, caps the length). */
function coerceTargets(raw: unknown): FallbackTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: FallbackTarget[] = [];
  for (let i = 0; i < raw.length && out.length < MAX_TARGETS; i++) {
    const target = coerceTarget(raw[i], i);
    if (target) out.push(target);
  }
  return out;
}

/**
 * Defensively normalize a fallback payload from the wire (or persisted state)
 * into a valid {@link FallbackSettings}. Never throws; absent fields fall back to
 * the defaults (fallback OFF, method "api").
 */
export function sanitizeFallbackSettings(raw: unknown): FallbackSettings {
  const defaults = defaultFallbackSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const record = raw as Record<string, unknown>;
  return {
    enabled: toBoolean(record.enabled, defaults.enabled),
    method: coerceMethod(record.method ?? record.strategy, defaults.method),
    providers: "providers" in record ? coerceTargets(record.providers) : defaults.providers,
    apis: "apis" in record ? coerceTargets(record.apis) : defaults.apis,
  };
}

/** The ordered fallback chain for the currently selected method. */
export function fallbackActiveTargets(settings: FallbackSettings): FallbackTarget[] {
  return settings.method === "provider" ? settings.providers : settings.apis;
}

/** Total number of configured fallback targets for the active method. */
export function fallbackTargetCount(settings: FallbackSettings): number {
  return fallbackActiveTargets(settings).length;
}
