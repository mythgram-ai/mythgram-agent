/**
 * OpenRouter TTS provider — OpenRouter routes text-to-speech to speech models
 * (OpenAI GPT-4o Mini TTS, Gemini TTS, Voxtral Mini TTS, …) through its
 * OpenAI-compatible `POST /api/v1/audio/speech` endpoint, which returns raw
 * audio bytes. Models are discovered live via
 * `GET /api/v1/models?output_modalities=speech`. Voices are per-model (no
 * global voice-list endpoint) and are documented on each model's page.
 * https://openrouter.ai/docs/guides/overview/multimodal/tts
 */
import type {
  TtsModelInfo,
  TtsProvider,
  TtsSynthesisResult,
  TtsVoiceInfo,
} from "../types.js";

import { ttsGetJson, ttsPostForBinary, throwTtsProviderError } from "../http.js";

const PROVIDER_LABEL = "OpenRouter";
const SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
const MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=speech";

const FORMAT_EXTENSIONS: Record<string, { extension: string; contentType: string }> = {
  mp3: { extension: "mp3", contentType: "audio/mpeg" },
  pcm: { extension: "pcm", contentType: "audio/pcm" },
};

interface OpenRouterModel {
  id?: string;
  name?: string;
}

export const openRouterTtsProvider: TtsProvider = {
  id: "openrouter",
  label: PROVIDER_LABEL,
  requiresApiKey: true,
  requiresBaseUrl: false,
  requiresVoice: false,
  instructions:
    "Use your OpenRouter API key. Pick a TTS model (fetched live, filtered to speech-output models) " +
    "and a voice supported by that model — each model's supported voices are listed on its OpenRouter " +
    "model page. Output format: mp3 or pcm.",
  async fetchModels(_config, ctx): Promise<TtsModelInfo[]> {
    try {
      const data = await ttsGetJson<{ data?: OpenRouterModel[] }>(
        MODELS_URL,
        {},
        ctx,
      );
      return (data.data ?? [])
        .filter((m) => typeof m.id === "string" && m.id.length > 0)
        .map((m) => ({ id: m.id as string, label: m.name ?? m.id }));
    } catch (error) {
      throwTtsProviderError(`${PROVIDER_LABEL} model list`, error);
    }
  },
  fetchVoices(): Promise<TtsVoiceInfo[]> {
    // OpenRouter has no cross-provider voice-list endpoint; voices are per model.
    return Promise.resolve([]);
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    if (!config.apiKey?.trim()) throw new Error("No OpenRouter API key configured. Add it in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "mp3").toLowerCase();
    const format = FORMAT_EXTENSIONS[formatKey] ?? FORMAT_EXTENSIONS.mp3!;
    const headers = { Authorization: `Bearer ${config.apiKey.trim()}` };
    try {
      const { audio, contentType } = await ttsPostForBinary(
        SPEECH_URL,
        headers,
        {
          model: config.model?.trim(),
          input: text,
          ...(config.voice?.trim() ? { voice: config.voice.trim() } : {}),
          response_format: formatKey,
          ...(config.instructions?.trim() ? { instructions: config.instructions.trim() } : {}),
        },
        ctx,
      );
      return {
        audio,
        extension: format.extension,
        contentType,
        provider: "openrouter",
        model: config.model,
        voice: config.voice,
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
