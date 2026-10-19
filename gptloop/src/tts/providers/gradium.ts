/**
 * Gradium TTS provider — one-shot REST synthesis via
 * `POST https://api.gradium.ai/api/post/speech/tts` with `only_audio: true`
 * (the response body is the raw audio bytes). Voices are fetched live from
 * `GET https://api.gradium.ai/api/voices/?include_catalog=true`.
 * https://docs.gradium.ai/api-reference/endpoint/tts-post
 */
import type {
  TtsModelInfo,
  TtsProvider,
  TtsSynthesisResult,
  TtsVoiceInfo,
} from "../types.js";

import { ttsGetJson, ttsPostForBinary, throwTtsProviderError } from "../http.js";

const PROVIDER_LABEL = "Gradium";
const TTS_URL = "https://api.gradium.ai/api/post/speech/tts";
const VOICES_URL = "https://api.gradium.ai/api/voices/?include_catalog=true";

/** Gradium output formats (only_audio=true returns raw bytes in this format). */
const FORMATS: Record<string, { output: string; extension: string; contentType: string }> = {
  wav: { output: "wav", extension: "wav", contentType: "audio/wav" },
  opus: { output: "opus", extension: "ogg", contentType: "audio/ogg" },
  pcm: { output: "pcm", extension: "pcm", contentType: "audio/pcm" },
};

interface GradiumVoice {
  uid?: string;
  name?: string;
  is_catalog?: boolean;
  language?: string;
}

export const gradiumTtsProvider: TtsProvider = {
  id: "gradium",
  label: PROVIDER_LABEL,
  requiresApiKey: true,
  requiresBaseUrl: false,
  requiresVoice: true,
  instructions:
    "Use your Gradium API key (x-api-key). Pick a voice from the live voice library " +
    "(catalog voices plus your organization's custom clones). Model: 'default' selects the " +
    "latest production TTS model; 'gradium-tts-beta' follows the current beta.",
  // Gradium has no model-list endpoint; these are the model names its docs define.
  fetchModels(): Promise<TtsModelInfo[]> {
    return Promise.resolve([
      { id: "default", label: "default — latest production TTS model" },
      { id: "gradium-tts-beta", label: "gradium-tts-beta — current beta model" },
    ]);
  },
  async fetchVoices(config, ctx): Promise<TtsVoiceInfo[]> {
    if (!config.apiKey?.trim()) throw new Error("No Gradium API key configured. Add it in the TTS panel.");
    try {
      const voices = await ttsGetJson<GradiumVoice[]>(
        VOICES_URL,
        { "x-api-key": config.apiKey.trim() },
        ctx,
      );
      return voices
        .filter((v) => typeof v.uid === "string" && v.uid.length > 0)
        .map((v) => ({
          id: v.uid as string,
          label: v.is_catalog
            ? (v.name ?? v.uid)
            : `${v.name ?? v.uid} (custom)`,
          language: v.language,
        }));
    } catch (error) {
      throwTtsProviderError(`${PROVIDER_LABEL} voice list`, error);
    }
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    if (!config.apiKey?.trim()) throw new Error("No Gradium API key configured. Add it in the TTS panel.");
    if (!config.voice?.trim()) throw new Error("No Gradium voice selected. Pick one in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "wav").toLowerCase();
    const format = FORMATS[formatKey] ?? FORMATS.wav!;
    try {
      const { audio, contentType } = await ttsPostForBinary(
        TTS_URL,
        { "x-api-key": config.apiKey.trim() },
        {
          text,
          voice_id: config.voice.trim(),
          output_format: format.output,
          only_audio: true,
          ...(config.model?.trim() && config.model.trim() !== "default"
            ? { model_name: config.model.trim() }
            : {}),
        },
        ctx,
      );
      return {
        audio,
        extension: format.extension,
        contentType,
        provider: "gradium",
        model: config.model?.trim() || "default",
        voice: config.voice,
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
