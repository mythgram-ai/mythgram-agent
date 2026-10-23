import {
  TTS_LIST_TIMEOUT_MS,
  TTS_SYNTHESIS_TIMEOUT_MS,
  ttsRequestAudio,
  ttsRequestJson,
  type TtsFetch,
} from "../client.js";
import type {
  TtsAudioResult,
  TtsListOptions,
  TtsModel,
  TtsProviderKind,
  TtsSynthesizeOptions,
  TtsVoice,
} from "../types.js";

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

/** Guess the container format from a response Content-Type. */
function formatFromContentType(contentType: string, fallback: string): string {
  const value = contentType.toLowerCase();
  if (value.includes("mpeg") || value.includes("mp3")) return "mp3";
  if (value.includes("wav")) return "wav";
  if (value.includes("flac")) return "flac";
  if (value.includes("aac")) return "aac";
  if (value.includes("ogg") || value.includes("opus")) return "opus";
  if (value.includes("pcm") || value.includes("l16")) return "pcm";
  return fallback;
}

/** Coerce one provider `supported_voices` entry into a TtsVoice. */
function toVoice(raw: unknown, modelId: string): TtsVoice | null {
  if (typeof raw === "string") {
    const id = raw.trim();
    return id ? { id, name: id, model: modelId } : null;
  }
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const id = String(record.id ?? record.voice ?? record.name ?? "").trim();
    if (!id) return null;
    const name = String(record.name ?? record.label ?? id).trim() || id;
    const voice: TtsVoice = { id, name, model: modelId };
    const language = record.language ?? record.lang;
    if (typeof language === "string" && language.trim()) voice.language = language.trim();
    if (typeof record.type === "string" && record.type.trim()) voice.type = record.type.trim();
    return voice;
  }
  return null;
}

/**
 * Base implementation of an OpenAI-compatible text-to-speech provider.
 *
 * Speech synthesis is a single `POST {base}/audio/speech` returning a raw audio
 * byte stream — the shape shared by OpenRouter, KittenML, OpenAI and most local
 * servers. Subclasses override URL/headers/model-listing specifics.
 */
export class OpenAICompatibleTtsProvider implements TtsProvider {
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

  /** Headers for a request: JSON content type, optional Bearer auth, static extras. */
  protected requestHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.runtime.headers,
    };
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

  /** Normalize a raw `/models` item into a TtsModel. */
  protected toModel(item: Record<string, unknown>): TtsModel | null {
    const id = String(item.id ?? item.name ?? "").trim();
    if (!id) return null;
    const name = String(item.name ?? item.id ?? id).trim() || id;
    const voices: TtsVoice[] = [];
    const rawVoices = item.supported_voices ?? item.voices;
    if (Array.isArray(rawVoices)) {
      for (const raw of rawVoices) {
        const voice = toVoice(raw, id);
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
   * List the provider's models. Falls back to the manually declared model list
   * (custom providers) when the endpoint is missing or returns nothing.
   */
  async listModels(options: TtsListOptions): Promise<TtsModel[]> {
    const base = this.resolveBaseUrl(options.baseUrl);
    try {
      const payload = await ttsRequestJson<unknown>(
        this.modelsUrl(base),
        { method: "GET", headers: this.requestHeaders(options.apiKey) },
        { fetchFn: this.runtime.fetchFn, timeoutMs: TTS_LIST_TIMEOUT_MS, signal: options.signal },
      );
      const items = Array.isArray(payload)
        ? (payload as Array<Record<string, unknown>>)
        : (((payload as Record<string, unknown>)?.data as Array<Record<string, unknown>>) ?? []);
      const models: TtsModel[] = [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const model = this.toModel(item);
        if (model) models.push(model);
      }
      if (models.length > 0) return models;
    } catch (error) {
      if (this.runtime.manualModels.length === 0) throw error;
    }
    return this.runtime.manualModels.map((id) => ({ id, name: id, voices: [], languages: [] }));
  }

  /**
   * List voices for a model. The base implementation derives them from the
   * model listing (OpenRouter-style `supported_voices`); providers with a
   * dedicated voice endpoint override this.
   */
  async listVoices(options: TtsListOptions, model?: string): Promise<TtsVoice[]> {
    if (this.runtime.manualVoices.length > 0) {
      return this.runtime.manualVoices.map((id) => ({ id, name: id, model }));
    }
    const models = await this.listModels(options);
    if (model) {
      const match = models.find((m) => m.id === model);
      if (match) return match.voices;
    }
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

  /** Synthesize speech from text, returning the raw audio bytes. */
  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    const base = this.resolveBaseUrl(options.baseUrl);
    const format = (options.responseFormat || this.runtime.defaultFormat).trim().toLowerCase();
    const body: Record<string, unknown> = { model: options.model, input: options.input };
    if (options.voice) body.voice = options.voice;
    if (format) body.response_format = format;
    if (typeof options.speed === "number" && Number.isFinite(options.speed)) body.speed = options.speed;
    if (options.instructions) body.instructions = options.instructions;

    const { bytes, contentType, headers } = await ttsRequestAudio(
      this.speechUrl(base),
      {
        method: "POST",
        headers: this.requestHeaders(options.apiKey),
        body: JSON.stringify(body),
      },
      { fetchFn: this.runtime.fetchFn, timeoutMs: TTS_SYNTHESIS_TIMEOUT_MS, signal: options.signal },
    );

    const reportedModel = headers.get("x-model") ?? headers.get("x-generation-model") ?? "";
    return {
      bytes,
      contentType,
      format: formatFromContentType(contentType, format || "mp3"),
      model: reportedModel || options.model,
    };
  }
}
