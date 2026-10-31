import { TtsProviderBase, type TtsProviderRuntime } from "./base.js";
import { asRecord, decodeBase64, mimeForFormat, pickString } from "./helpers.js";
import type { TtsAudioResult, TtsListOptions, TtsModel, TtsSynthesizeOptions, TtsVoice } from "../types.js";

/** Default Xiaomi MiMo OpenAI-compatible API base URL. */
export const MIMO_TTS_BASE_URL = "https://api.xiaomimimo.com/v1";

/** Documented MiMo TTS model ids. */
const MIMO_MODELS = ["mimo-v2.5-tts", "mimo-v2.5-tts-voicedesign"] as const;

/** Documented built-in MiMo voices (no voice-listing endpoint exists). */
const MIMO_VOICES = ["mimo_default", "Mia", "Chloe", "Milo", "Dean", "冰糖", "茉莉", "苏打", "白桦"] as const;

/** Map an engine format to a MiMo `audio.format`. */
function mimoFormat(format: string | undefined, fallback: string): string {
  switch ((format || fallback || "wav").trim().toLowerCase()) {
    case "mp3":
      return "mp3";
    case "pcm":
    case "pcm16":
      return "pcm16";
    default:
      return "wav";
  }
}

/**
 * Xiaomi MiMo text-to-speech (MiMo-V2.5-TTS).
 *
 *   POST {base}/chat/completions  — OpenAI Chat Completions with audio output
 *   GET  {base}/models            — model catalog (filtered to TTS ids)
 *
 * This is an OpenAI-compatible Chat Completions endpoint, NOT `/audio/speech`:
 * the text to synthesize must be the `assistant` message, and the audio comes
 * back base64-encoded at `choices[0].message.audio.data`.
 *
 * Docs: https://mimo.mi.com/docs/api/audio/tts
 */
export class MimoTtsProvider extends TtsProviderBase {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "mimo",
      name: "Xiaomi MiMo",
      baseUrl: MIMO_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "wav",
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
        `${base}/models`,
        { method: "GET", headers: this.headers(options.apiKey) },
        { signal: options.signal },
      );
      const items = Array.isArray(payload.data) ? payload.data : [];
      const models: TtsModel[] = [];
      for (const item of items) {
        const record = asRecord(item);
        if (!record) continue;
        const id = pickString(record, "id");
        if (!id || !/tts/i.test(id)) continue;
        models.push({ id, name: id, voices: [], languages: [] });
      }
      if (models.length > 0) return models;
    } catch {
      // fall through to the documented models
    }
    return MIMO_MODELS.map((id) => ({ id, name: id, voices: [], languages: [] }));
  }

  async listVoices(_options: TtsListOptions, model?: string): Promise<TtsVoice[]> {
    return MIMO_VOICES.map((id) => ({ id, name: id, model: model || undefined }));
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    if (!(options.apiKey ?? "").trim()) throw new Error("A Xiaomi MiMo API key is required.");
    const base = this.resolveBaseUrl(options.baseUrl);
    const format = mimoFormat(options.responseFormat, this.runtime.defaultFormat);
    const model = options.model || "mimo-v2.5-tts";
    const style = (options.instructions ?? "").trim() || "Speak naturally and clearly.";
    const body = {
      model,
      messages: [
        { role: "user", content: style },
        { role: "assistant", content: options.input },
      ],
      audio: { format, voice: options.voice || "mimo_default" },
      stream: false,
    };

    const payload = await this.fetchJson<{
      choices?: Array<{ message?: { audio?: { data?: string } } }>;
      error?: { message?: string };
    }>(
      `${base}/chat/completions`,
      { method: "POST", headers: this.headers(options.apiKey), body: JSON.stringify(body) },
      { signal: options.signal },
    );
    const data = payload.choices?.[0]?.message?.audio?.data;
    if (typeof data !== "string" || !data) {
      throw new Error(payload.error?.message || "Xiaomi MiMo returned no audio.");
    }
    return {
      bytes: decodeBase64(data),
      contentType: mimeForFormat(format),
      format: format === "pcm16" ? "pcm" : format,
      model,
    };
  }
}
