/**
 * KittenML (KittenTTS) provider — OpenAI-compatible speech generation via
 * `POST https://api.kittenml.com/v1/audio/speech` (Bearer key, binary audio
 * response). Voices are fetched live from `GET /v1/voices?model=...`.
 * https://docs.kittenml.com/getting-started
 */
import type {
  TtsModelInfo,
  TtsProvider,
  TtsSynthesisResult,
  TtsVoiceInfo,
} from "../types.js";

import { ttsGetJson, ttsPostForBinary, throwTtsProviderError } from "../http.js";

const PROVIDER_LABEL = "KittenML";
const API_ROOT = "https://api.kittenml.com/v1";

const FORMATS: Record<string, { format: string; extension: string; contentType: string }> = {
  mp3: { format: "mp3", extension: "mp3", contentType: "audio/mpeg" },
  wav: { format: "wav", extension: "wav", contentType: "audio/wav" },
  pcm: { format: "pcm", extension: "pcm", contentType: "audio/pcm" },
};

/** KittenML TTS models (documented catalog — no model-list endpoint). */
const KITTEN_MODELS: TtsModelInfo[] = [
  { id: "kitten-tts-2-latest", label: "Kitten TTS 2 — 177 voices, voice cloning" },
  { id: "kitten-tts-nano-0.8", label: "KittenTTS nano 0.8 — 8 fixed English voices" },
  { id: "kitten-tts-micro-0.8", label: "KittenTTS micro 0.8 — 8 fixed English voices" },
  { id: "kitten-tts-mini-0.8", label: "KittenTTS mini 0.8 — 8 fixed English voices" },
];

/** The fixed eight-voice catalog of the KittenTTS 0.8 models (not listable via the API). */
const KITTEN_08_VOICES: TtsVoiceInfo[] = [
  { id: "Bella", label: "Bella — warm and expressive" },
  { id: "Jasper", label: "Jasper — clear and conversational" },
  { id: "Luna", label: "Luna — calm and smooth" },
  { id: "Bruno", label: "Bruno — deep and steady" },
  { id: "Rosie", label: "Rosie — bright and friendly" },
  { id: "Hugo", label: "Hugo — authoritative" },
  { id: "Kiki", label: "Kiki — lively and energetic" },
  { id: "Leo", label: "Leo — relaxed and natural" },
];

interface KittenVoice {
  id?: string;
  name?: string;
  type?: string;
  language?: string;
}

export const kittenmlTtsProvider: TtsProvider = {
  id: "kittenml",
  label: PROVIDER_LABEL,
  requiresApiKey: true,
  requiresBaseUrl: false,
  requiresVoice: true,
  instructions:
    "Use your KittenML API key (platform.kittenml.com). Pick a model (Kitten TTS 2 recommended) — its " +
    "built-in, saved and shared voices are fetched live. The 0.8 models use a fixed eight-voice catalog.",
  fetchModels(): Promise<TtsModelInfo[]> {
    return Promise.resolve(KITTEN_MODELS);
  },
  async fetchVoices(config, ctx): Promise<TtsVoiceInfo[]> {
    if (!config.apiKey?.trim()) throw new Error("No KittenML API key configured. Add it in the TTS panel.");
    const model = config.model?.trim() || "kitten-tts-2-latest";
    // The three 0.8 models have a fixed catalog the voices endpoint does not list.
    if (model.includes("0.8")) return Promise.resolve(KITTEN_08_VOICES);
    try {
      const data = await ttsGetJson<{ data?: KittenVoice[] }>(
        `${API_ROOT}/voices?model=${encodeURIComponent(model)}`,
        { Authorization: `Bearer ${config.apiKey.trim()}` },
        ctx,
      );
      return (data.data ?? [])
        .filter((v) => typeof v.id === "string" && v.id.length > 0)
        .map((v) => ({
          id: v.id as string,
          label: v.name ?? v.id,
          language: v.language,
        }));
    } catch (error) {
      throwTtsProviderError(`${PROVIDER_LABEL} voice list`, error);
    }
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    if (!config.apiKey?.trim()) throw new Error("No KittenML API key configured. Add it in the TTS panel.");
    if (!config.voice?.trim()) throw new Error("No KittenML voice selected. Pick one in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "mp3").toLowerCase();
    const format = FORMATS[formatKey] ?? FORMATS.mp3!;
    try {
      const { audio, contentType } = await ttsPostForBinary(
        `${API_ROOT}/audio/speech`,
        { Authorization: `Bearer ${config.apiKey.trim()}` },
        {
          model: config.model?.trim() || "kitten-tts-2-latest",
          input: text,
          voice: config.voice.trim(),
          response_format: format.format,
          // One complete file for quality over speed (KittenML extension).
          stream: false,
        },
        ctx,
      );
      return {
        audio,
        extension: format.extension,
        contentType,
        provider: "kittenml",
        model: config.model?.trim() || "kitten-tts-2-latest",
        voice: config.voice,
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
