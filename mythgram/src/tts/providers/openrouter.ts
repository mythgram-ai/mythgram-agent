import { OpenAICompatibleTtsProvider, type TtsProviderRuntime } from "./base.js";

/** Default OpenRouter API base URL. */
export const OPENROUTER_TTS_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter text-to-speech.
 *
 * OpenRouter exposes an OpenAI-compatible `POST /audio/speech` endpoint and a
 * models listing filtered to speech output. Voices are advertised per model in
 * the `supported_voices` field, so both models and voices are fetched live.
 *
 * Docs: https://openrouter.ai/docs/guides/overview/multimodal/tts
 */
export class OpenRouterTtsProvider extends OpenAICompatibleTtsProvider {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "openrouter",
      name: "OpenRouter",
      baseUrl: OPENROUTER_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "mp3",
      ...runtime,
    });
  }

  /**
   * Attribute requests to the app (optional on OpenRouter but recommended so
   * generations are visible on the dashboard).
   */
  protected override requestHeaders(apiKey: string): Record<string, string> {
    const headers = super.requestHeaders(apiKey);
    headers["HTTP-Referer"] ??= "https://github.com/mythgram";
    headers["X-Title"] ??= "Mythgram";
    return headers;
  }

  /** Only speech-output models are relevant for TTS. */
  protected override modelsUrl(base: string): string {
    return `${base}/models?output_modalities=speech`;
  }
}
