/**
 * xAI Grok TTS provider — POSTs to `https://api.x.ai/v1/tts` with a Bearer
 * key; the response body is the raw audio bytes. Voices are fetched live from
 * `GET /v1/tts/voices`. There is no model parameter — the voice roster IS the
 * catalog. https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
 */
import type {
  TtsModelInfo,
  TtsProvider,
  TtsSynthesisResult,
  TtsVoiceInfo,
} from "../types.js";

import { ttsGetJson, ttsPostForBinary, throwTtsProviderError } from "../http.js";

const PROVIDER_LABEL = "xAI";
const TTS_URL = "https://api.x.ai/v1/tts";
const VOICES_URL = "https://api.x.ai/v1/tts/voices";

const CODECS: Record<string, { codec: string; extension: string; contentType: string }> = {
  mp3: { codec: "mp3", extension: "mp3", contentType: "audio/mpeg" },
  wav: { codec: "wav", extension: "wav", contentType: "audio/wav" },
  pcm: { codec: "pcm", extension: "pcm", contentType: "audio/pcm" },
};

interface XaiVoice {
  voice_id?: string;
  id?: string;
  name?: string;
}

export const xaiTtsProvider: TtsProvider = {
  id: "xai",
  label: PROVIDER_LABEL,
  requiresApiKey: true,
  requiresBaseUrl: false,
  requiresVoice: false,
  instructions:
    "Use your xAI API key. Pick a voice from the live voice list (defaults to 'eve') and a BCP-47 " +
    "language code (or 'auto'). xAI's TTS is voice-driven — there is no separate model selection.",
  fetchModels(): Promise<TtsModelInfo[]> {
    // xAI's TTS API has no model parameter — nothing to list.
    return Promise.resolve([]);
  },
  async fetchVoices(config, ctx): Promise<TtsVoiceInfo[]> {
    if (!config.apiKey?.trim()) throw new Error("No xAI API key configured. Add it in the TTS panel.");
    try {
      const data = await ttsGetJson<XaiVoice[] | { voices?: XaiVoice[] }>(
        VOICES_URL,
        { Authorization: `Bearer ${config.apiKey.trim()}` },
        ctx,
      );
      const voices = Array.isArray(data) ? data : (data.voices ?? []);
      return voices
        .map((v) => ({
          id: String(v.voice_id ?? v.id ?? ""),
          label: v.name ?? String(v.voice_id ?? v.id ?? ""),
        }))
        .filter((v) => v.id.length > 0);
    } catch (error) {
      throwTtsProviderError(`${PROVIDER_LABEL} voice list`, error);
    }
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    if (!config.apiKey?.trim()) throw new Error("No xAI API key configured. Add it in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "mp3").toLowerCase();
    const format = CODECS[formatKey] ?? CODECS.mp3!;
    try {
      const { audio, contentType } = await ttsPostForBinary(
        TTS_URL,
        { Authorization: `Bearer ${config.apiKey.trim()}` },
        {
          text,
          voice_id: config.voice?.trim() || "eve",
          language: config.language?.trim() || "en",
          output_format: { codec: format.codec, sample_rate: 24000, bit_rate: 128000 },
          ...(typeof config.speed === "number" && config.speed > 0
            ? { speed: Math.min(1.5, Math.max(0.7, config.speed)) }
            : {}),
        },
        ctx,
      );
      return {
        audio,
        extension: format.extension,
        contentType,
        provider: "xai",
        voice: config.voice?.trim() || "eve",
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
