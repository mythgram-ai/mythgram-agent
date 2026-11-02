/**
 * Image generation engine — provider-agnostic text-to-image.
 *
 * The engine turns a text prompt into an image byte stream through a cloud or
 * keyless image provider. Built-in providers ship for OpenRouter, MiniMax,
 * Google Gemini, Clipdrop, Pollinations, and NVIDIA; any number of user-defined
 * OpenAI-compatible providers can be added without a code change.
 *
 *   types         — provider/model/request shapes + defensive normalization
 *   configuration — static provider catalog (labels, docs, setup instructions)
 *   client        — tiny fetch wrapper (timeouts, typed errors, JSON + binary)
 *   providers/    — one adapter per backend
 *   registry      — resolve a stored config into a live provider adapter
 *   store         — persistent provider configs over the SQLite app_state repo
 *   manager       — lifecycle: list/configure providers, list models, generate
 */

/** Every provider kind the engine understands. */
export const IMAGE_PROVIDER_KINDS = [
  "openrouter",
  "minimax",
  "gemini",
  "clipdrop",
  "pollinations",
  "nvidia",
  "custom",
] as const;

export type ImageProviderKind = (typeof IMAGE_PROVIDER_KINDS)[number];

/** Provider kinds that ship built-in (as opposed to user-added custom providers). */
export const IMAGE_BUILTIN_KINDS = [
  "openrouter",
  "minimax",
  "gemini",
  "clipdrop",
  "pollinations",
  "nvidia",
] as const;

export type ImageBuiltinKind = (typeof IMAGE_BUILTIN_KINDS)[number];

export function isImageProviderKind(value: unknown): value is ImageProviderKind {
  return (
    typeof value === "string" &&
    (IMAGE_PROVIDER_KINDS as readonly string[]).includes(value.trim().toLowerCase())
  );
}

export function isImageBuiltinKind(value: unknown): value is ImageBuiltinKind {
  return (
    typeof value === "string" &&
    (IMAGE_BUILTIN_KINDS as readonly string[]).includes(value.trim().toLowerCase())
  );
}

/** Aspect ratios the engine exposes to the LLM and the panel. */
export const IMAGE_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export function isImageAspectRatio(value: unknown): value is ImageAspectRatio {
  return (
    typeof value === "string" &&
    (IMAGE_ASPECT_RATIOS as readonly string[]).includes(value.trim() as ImageAspectRatio)
  );
}

/** One user-defined HTTP header pair (custom providers only). */
export interface ImageHeader {
  key: string;
  value: string;
}

/**
 * A persisted image provider configuration. Built-in providers have exactly one
 * record (id === kind); custom providers can have many (id = `img_<random>`).
 *
 * The API key is stored server-side only and is never served to the browser
 * (see toPublicImageProvider). The base URL may be overridden by the user for
 * built-ins and is required for custom providers (localhost is allowed).
 */
export interface ImageProviderConfig {
  id: string;
  kind: ImageProviderKind;
  /** Human-friendly name shown in the panel. */
  name: string;
  enabled: boolean;
  /** Bearer credential; server-side only. Empty for keyless providers. */
  apiKey: string;
  /** API base URL (no trailing slash). */
  baseUrl: string;
  /** Last selected / default model. */
  model: string;
  /** Last selected / default aspect ratio. */
  aspectRatio: ImageAspectRatio;
  /** Extra HTTP headers merged into every request (custom providers). */
  headers: ImageHeader[];
  /** Manually declared models (custom providers, when /models is unavailable). */
  models: string[];
  createdAt: number;
  updatedAt: number;
}

/** Browser-safe projection of a provider config (the API key is never included). */
export interface ImageProviderPublic {
  id: string;
  kind: ImageProviderKind;
  name: string;
  enabled: boolean;
  baseUrl: string;
  model: string;
  aspectRatio: ImageAspectRatio;
  headers: ImageHeader[];
  models: string[];
  /** True when a key is stored server-side (or provided by env for a built-in). */
  hasApiKey: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Agent-driven image preferences (the `generate_image` tool). Configured in the
 * image panel. An empty `providerId` means "auto" — the manager picks the best
 * available provider. The other fields override the chosen provider's defaults.
 */
export interface ImageAgentConfig {
  /** Provider id to always use, or "" to auto-select the best available provider. */
  providerId: string;
  model: string;
  aspectRatio: ImageAspectRatio;
}

/** Defensively normalize an untrusted agent-image payload into an ImageAgentConfig. */
export function normalizeImageAgentConfig(raw: unknown): ImageAgentConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ratio = str(r.aspectRatio ?? r.aspect_ratio).trim();
  return {
    providerId: str(r.providerId ?? r.provider_id).trim().slice(0, 80),
    model: str(r.model).trim(),
    aspectRatio: isImageAspectRatio(ratio) ? ratio : "1:1",
  };
}

/** Untrusted over-the-wire / stored shape. Accepts both snake_case and camelCase. */
export interface ImageProviderWire {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  enabled?: unknown;
  api_key?: unknown;
  apiKey?: unknown;
  base_url?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  aspect_ratio?: unknown;
  aspectRatio?: unknown;
  headers?: unknown;
  models?: unknown;
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
export function normalizeImageHeaders(raw: unknown): ImageHeader[] {
  const out: ImageHeader[] = [];
  const push = (key: unknown, value: unknown): void => {
    const k = str(key).trim();
    if (!k || k.toLowerCase().startsWith("content-type")) return;
    out.push({ key: k, value: str(value).trim() });
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

/** Normalize an untrusted string list (models), de-duplicated and bounded. */
export function normalizeImageStringList(raw: unknown, limit = 500): string[] {
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
 * well-formed ImageProviderConfig, or `null` when unusable (unknown kind).
 */
export function normalizeImageProvider(
  raw: unknown,
  defaults: { id: string; now: number },
): ImageProviderConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as ImageProviderWire;
  const kindRaw = str(r.kind).trim().toLowerCase();
  if (!isImageProviderKind(kindRaw)) return null;
  const ratio = str(r.aspect_ratio ?? r.aspectRatio).trim();
  return {
    id: str(r.id).trim().slice(0, 80) || defaults.id,
    kind: kindRaw,
    name: str(r.name).trim().slice(0, 70) || kindRaw,
    enabled: bool(r.enabled, true),
    apiKey: str(r.api_key ?? r.apiKey).trim(),
    baseUrl: str(r.base_url ?? r.baseUrl).trim().replace(/\/+$/, ""),
    model: str(r.model).trim(),
    aspectRatio: isImageAspectRatio(ratio) ? ratio : "1:1",
    headers: normalizeImageHeaders(r.headers),
    models: normalizeImageStringList(r.models),
    createdAt: num(r.created_at ?? r.createdAt, defaults.now),
    updatedAt: num(r.updated_at ?? r.updatedAt, defaults.now),
  };
}

/** Strip the API key before serving a provider config to the browser. */
export function toPublicImageProvider(
  config: ImageProviderConfig,
  hasApiKey: boolean,
): ImageProviderPublic {
  return {
    id: config.id,
    kind: config.kind,
    name: config.name,
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    aspectRatio: config.aspectRatio,
    headers: config.headers,
    models: config.models,
    hasApiKey,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

/** One selectable image model returned by a provider. */
export interface ImageModel {
  id: string;
  /** Display name (falls back to the id). */
  name: string;
}

/** Raw image + metadata produced by one generation request. */
export interface ImageRawResult {
  bytes: Uint8Array;
  /** MIME type of the returned image. */
  contentType: string;
  /** Container format (best-effort, e.g. png, jpeg, webp). */
  format: string;
  /** The model that served the request, when the provider reports it. */
  model: string;
}

/** Options shared by provider listing calls. */
export interface ImageListOptions {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

/** Options for one generation request. */
export interface ImageGenerateOptions extends ImageListOptions {
  model: string;
  prompt: string;
  aspectRatio?: string;
}
