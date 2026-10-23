import { TtsProviderBase, type TtsProviderRuntime } from "./base.js";
import { asRecord, formatFromContentType, pickString } from "./helpers.js";
import type { TtsAudioResult, TtsListOptions, TtsModel, TtsSynthesizeOptions, TtsVoice } from "../types.js";

/** Default xAI API base URL. */
export const XAI_TTS_BASE_URL = "https://api.x.ai";

/** Map an engine format to an xAI `output_format.codec`. */
function xaiCodec(format: string | undefined, fallback: string): string {
  switch ((format || fallback || "mp3").trim().toLowerCase()) {
    case "wav":
      return "wav";
    case "pcm":
      return "pcm";
    case "ulaw":
      return "mulaw";
    case "alaw":
      return "alaw";
    default:
      return "mp3";
  }
}

/**
 * xAI (Grok) text-to-speech.
 *
 *   POST {base}/v1/tts          — JSON in, raw audio bytes out
 *   GET  {base}/v1/tts/voices   — voice catalog
 *   GET  {base}/v1/models       — model catalog (TTS is model-less; filtered to voice-ish ids)
 *
 * Auth uses `Authorization: Bearer`. `language` is required (BCP-47 or `auto`).
 *
 * Docs: https://docs.x.ai/developers/rest-api-reference/inference/voice
 */
export class XaiTtsProvider extends TtsProviderBase {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "xai",
      name: "xAI",
      baseUrl: XAI_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "mp3",
      ...runtime,
    });
  }

  private headers(apiKey: string): Record<string, string> {
    return this.withRuntimeHeaders({ Authorization: `Bearer ${(apiKey ?? "").trim()}`, "Content-Type": "application/json" });
  }

  async listModels(options: TtsListOptions): Promise<TtsModel[]> {
    const base = this.resolveBaseUrl(options.baseUrl);
    try {
      const payload = await this.fetchJson<{ data?: Array<Record<string, unknown>> }>(
        `${base}/v1/models`,
        { method: "GET", headers: this.headers(options.apiKey) },
        { signal: options.signal },
      );
      const items = Array.isArray(payload.data) ? payload.data : [];
      const models: TtsModel[] = [];
      for (const item of items) {
        const record = asRecord(item);
        if (!record) continue;
        const id = pickString(record, "id");
        if (!id || !/tts|voice/i.test(id)) continue;
        models.push({ id, name: pickString(record, "name") || id, voices: [], languages: [] });
      }
      if (models.length > 0) return models;
    } catch {
      // fall through to the implicit model
    }
    return [{ id: "xai-tts", name: "xAI TTS", voices: [], languages: [] }];
  }

  async listVoices(options: TtsListOptions): Promise<TtsVoice[]> {
    if (this.runtime.manualVoices.length > 0) {
      return this.runtime.manualVoices.map((id) => ({ id, name: id }));
    }
    const base = this.resolveBaseUrl(options.baseUrl);
    const payload = await this.fetchJson<{ voices?: unknown[] }>(
      `${base}/v1/tts/voices`,
      { method: "GET", headers: this.headers(options.apiKey) },
      { signal: options.signal },
    );
    const items = Array.isArray(payload.voices) ? payload.voices : [];
    const voices: TtsVoice[] = [];
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      const id = pickString(record, "voice_id", "id");
      if (!id) continue;
      const voice: TtsVoice = { id, name: pickString(record, "name") || id };
      const language = pickString(record, "language");
      if (language) voice.language = language;
      voices.push(voice);
    }
    return voices;
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    if (!(options.apiKey ?? "").trim()) throw new Error("An xAI API key is required.");
    const base = this.resolveBaseUrl(options.baseUrl);
    const codec = xaiCodec(options.responseFormat, this.runtime.defaultFormat);
    const body: Record<string, unknown> = {
      text: options.input,
      voice_id: options.voice || "eve",
      language: (options.language || "auto").trim(),
      output_format: { codec },
    };
    if (typeof options.speed === "number" && Number.isFinite(options.speed)) {
      body.speed = Math.min(1.5, Math.max(0.7, options.speed));
    }

    const { bytes, contentType } = await this.fetchAudio(
      `${base}/v1/tts`,
      { method: "POST", headers: this.headers(options.apiKey), body: JSON.stringify(body) },
      { signal: options.signal },
    );
    return {
      bytes,
      contentType: contentType || "audio/mpeg",
      format: formatFromContentType(contentType, codec === "mulaw" ? "pcm" : codec),
      model: options.model || "xai-tts",
    };
  }
}
