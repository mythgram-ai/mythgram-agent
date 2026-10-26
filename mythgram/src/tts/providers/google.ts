import { TtsProviderBase, type TtsProviderRuntime } from "./base.js";
import { asRecord, decodeBase64, mimeForFormat, pickArray, pickString } from "./helpers.js";
import type { TtsAudioResult, TtsListOptions, TtsModel, TtsSynthesizeOptions, TtsVoice } from "../types.js";

/** Default Google Cloud Text-to-Speech API base URL. */
export const GOOGLE_TTS_BASE_URL = "https://texttospeech.googleapis.com";

/** Map an engine format to a Google `audioEncoding`. */
function googleEncoding(format: string | undefined, fallback: string): string {
  switch ((format || fallback || "mp3").trim().toLowerCase()) {
    case "wav":
    case "linear16":
      return "LINEAR16";
    case "pcm":
      return "PCM";
    case "opus":
    case "ogg":
      return "OGG_OPUS";
    case "mulaw":
      return "MULAW";
    case "alaw":
      return "ALAW";
    case "m4a":
      return "M4A";
    default:
      return "MP3";
  }
}

/** Derive a BCP-47 locale from a Google voice name (e.g. en-US-Neural2-C -> en-US). */
function localeFromVoice(voice: string): string {
  const parts = voice.split("-");
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : "";
}

/**
 * Google Cloud Text-to-Speech.
 *
 *   POST {base}/v1/text:synthesize?key=...  — JSON in, base64 `audioContent` out
 *   GET  {base}/v1/voices?languageCode=...   — voice catalog
 *
 * Auth is an OAuth 2.0 access token in `Authorization: Bearer`. Google returns
 * audio as base64 inside JSON (not raw bytes). There is no model-list endpoint;
 * model families are derived from voice names.
 *
 * Docs: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
 */
export class GoogleTtsProvider extends TtsProviderBase {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "google",
      name: "Google Cloud TTS",
      baseUrl: GOOGLE_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "mp3",
      ...runtime,
    });
  }

  private headers(apiKey: string): Record<string, string> {
    return this.withRuntimeHeaders({
      Authorization: `Bearer ${(apiKey ?? "").trim()}`,
      "Content-Type": "application/json",
    });
  }

  /** No listing endpoint; expose the documented model families. */
  async listModels(): Promise<TtsModel[]> {
    return ["Neural2", "Wavenet", "Standard", "Studio", "Chirp3-HD"].map((id) => ({
      id,
      name: id,
      voices: [],
      languages: [],
    }));
  }

  async listVoices(options: TtsListOptions): Promise<TtsVoice[]> {
    const base = this.resolveBaseUrl(options.baseUrl);
    const query = options.language ? `?languageCode=${encodeURIComponent(options.language)}` : "";
    const payload = await this.fetchJson<{ voices?: unknown[] }>(
      `${base}/v1/voices${query}`,
      { method: "GET", headers: this.headers(options.apiKey) },
      { signal: options.signal },
    );
    const items = Array.isArray(payload.voices) ? payload.voices : [];
    const voices: TtsVoice[] = [];
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      const id = pickString(record, "name");
      if (!id) continue;
      const voice: TtsVoice = { id, name: id };
      const languages = pickArray(record, "languageCodes").filter(
        (l): l is string => typeof l === "string",
      );
      if (languages[0]) voice.language = languages[0];
      const gender = pickString(record, "ssmlGender");
      if (gender) voice.type = gender;
      voices.push(voice);
    }
    return voices;
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    if (!(options.apiKey ?? "").trim()) throw new Error("A Google Cloud access token is required.");
    const base = this.resolveBaseUrl(options.baseUrl);
    const voiceName = (options.voice || "en-US-Neural2-C").trim();
    const locale = (options.language || localeFromVoice(voiceName) || "en-US").trim();
    const encoding = googleEncoding(options.responseFormat, this.runtime.defaultFormat);
    const audioConfig: Record<string, unknown> = { audioEncoding: encoding };
    if (typeof options.speed === "number" && Number.isFinite(options.speed)) {
      audioConfig.speakingRate = Math.min(2, Math.max(0.25, options.speed));
    }
    const body = {
      input: { text: options.input },
      voice: { languageCode: locale, name: voiceName },
      audioConfig,
    };

    const payload = await this.fetchJson<{ audioContent?: string }>(
      `${base}/v1/text:synthesize`,
      { method: "POST", headers: this.headers(options.apiKey), body: JSON.stringify(body) },
      { signal: options.signal },
    );
    if (typeof payload.audioContent !== "string" || !payload.audioContent) {
      throw new Error("Google Cloud TTS returned no audio.");
    }
    const format = encoding === "OGG_OPUS" ? "opus" : encoding === "PCM" ? "pcm" : encoding === "LINEAR16" ? "wav" : "mp3";
    return {
      bytes: decodeBase64(payload.audioContent),
      contentType: mimeForFormat(format),
      format,
      model: options.model || "Neural2",
    };
  }
}
