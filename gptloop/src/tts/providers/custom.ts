/**
 * Custom OpenAI-compatible TTS provider — point it at ANY server that exposes
 * the OpenAI `POST /v1/audio/speech` shape (llama.cpp server, OpenAI itself,
 * a self-hosted proxy, …). Localhost URLs are explicitly allowed.
 *
 * The endpoint is `{base-url}/audio/speech` with `{model, input, voice,
 * response_format}` and a binary audio response. A base URL with no path gets
 * `/v1` appended automatically.
 */
import type {
  TtsModelInfo,
  TtsProvider,
  TtsSynthesisResult,
  TtsVoiceInfo,
} from "../types.js";

import {
  normalizeOpenAiSpeechBaseUrl,
  ttsGetJson,
  ttsPostForBinary,
  throwTtsProviderError,
} from "../http.js";

const PROVIDER_LABEL = "Custom OpenAI-compatible TTS";

const FORMAT_EXTENSIONS: Record<string, { extension: string; contentType: string }> = {
  mp3: { extension: "mp3", contentType: "audio/mpeg" },
  opus: { extension: "ogg", contentType: "audio/ogg" },
  aac: { extension: "aac", contentType: "audio/aac" },
  flac: { extension: "flac", contentType: "audio/flac" },
  wav: { extension: "wav", contentType: "audio/wav" },
  pcm: { extension: "pcm", contentType: "audio/pcm" },
};

export const customTtsProvider: TtsProvider = {
  id: "custom",
  label: PROVIDER_LABEL,
  requiresApiKey: false,
  requiresBaseUrl: true,
  // Some OpenAI-compatible servers (e.g. TTS Studio) configure the voice server-side.
  requiresVoice: false,
  instructions:
    "Point this at any OpenAI-compatible speech endpoint: it will call POST {base-url}/audio/speech " +
    "with {model, input, voice, response_format}. Localhost URLs are allowed. Add an API key only if " +
    "your server requires one (sent as a Bearer token).",
  async fetchModels(config, ctx): Promise<TtsModelInfo[]> {
    // Best-effort OpenAI-compatible model listing: GET {base-url}/models.
    const root = normalizeOpenAiSpeechBaseUrl(config.baseUrl ?? "");
    if (!root) return [];
    try {
      const data = await ttsGetJson<{ data?: Array<{ id?: string }> }>(
        `${root}/models`,
        config.apiKey?.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {},
        ctx,
      );
      return (data.data ?? [])
        .map((m) => ({ id: String(m.id ?? "") }))
        .filter((m) => m.id.length > 0);
    } catch {
      // Listing is optional — the user can type the model id manually.
      return [];
    }
  },
  fetchVoices(): Promise<TtsVoiceInfo[]> {
    // No standard voice-list endpoint on OpenAI-compatible servers — the user picks a voice manually.
    return Promise.resolve([]);
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    const root = normalizeOpenAiSpeechBaseUrl(config.baseUrl ?? "");
    if (!root) throw new Error("No custom TTS base URL configured. Add it in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "mp3").toLowerCase();
    const format = FORMAT_EXTENSIONS[formatKey] ?? FORMAT_EXTENSIONS.mp3!;
    const headers: Record<string, string> = {};
    if (config.apiKey?.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    try {
      const { audio, contentType } = await ttsPostForBinary(
        `${root}/audio/speech`,
        headers,
        {
          model: config.model?.trim() || "tts-1",
          input: text,
          ...(config.voice?.trim() ? { voice: config.voice.trim() } : {}),
          response_format: formatKey,
        },
        ctx,
      );
      return {
        audio,
        extension: format.extension,
        contentType,
        provider: "custom",
        model: config.model,
        voice: config.voice,
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
