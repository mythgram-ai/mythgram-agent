/**
 * Inworld TTS provider — POSTs to `https://api.inworld.ai/tts/v1/voice` with
 * `Authorization: Basic <base64-credentials>`; the response JSON carries a
 * Base64-encoded `audioContent`. Voices are fetched live from
 * `GET /tts/v1/voices`. https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech
 */
import type {
  TtsModelInfo,
  TtsProvider,
  TtsSynthesisResult,
  TtsVoiceInfo,
} from "../types.js";

import { ttsGetJson, ttsPostJson, throwTtsProviderError } from "../http.js";

const PROVIDER_LABEL = "Inworld";
const TTS_URL = "https://api.inworld.ai/tts/v1/voice";
const VOICES_URL = "https://api.inworld.ai/tts/v1/voices";

/** Inworld audio encodings -> extension/contentType (MP3 default). */
const ENCODINGS: Record<string, { encoding: string; extension: string; contentType: string }> = {
  mp3: { encoding: "MP3", extension: "mp3", contentType: "audio/mpeg" },
  wav: { encoding: "LINEAR16", extension: "wav", contentType: "audio/wav" },
  ogg: { encoding: "OGG_OPUS", extension: "ogg", contentType: "audio/ogg" },
  flac: { encoding: "FLAC", extension: "flac", contentType: "audio/flac" },
};

interface InworldVoice {
  voiceId?: string;
  displayName?: string;
  name?: string;
  gender?: string;
}

export const inworldTtsProvider: TtsProvider = {
  id: "inworld",
  label: PROVIDER_LABEL,
  requiresApiKey: true,
  requiresBaseUrl: false,
  requiresVoice: true,
  instructions:
    "Use the Basic (Base64) credentials copied from the Inworld Portal (Manage → API Keys) — they are " +
    "sent as-is in the Authorization header. Pick a model (inworld-tts-2 recommended) and a voice from " +
    "the live voice list.",
  // Inworld's documented TTS models (no public model-list endpoint).
  fetchModels(): Promise<TtsModelInfo[]> {
    return Promise.resolve([
      { id: "inworld-tts-2", label: "inworld-tts-2 (recommended)" },
      { id: "inworld-tts-1", label: "inworld-tts-1" },
      { id: "inworld-tts-max", label: "inworld-tts-max" },
      { id: "inworld-tts-express", label: "inworld-tts-express" },
    ]);
  },
  async fetchVoices(config, ctx): Promise<TtsVoiceInfo[]> {
    if (!config.apiKey?.trim()) throw new Error("No Inworld API key configured. Add it in the TTS panel.");
    try {
      const data = await ttsGetJson<InworldVoice[] | { voices?: InworldVoice[] }>(
        VOICES_URL,
        { Authorization: `Basic ${config.apiKey.trim()}` },
        ctx,
      );
      const voices = Array.isArray(data) ? data : (data.voices ?? []);
      return voices
        .map((v) => ({
          id: String(v.voiceId ?? v.name ?? ""),
          label: v.displayName ?? v.name ?? String(v.voiceId ?? ""),
          gender: v.gender?.toLowerCase(),
        }))
        .filter((v) => v.id.length > 0);
    } catch (error) {
      throwTtsProviderError(`${PROVIDER_LABEL} voice list`, error);
    }
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    if (!config.apiKey?.trim()) throw new Error("No Inworld API key configured. Add it in the TTS panel.");
    if (!config.voice?.trim()) throw new Error("No Inworld voice selected. Pick one in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "mp3").toLowerCase();
    const format = ENCODINGS[formatKey] ?? ENCODINGS.mp3!;
    try {
      const data = await ttsPostJson<{ audioContent?: string }>(
        TTS_URL,
        { Authorization: `Basic ${config.apiKey.trim()}` },
        {
          text,
          voiceId: config.voice.trim(),
          modelId: config.model?.trim() || "inworld-tts-2",
          audioConfig: {
            audioEncoding: format.encoding,
            ...(typeof config.speed === "number" && config.speed > 0
              ? { speakingRate: Math.min(1.5, Math.max(0.5, config.speed)) }
              : {}),
          },
        },
        ctx,
      );
      if (!data.audioContent) throw new Error("Inworld returned no audio content.");
      return {
        audio: Buffer.from(data.audioContent, "base64"),
        extension: format.extension,
        contentType: format.contentType,
        provider: "inworld",
        model: config.model?.trim() || "inworld-tts-2",
        voice: config.voice,
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
