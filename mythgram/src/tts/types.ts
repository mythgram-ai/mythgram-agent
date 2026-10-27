/**
 * Text-to-speech (TTS) engine — provider-agnostic speech synthesis.
 *
 * The engine turns text into an audio byte stream through a cloud TTS provider.
 * Two providers ship built-in (OpenRouter, KittenML) and any number of
 * user-defined OpenAI-compatible providers can be added without a code change.
 *
 *   types         — provider/voice/model/request shapes + defensive normalization
 *   configuration — static provider catalog (labels, docs, setup instructions)
 *   client        — tiny fetch wrapper (timeouts, typed errors, binary + JSON)
 *   providers/    — one adapter per backend (OpenRouter, KittenML, custom)
 *   registry      — resolve a stored config into a live provider adapter
 *   store         — persistent provider configs over the SQLite app_state repo
 *   manager       — lifecycle: list/configure providers, list voices, synthesize
 */

/** Every provider kind the engine understands. */
export const TTS_PROVIDER_KINDS = [
  "openrouter",
  "kittenml",
  "sarvam",
  "azure",
  "elevenlabs",
  "google",
  "gradium",
  "inworld",
  "minimax",
  "volcengine",
  "xai",
  "mimo",
  "localtts",
  "custom",
] as const;

export type TtsProviderKind = (typeof TTS_PROVIDER_KINDS)[number];

/** Provider kinds that ship built-in (as opposed to user-added custom providers). */
export const TTS_BUILTIN_KINDS = [
  "openrouter",
  "kittenml",
  "sarvam",
  "azure",
  "elevenlabs",
  "google",
  "gradium",
  "inworld",
  "minimax",
  "volcengine",
  "xai",
  "mimo",
  "localtts",
] as const;

export type TtsBuiltinKind = (typeof TTS_BUILTIN_KINDS)[number];

export function isTtsProviderKind(value: unknown): value is TtsProviderKind {
  return (
    typeof value === "string" &&
    (TTS_PROVIDER_KINDS as readonly string[]).includes(value.trim().toLowerCase())
  );
}

export function isTtsBuiltinKind(value: unknown): value is TtsBuiltinKind {
  return (
    typeof value === "string" &&
    (TTS_BUILTIN_KINDS as readonly string[]).includes(value.trim().toLowerCase())
  );
}

/** Output audio container formats the engine knows how to file-name. */
export const TTS_OUTPUT_FORMATS = ["mp3", "wav", "flac", "aac", "opus", "pcm"] as const;

export type TtsOutputFormat = (typeof TTS_OUTPUT_FORMATS)[number];

export function isTtsOutputFormat(value: unknown): value is TtsOutputFormat {
  return (
    typeof value === "string" &&
    (TTS_OUTPUT_FORMATS as readonly string[]).includes(value.trim().toLowerCase())
  );
}

/** One user-defined HTTP header pair (custom providers only). */
export interface TtsHeader {
  key: string;
  value: string;
}

/**
 * A persisted TTS provider configuration. Built-in providers have exactly one
 * record (id === kind); custom providers can have many (id = `tts_<random>`).
 *
 * The API key is stored server-side only and is never served to the browser
 * (see toPublicTtsProvider). The base URL may be overridden by the user for
 * built-ins and is required for custom providers (localhost is allowed).
 */
export interface TtsProviderConfig {
  id: string;
  kind: TtsProviderKind;
  /** Human-friendly name shown in the panel. */
  name: string;
  enabled: boolean;
  /** Bearer credential; server-side only. Empty for keyless/local servers. */
  apiKey: string;
  /** API base URL (no trailing slash). */
  baseUrl: string;
  /** Last selected / default model. */
  model: string;
  /** Last selected / default voice. */
  voice: string;
  /** BCP-47 language code / locale, when the provider needs one (e.g. en-US, en-IN, auto). */
  language: string;
  /** Preferred output format; empty means "provider default". */
  responseFormat: string;
  /** Extra HTTP headers merged into every request (custom providers). */
  headers: TtsHeader[];
  /** Manually declared models (custom providers, when /models is unavailable). */
  models: string[];
  /** Manually declared voices (custom providers, since there is no listing API). */
  voices: string[];
  createdAt: number;
  updatedAt: number;
}

/** Browser-safe projection of a provider config (the API key is never included). */
export interface TtsProviderPublic {
  id: string;
  kind: TtsProviderKind;
  name: string;
  enabled: boolean;
  baseUrl: string;
  model: string;
  voice: string;
  language: string;
  responseFormat: string;
  headers: TtsHeader[];
  models: string[];
  voices: string[];
  /** True when a key is stored server-side (or provided by env for a built-in). */
  hasApiKey: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Untrusted over-the-wire / stored shape. Accepts both snake_case and camelCase. */
export interface TtsProviderWire {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  enabled?: unknown;
  api_key?: unknown;
  apiKey?: unknown;
  base_url?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  voice?: unknown;
  language?: unknown;
  language_code?: unknown;
  locale?: unknown;
  response_format?: unknown;
  responseFormat?: unknown;
  headers?: unknown;
  models?: unknown;
  voices?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "yes" || value === "on" || value === 1) return true;
  if (value === false || value === "no" || value === "off" || value === 0) return false;
  return fallback;
}

/** Normalize an untrusted header list, dropping empty/invalid and Content-Type entries. */
export function normalizeHeaders(raw: unknown): TtsHeader[] {
  const out: TtsHeader[] = [];
  const push = (key: unknown, value: unknown): void => {
    const k = str(key).trim();
    const v = str(value).trim();
    if (!k || k.toLowerCase().startsWith("content-type")) return;
    out.push({ key: k, value: v });
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        push(record.key ?? record.name, record.value);
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) push(key, value);
  }
  return out;
}

/** Normalize an untrusted string list (models / voices), de-duplicated and bounded. */
export function normalizeStringList(raw: unknown, limit = 500): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const value = str(item).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value.slice(0, 200));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Defensively normalize an untrusted provider payload (wire or stored) into a
 * well-formed TtsProviderConfig, or `null` when unusable (unknown kind).
 */
export function normalizeTtsProvider(
  raw: unknown,
  defaults: { id: string; now: number },
): TtsProviderConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as TtsProviderWire;
  const kindRaw = str(r.kind).trim().toLowerCase();
  if (!isTtsProviderKind(kindRaw)) return null;
  const responseFormat = str(r.response_format ?? r.responseFormat).trim().toLowerCase();
  return {
    id: str(r.id).trim().slice(0, 80) || defaults.id,
    kind: kindRaw,
    name: str(r.name).trim().slice(0, 70) || kindRaw,
    enabled: bool(r.enabled, true),
    apiKey: str(r.api_key ?? r.apiKey).trim(),
    baseUrl: str(r.base_url ?? r.baseUrl).trim().replace(/\/+$/, ""),
    model: str(r.model).trim(),
    voice: str(r.voice).trim(),
    language: str(r.language ?? r.language_code ?? r.locale).trim(),
    responseFormat: isTtsOutputFormat(responseFormat) ? responseFormat : "",
    headers: normalizeHeaders(r.headers),
    models: normalizeStringList(r.models),
    voices: normalizeStringList(r.voices),
    createdAt: num(r.created_at ?? r.createdAt, defaults.now),
    updatedAt: num(r.updated_at ?? r.updatedAt, defaults.now),
  };
}

/** Strip the API key before serving a provider config to the browser. */
export function toPublicTtsProvider(
  config: TtsProviderConfig,
  hasApiKey: boolean,
): TtsProviderPublic {
  return {
    id: config.id,
    kind: config.kind,
    name: config.name,
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    voice: config.voice,
    language: config.language,
    responseFormat: config.responseFormat,
    headers: config.headers,
    models: config.models,
    voices: config.voices,
    hasApiKey,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

/** One selectable voice returned by a provider. */
export interface TtsVoice {
  id: string;
  /** Display name (falls back to the id). */
  name: string;
  /** ISO 639-1 language code when the provider supplies one. */
  language?: string;
  /** Provider-assigned type (e.g. "built_in", "custom", "public"). */
  type?: string;
  /** The model this voice belongs to. */
  model?: string;
}

/** One TTS model returned by a provider. */
export interface TtsModel {
  id: string;
  /** Display name (falls back to the id). */
  name: string;
  /** Voices advertised for this model, when the provider exposes them. */
  voices: TtsVoice[];
  /** Languages the model/voices cover, when known. */
  languages: string[];
}

/** Raw audio + metadata produced by one synthesis request. */
export interface TtsAudioResult {
  bytes: Uint8Array;
  /** MIME type of the returned audio. */
  contentType: string;
  /** Container format (best-effort, from the request or the content type). */
  format: string;
  /** The model that served the request, when the provider reports it. */
  model: string;
}

/** Options shared by provider listing calls. */
export interface TtsListOptions {
  apiKey: string;
  baseUrl?: string;
  /** BCP-47 language/locale hint for providers that scope listings by language. */
  language?: string;
  signal?: AbortSignal;
}

/** Options for one synthesis request. */
export interface TtsSynthesizeOptions extends TtsListOptions {
  model: string;
  input: string;
  voice?: string;
  responseFormat?: string;
  speed?: number;
  instructions?: string;
}
