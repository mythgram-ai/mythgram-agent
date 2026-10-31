import {
  TTS_LIST_TIMEOUT_MS,
  TTS_SYNTHESIS_TIMEOUT_MS,
  ttsRequestAudio,
  ttsRequestJson,
  type TtsFetch,
} from "../client.js";
import { formatFromContentType } from "./helpers.js";
import type {
  TtsAudioResult,
  TtsListOptions,
  TtsModel,
  TtsProviderKind,
  TtsSynthesizeOptions,
  TtsVoice,
} from "../types.js";

export { formatFromContentType } from "./helpers.js";

/**
 * Runtime configuration handed to a provider adapter. It carries everything the
 * adapter needs that is not per-request: the base URL, static headers, manually
 * declared models/voices (custom providers), the preferred format, and an
 * optional fetch implementation for tests.
 */
export interface TtsProviderRuntime {
  kind: TtsProviderKind;
  name: string;
  baseUrl: string;
  headers: Record<string, string>;
  manualModels: string[];
  manualVoices: string[];
  defaultFormat: string;
  fetchFn?: TtsFetch;
}

/** The contract every provider adapter implements. */
export interface TtsProvider {
  readonly kind: TtsProviderKind;
  readonly name: string;
  listModels(options: TtsListOptions): Promise<TtsModel[]>;
  listVoices(options: TtsListOptions, model?: string): Promise<TtsVoice[]>;
  synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult>;
}

/** Coerce one provider voice entry (string or object) into a TtsVoice. */
export function toSimpleVoice(raw: unknown, modelId: string): TtsVoice | null {
  if (typeof raw === "string") {
    const id = raw.trim();
    return id ? { id, name: id, model: modelId || undefined } : null;
  }
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const id = String(record.id ?? record.voice ?? record.name ?? "").trim();
    if (!id) return null;
    const name = String(record.name ?? record.label ?? id).trim() || id;
    const voice: TtsVoice = { id, name, model: modelId || undefined };
    const language = record.language ?? record.lang;
    if (typeof language === "string" && language.trim()) voice.language = language.trim();
    if (typeof record.type === "string" && record.type.trim()) voice.type = record.type.trim();
    return voice;
  }
  return null;
}

/**
 * Shared base for every TTS adapter. It owns the runtime config and the common
 * URL/header plumbing. Concrete adapters implement `listModels`, `listVoices`,
 * and `synthesize` for their provider's wire protocol.
 */
export abstract class TtsProviderBase implements TtsProvider {
  readonly kind: TtsProviderKind;
  readonly name: string;
  protected readonly runtime: TtsProviderRuntime;

  constructor(runtime: TtsProviderRuntime) {
    this.runtime = runtime;
    this.kind = runtime.kind;
    this.name = runtime.name;
  }

  /** The base URL for this request (override wins), with trailing slashes stripped. */
  protected resolveBaseUrl(override?: string): string {
    return (override || this.runtime.baseUrl).trim().replace(/\/+$/, "");
  }

  /** Merge user-configured headers over a provider's own headers. */
  protected withRuntimeHeaders(extra: Record<string, string>): Record<string, string> {
    return { ...extra, ...this.runtime.headers };
  }

  protected fetchJson<T>(url: string, init: RequestInit, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    return ttsRequestJson<T>(url, init, {
      fetchFn: this.runtime.fetchFn,
      timeoutMs: options.timeoutMs ?? TTS_LIST_TIMEOUT_MS,
      signal: options.signal,
    });
  }

  protected fetchAudio(
    url: string,
    init: RequestInit,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<{ bytes: Uint8Array; contentType: string; headers: Headers }> {
    return ttsRequestAudio(url, init, {
      fetchFn: this.runtime.fetchFn,
      timeoutMs: options.timeoutMs ?? TTS_SYNTHESIS_TIMEOUT_MS,
      signal: options.signal,
    });
  }

  /** Fallback list from manually declared models (custom providers). */
  protected manualModels(): TtsModel[] {
    return this.runtime.manualModels.map((id) => ({ id, name: id, voices: [], languages: [] }));
  }

  abstract listModels(options: TtsListOptions): Promise<TtsModel[]>;
  abstract listVoices(options: TtsListOptions, model?: string): Promise<TtsVoice[]>;
  abstract synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult>;
}

/** Normalize a raw `/models` item into a TtsModel. */
function toModel(item: Record<string, unknown>): TtsModel | null {
  const id = String(item.id ?? item.name ?? "").trim();
  if (!id) return null;
  const name = String(item.name ?? item.id ?? id).trim() || id;
  const voices: TtsVoice[] = [];
  const rawVoices = item.supported_voices ?? item.voices;
  if (Array.isArray(rawVoices)) {
    for (const raw of rawVoices) {
      const voice = toSimpleVoice(raw, id);
      if (voice) voices.push(voice);
    }
  }
  const languages: string[] = [];
  if (Array.isArray(item.languages)) {
    for (const lang of item.languages) {
      const value = typeof lang === "string" ? lang.trim() : "";
      if (value && !languages.includes(value)) languages.push(value);
    }
  }
  return { id, name, voices, languages };
}

/**
 * Base implementation of an OpenAI-compatible text-to-speech provider.
 *
 * Speech synthesis is a single `POST {base}/audio/speech` returning a raw audio
 * byte stream — the shape shared by OpenRouter, KittenML, OpenAI and most local
 * servers. Subclasses override URL/headers/model-listing specifics.
 */
export class OpenAICompatibleTtsProvider extends TtsProviderBase {
  /** Headers for a request: JSON content type, optional Bearer auth, static extras. */
  protected requestHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = this.withRuntimeHeaders({
      "Content-Type": "application/json",
    });
    const key = (apiKey ?? "").trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  /** The models-listing URL; subclasses may append query parameters. */
  protected modelsUrl(base: string): string {
    return `${base}/models`;
  }

  /** The speech-synthesis URL. */
  protected speechUrl(base: string): string {
    return `${base}/audio/speech`;
  }

  async listModels(options: TtsListOptions): Promise<TtsModel[]> {
    const base = this.resolveBaseUrl(options.baseUrl);
    try {
      const payload = await this.fetchJson<unknown>(
        this.modelsUrl(base),
        { method: "GET", headers: this.requestHeaders(options.apiKey) },
        { signal: options.signal },
      );
      const items = Array.isArray(payload)
        ? (payload as Array<Record<string, unknown>>)
        : (((payload as Record<string, unknown>)?.data as Array<Record<string, unknown>>) ?? []);
      const models: TtsModel[] = [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const model = toModel(item);
        if (model) models.push(model);
      }
      if (models.length > 0) return models;
    } catch (error) {
      if (this.runtime.manualModels.length === 0) throw error;
    }
    return this.manualModels();
  }

  async listVoices(options: TtsListOptions, model?: string): Promise<TtsVoice[]> {
    // Manually declared voices (custom providers) are the only source and apply to any model.
    if (this.runtime.manualVoices.length > 0) {
      return this.runtime.manualVoices.map((id) => ({ id, name: id, model }));
    }
    const models = await this.listModels(options);
    // A specific model is selected: return ONLY the voices it advertises. When the model
    // advertises none (or is unknown), return an empty list — never leak voices that belong
    // to other models.
    if (model) {
      const match = models.find((m) => m.id === model);
      return match ? match.voices : [];
    }
    // No model selected: advertise every voice the provider exposes (de-duplicated).
    const seen = new Set<string>();
    const out: TtsVoice[] = [];
    for (const m of models) {
      for (const voice of m.voices) {
        if (seen.has(voice.id)) continue;
        seen.add(voice.id);
        out.push(voice);
      }
    }
    return out;
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    const base = this.resolveBaseUrl(options.baseUrl);
    const format = (options.responseFormat || this.runtime.defaultFormat).trim().toLowerCase();
    const body: Record<string, unknown> = { model: options.model, input: options.input };
    if (options.voice) body.voice = options.voice;
    if (format) body.response_format = format;
    if (typeof options.speed === "number" && Number.isFinite(options.speed)) body.speed = options.speed;
    if (options.instructions) body.instructions = options.instructions;

    const { bytes, contentType, headers } = await this.fetchAudio(this.speechUrl(base), {
      method: "POST",
      headers: this.requestHeaders(options.apiKey),
      body: JSON.stringify(body),
    }, { signal: options.signal });

    const reportedModel = headers.get("x-model") ?? headers.get("x-generation-model") ?? "";
    return {
      bytes,
      contentType,
      format: formatFromContentType(contentType, format || "mp3"),
      model: reportedModel || options.model,
    };
  }
}
