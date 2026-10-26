import { TtsProviderBase, type TtsProviderRuntime } from "./base.js";
import { asRecord, decodeBase64, mimeForFormat, pickArray, pickString } from "./helpers.js";
import type { TtsAudioResult, TtsListOptions, TtsModel, TtsSynthesizeOptions, TtsVoice } from "../types.js";

/** Default Inworld AI API base URL. */
export const INWORLD_TTS_BASE_URL = "https://api.inworld.ai";

/** Documented Inworld TTS model ids (no TTS model-list endpoint is documented). */
const INWORLD_MODELS = ["inworld-tts-2", "inworld-tts-2-flash"] as const;

/** Map an engine format to an Inworld `audioEncoding`. */
function inworldEncoding(format: string | undefined, fallback: string): string {
  switch ((format || fallback || "mp3").trim().toLowerCase()) {
    case "wav":
      return "WAV";
    case "pcm":
      return "PCM";
    case "linear16":
      return "LINEAR16";
    case "opus":
    case "ogg":
      return "OGG_OPUS";
    case "flac":
      return "FLAC";
    case "ulaw":
      return "MULAW";
    case "alaw":
      return "ALAW";
    default:
      return "MP3";
  }
}

/**
 * Inworld AI text-to-speech.
 *
 *   POST {base}/tts/v1/voice          — JSON in, base64 `audioContent` out
 *   GET  {base}/voices/v1/voices      — voice catalog
 *
 * Auth uses HTTP Basic with the pre-encoded `base64(key_id:secret)` credential
 * pasted from the Inworld portal (the value is used as-is, not re-encoded).
 *
 * Docs: https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech
 */
export class InworldTtsProvider extends TtsProviderBase {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "inworld",
      name: "Inworld TTS",
      baseUrl: INWORLD_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "mp3",
      ...runtime,
    });
  }

  private headers(apiKey: string): Record<string, string> {
    return this.withRuntimeHeaders({ Authorization: `Basic ${(apiKey ?? "").trim()}`, "Content-Type": "application/json" });
  }

  async listModels(): Promise<TtsModel[]> {
    return INWORLD_MODELS.map((id) => ({ id, name: id, voices: [], languages: [] }));
  }

  async listVoices(options: TtsListOptions): Promise<TtsVoice[]> {
    if (this.runtime.manualVoices.length > 0) {
      return this.runtime.manualVoices.map((id) => ({ id, name: id }));
    }
    const base = this.resolveBaseUrl(options.baseUrl);
    let items: unknown[] = [];
    try {
      const payload = await this.fetchJson<{ voices?: unknown[] }>(
        `${base}/voices/v1/voices?pageSize=200`,
        { method: "GET", headers: this.headers(options.apiKey) },
        { signal: options.signal },
      );
      items = Array.isArray(payload.voices) ? payload.voices : [];
    } catch {
      const payload = await this.fetchJson<{ voices?: unknown[] }>(
        `${base}/tts/v1/voices`,
        { method: "GET", headers: this.headers(options.apiKey) },
        { signal: options.signal },
      );
      items = Array.isArray(payload.voices) ? payload.voices : [];
    }
    const voices: TtsVoice[] = [];
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      const id = pickString(record, "voiceId", "voice_id", "name");
      if (!id) continue;
      const voice: TtsVoice = { id, name: pickString(record, "displayName", "name") || id };
      const language = pickString(record, "languageCode", "langCode", "language");
      if (language) voice.language = language;
      else {
        const languages = pickArray(record, "languages").filter((l): l is string => typeof l === "string");
        if (languages[0]) voice.language = languages[0];
      }
      voices.push(voice);
    }
    return voices;
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    if (!(options.apiKey ?? "").trim()) throw new Error("An Inworld credential is required.");
    const voice = (options.voice ?? "").trim();
    if (!voice) throw new Error("An Inworld voice id is required.");
    const base = this.resolveBaseUrl(options.baseUrl);
    const encoding = inworldEncoding(options.responseFormat, this.runtime.defaultFormat);
    const audioConfig: Record<string, unknown> = { audioEncoding: encoding };
    if (typeof options.speed === "number" && Number.isFinite(options.speed)) {
      audioConfig.speakingRate = Math.min(1.5, Math.max(0.5, options.speed));
    }
    const body: Record<string, unknown> = {
      text: options.input,
      modelId: options.model || "inworld-tts-2",
      voiceId: voice,
      audioConfig,
    };
    if (options.language) body.language = options.language;

    const payload = await this.fetchJson<{ audioContent?: string }>(
      `${base}/tts/v1/voice`,
      { method: "POST", headers: this.headers(options.apiKey), body: JSON.stringify(body) },
      { signal: options.signal },
    );
    if (typeof payload.audioContent !== "string" || !payload.audioContent) {
      throw new Error("Inworld TTS returned no audio.");
    }
    const format = encoding === "WAV" ? "wav" : encoding === "PCM" ? "pcm" : encoding === "OGG_OPUS" ? "opus" : "mp3";
    return {
      bytes: decodeBase64(payload.audioContent),
      contentType: mimeForFormat(format),
      format,
      model: options.model || "inworld-tts-2",
    };
  }
}
