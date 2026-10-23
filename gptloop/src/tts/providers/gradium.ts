import { TtsProviderBase, type TtsProviderRuntime } from "./base.js";
import { asRecord, formatFromContentType, pickString } from "./helpers.js";
import type { TtsAudioResult, TtsListOptions, TtsModel, TtsSynthesizeOptions, TtsVoice } from "../types.js";

/** Default Gradium API base URL. */
export const GRADIUM_TTS_BASE_URL = "https://api.gradium.ai/api";

/** Map an engine format to a Gradium `output_format` value. */
function gradiumFormat(format: string | undefined, fallback: string): string {
  switch ((format || fallback || "wav").trim().toLowerCase()) {
    case "pcm":
      return "pcm_24000";
    case "opus":
    case "ogg":
      return "opus";
    case "ulaw":
      return "ulaw_8000";
    case "alaw":
      return "alaw_8000";
    // Gradium has no MP3/AAC output; fall back to WAV.
    default:
      return "wav";
  }
}

/**
 * Gradium text-to-speech.
 *
 *   POST {base}/post/speech/tts  — JSON in, raw audio bytes out (only_audio:true)
 *   GET  {base}/voices/          — voice catalog
 *
 * Auth uses the `x-api-key` header. There is no model-listing endpoint (a single
 * `default` model serves requests).
 *
 * Docs: https://docs.gradium.ai/api-reference/endpoint/tts-post
 */
export class GradiumTtsProvider extends TtsProviderBase {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "gradium",
      name: "Gradium",
      baseUrl: GRADIUM_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "wav",
      ...runtime,
    });
  }

  private headers(apiKey: string): Record<string, string> {
    return this.withRuntimeHeaders({ "x-api-key": apiKey, "Content-Type": "application/json" });
  }

  async listModels(): Promise<TtsModel[]> {
    return [{ id: "default", name: "default", voices: [], languages: [] }];
  }

  async listVoices(options: TtsListOptions): Promise<TtsVoice[]> {
    if (this.runtime.manualVoices.length > 0) {
      return this.runtime.manualVoices.map((id) => ({ id, name: id }));
    }
    const base = this.resolveBaseUrl(options.baseUrl);
    const payload = await this.fetchJson<unknown>(
      `${base}/voices/?limit=100`,
      { method: "GET", headers: this.headers(options.apiKey) },
      { signal: options.signal },
    );
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { voices?: unknown[] }).voices)
        ? (payload as { voices: unknown[] }).voices
        : [];
    const voices: TtsVoice[] = [];
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      const id = pickString(record, "uid", "voice_id", "id");
      if (!id) continue;
      const voice: TtsVoice = { id, name: pickString(record, "name", "display_name") || id };
      const language = pickString(record, "language", "lang");
      if (language) voice.language = language;
      voices.push(voice);
    }
    return voices;
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    if (!(options.apiKey ?? "").trim()) throw new Error("A Gradium API key is required.");
    const voice = (options.voice ?? "").trim();
    if (!voice) throw new Error("A Gradium voice id is required.");
    const base = this.resolveBaseUrl(options.baseUrl);
    const format = gradiumFormat(options.responseFormat, this.runtime.defaultFormat);
    const body: Record<string, unknown> = {
      text: options.input,
      voice_id: voice,
      output_format: format,
      only_audio: true,
    };
    if (options.model && options.model !== "default") body.model_name = options.model;

    const { bytes, contentType } = await this.fetchAudio(
      `${base}/post/speech/tts`,
      { method: "POST", headers: this.headers(options.apiKey), body: JSON.stringify(body) },
      { signal: options.signal },
    );
    return {
      bytes,
      contentType: contentType || "audio/wav",
      format: formatFromContentType(contentType, format.startsWith("pcm") ? "pcm" : format),
      model: options.model || "default",
    };
  }
}
