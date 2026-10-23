import { TtsProviderBase, type TtsProviderRuntime } from "./base.js";
import { asRecord, formatFromContentType, pickArray, pickString } from "./helpers.js";
import type { TtsAudioResult, TtsListOptions, TtsModel, TtsSynthesizeOptions, TtsVoice } from "../types.js";

/** Default ElevenLabs API base URL. */
export const ELEVENLABS_TTS_BASE_URL = "https://api.elevenlabs.io";

/** Map an engine format to an ElevenLabs `output_format` query value. */
function elevenOutputFormat(format: string | undefined, fallback: string): string {
  switch ((format || fallback || "mp3").trim().toLowerCase()) {
    case "wav":
      return "wav_44100";
    case "pcm":
      return "pcm_44100";
    case "opus":
    case "ogg":
      return "opus_48000_128";
    case "ulaw":
      return "ulaw_8000";
    case "alaw":
      return "alaw_8000";
    default:
      return "mp3_44100_128";
  }
}

/** Extract a language hint from an ElevenLabs voice object. */
function voiceLanguage(record: Record<string, unknown>): string {
  const labels = asRecord(record.labels);
  const fromLabels = labels ? pickString(labels, "language", "accent") : "";
  if (fromLabels) return fromLabels;
  const verified = pickArray(record, "verified_languages");
  const first = asRecord(verified[0]);
  return first ? pickString(first, "language", "language_id") : "";
}

/**
 * ElevenLabs text-to-speech.
 *
 *   POST {base}/v1/text-to-speech/{voice_id}?output_format=...  — raw audio bytes
 *   GET  {base}/v1/models                                      — TTS model catalog
 *   GET  {base}/v2/voices                                      — voice catalog
 *
 * Auth uses the `xi-api-key` header. The voice id is a path parameter.
 *
 * Docs: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 */
export class ElevenLabsTtsProvider extends TtsProviderBase {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "elevenlabs",
      name: "ElevenLabs",
      baseUrl: ELEVENLABS_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "mp3",
      ...runtime,
    });
  }

  private headers(apiKey: string): Record<string, string> {
    return this.withRuntimeHeaders({ "xi-api-key": apiKey, "Content-Type": "application/json" });
  }

  async listModels(options: TtsListOptions): Promise<TtsModel[]> {
    const base = this.resolveBaseUrl(options.baseUrl);
    const payload = await this.fetchJson<unknown>(
      `${base}/v1/models`,
      { method: "GET", headers: this.headers(options.apiKey) },
      { signal: options.signal },
    );
    const items = Array.isArray(payload) ? payload : [];
    const models: TtsModel[] = [];
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      if (record.can_do_text_to_speech === false) continue;
      const id = pickString(record, "model_id", "id");
      if (!id) continue;
      models.push({ id, name: pickString(record, "name") || id, voices: [], languages: [] });
    }
    if (models.length === 0) {
      return this.runtime.manualModels.map((id) => ({ id, name: id, voices: [], languages: [] }));
    }
    return models;
  }

  async listVoices(options: TtsListOptions): Promise<TtsVoice[]> {
    if (this.runtime.manualVoices.length > 0) {
      return this.runtime.manualVoices.map((id) => ({ id, name: id }));
    }
    const base = this.resolveBaseUrl(options.baseUrl);
    let items: unknown[] = [];
    try {
      const payload = await this.fetchJson<{ voices?: unknown[] }>(
        `${base}/v2/voices?page_size=100`,
        { method: "GET", headers: this.headers(options.apiKey) },
        { signal: options.signal },
      );
      items = Array.isArray(payload.voices) ? payload.voices : [];
    } catch {
      const payload = await this.fetchJson<{ voices?: unknown[] }>(
        `${base}/v1/voices`,
        { method: "GET", headers: this.headers(options.apiKey) },
        { signal: options.signal },
      );
      items = Array.isArray(payload.voices) ? payload.voices : [];
    }
    const voices: TtsVoice[] = [];
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      const id = pickString(record, "voice_id", "id");
      if (!id) continue;
      const voice: TtsVoice = { id, name: pickString(record, "name") || id };
      const language = voiceLanguage(record);
      if (language) voice.language = language;
      voices.push(voice);
    }
    return voices;
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    if (!(options.apiKey ?? "").trim()) throw new Error("An ElevenLabs API key is required.");
    const voice = (options.voice ?? "").trim();
    if (!voice) throw new Error("An ElevenLabs voice id is required.");
    const base = this.resolveBaseUrl(options.baseUrl);
    const output = elevenOutputFormat(options.responseFormat, this.runtime.defaultFormat);
    const body: Record<string, unknown> = { text: options.input };
    if (options.model) body.model_id = options.model;
    if (options.language) body.language_code = options.language;
    if (typeof options.speed === "number" && Number.isFinite(options.speed)) {
      body.voice_settings = { speed: options.speed };
    }

    const { bytes, contentType } = await this.fetchAudio(
      `${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${encodeURIComponent(output)}`,
      { method: "POST", headers: this.headers(options.apiKey), body: JSON.stringify(body) },
      { signal: options.signal },
    );
    return {
      bytes,
      contentType: contentType || "audio/mpeg",
      format: formatFromContentType(contentType, "mp3"),
      model: options.model || "eleven_multilingual_v2",
    };
  }
}
