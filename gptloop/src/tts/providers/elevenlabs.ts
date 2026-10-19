/**
 * ElevenLabs TTS provider — POSTs text to
 * `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` with the `xi-api-key`
 * header; the response is raw audio bytes. Models (`GET /v1/models`) and voices
 * (`GET /v1/voices`) are both fetched live — nothing is hard-coded.
 * https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 */
import type {
  TtsModelInfo,
  TtsProvider,
  TtsSynthesisResult,
  TtsVoiceInfo,
} from "../types.js";

import { ttsGetJson, ttsPostForBinary, throwTtsProviderError } from "../http.js";

const PROVIDER_LABEL = "ElevenLabs";
const API_ROOT = "https://api.elevenlabs.io/v1";

/** ElevenLabs output-format query values -> extension/contentType (mp3 default). */
const FORMATS: Record<string, { query: string; extension: string; contentType: string }> = {
  mp3: { query: "mp3_44100_128", extension: "mp3", contentType: "audio/mpeg" },
  mp3_high: { query: "mp3_44100_192", extension: "mp3", contentType: "audio/mpeg" },
  wav: { query: "wav", extension: "wav", contentType: "audio/wav" },
  pcm: { query: "pcm_24000", extension: "pcm", contentType: "audio/pcm" },
};

interface ElevenModel {
  model_id?: string;
  name?: string;
  description?: string;
}

interface ElevenVoice {
  voice_id?: string;
  name?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

export const elevenLabsTtsProvider: TtsProvider = {
  id: "elevenlabs",
  label: PROVIDER_LABEL,
  requiresApiKey: true,
  requiresBaseUrl: false,
  requiresVoice: true,
  instructions:
    "Use your ElevenLabs API key (xi-api-key). Pick a model and a voice — both lists are fetched " +
    "live from your account, including any cloned voices you own.",
  async fetchModels(_config, ctx): Promise<TtsModelInfo[]> {
    try {
      const models = await ttsGetJson<ElevenModel[]>(`${API_ROOT}/models`, {}, ctx);
      return models
        .filter((m) => typeof m.model_id === "string" && m.model_id.length > 0)
        .map((m) => ({ id: m.model_id as string, label: m.name ?? m.model_id }));
    } catch (error) {
      throwTtsProviderError(`${PROVIDER_LABEL} model list`, error);
    }
  },
  async fetchVoices(config, ctx): Promise<TtsVoiceInfo[]> {
    try {
      const headers: Record<string, string> = {};
      if (config.apiKey?.trim()) headers["xi-api-key"] = config.apiKey.trim();
      const data = await ttsGetJson<{ voices?: ElevenVoice[] }>(`${API_ROOT}/voices`, headers, ctx);
      return (data.voices ?? [])
        .filter((v) => typeof v.voice_id === "string" && v.voice_id.length > 0)
        .map((v) => ({
          id: v.voice_id as string,
          label: v.name ?? v.voice_id,
          gender: v.labels?.gender,
          language: v.labels?.language ?? v.labels?.accent,
          previewUrl: v.preview_url,
        }));
    } catch (error) {
      throwTtsProviderError(`${PROVIDER_LABEL} voice list`, error);
    }
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    if (!config.apiKey?.trim()) throw new Error("No ElevenLabs API key configured. Add it in the TTS panel.");
    if (!config.voice?.trim()) throw new Error("No ElevenLabs voice selected. Pick one in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "mp3").toLowerCase();
    const format = FORMATS[formatKey] ?? FORMATS.mp3!;
    const voiceId = encodeURIComponent(config.voice.trim());
    const headers = { "xi-api-key": config.apiKey.trim(), Accept: "audio/mpeg" };
    try {
      const { audio, contentType } = await ttsPostForBinary(
        `${API_ROOT}/text-to-speech/${voiceId}?output_format=${format.query}`,
        headers,
        {
          text,
          model_id: config.model?.trim() || "eleven_multilingual_v2",
        },
        ctx,
      );
      return {
        audio,
        extension: format.extension,
        contentType,
        provider: "elevenlabs",
        model: config.model?.trim() || "eleven_multilingual_v2",
        voice: config.voice,
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
