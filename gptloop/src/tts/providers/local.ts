/**
 * Local TTS Studio provider — the pre-created local service that runs the open
 * source TTS models (Kokoro, KittenTTS, Pocket TTS, Piper) and exposes an
 * OpenAI-compatible speech API (https://github.com/opengptloop/tts-studio).
 *
 * The server owns ALL configuration: the user picks the TTS model, voice,
 * speed and output format once on TTS Studio's in-app API page. Clients only
 * ever POST plain text to `{base-url}/audio/speech` — there is deliberately
 * nothing to configure here, which is why this adapter exposes no model or
 * voice catalog of its own.
 *
 * Base URL: the studio origin plus `/v1` (e.g. `http://127.0.0.1:8000/v1`).
 * A bare origin is accepted and `/v1` is appended automatically. API keys are
 * optional (open mode by default; `sk-tts-...` when "require key" is enabled).
 */
import {
  normalizeOpenAiSpeechBaseUrl,
  ttsGetJson,
  ttsPostForBinary,
  throwTtsProviderError,
} from "../http.js";
import type { TtsModelInfo, TtsProvider, TtsSynthesisResult, TtsToolsConfig, TtsVoiceInfo } from "../types.js";

const PROVIDER_LABEL = "TTS Studio (local)";

/** Media type + extension per requested output format (mp3 is the studio default). */
const FORMATS: Record<string, { extension: string; contentType: string }> = {
  mp3: { extension: "mp3", contentType: "audio/mpeg" },
  opus: { extension: "ogg", contentType: "audio/ogg" },
  aac: { extension: "aac", contentType: "audio/aac" },
  flac: { extension: "flac", contentType: "audio/flac" },
  wav: { extension: "wav", contentType: "audio/wav" },
  pcm: { extension: "pcm", contentType: "audio/pcm" },
};

/** TTS Studio `GET /v1` service info payload. */
export interface TtsStudioInfo {
  status?: string;
  service?: string;
  auth_required?: boolean;
  endpoints?: { speech?: string };
}

/** Resolve the `/v1` speech root from the user-entered base URL. */
export function ttsStudioSpeechRoot(config: TtsToolsConfig): string {
  return normalizeOpenAiSpeechBaseUrl(config.baseUrl ?? "");
}

/** Check the local studio's service-info endpoint; returns its info when reachable. */
export async function ttsStudioStatus(
  config: TtsToolsConfig,
  ctx?: { signal?: AbortSignal },
): Promise<{ reachable: boolean; info?: TtsStudioInfo; error?: string }> {
  const root = ttsStudioSpeechRoot(config);
  if (!root) return { reachable: false, error: "No base URL configured." };
  try {
    const info = await ttsGetJson<TtsStudioInfo>(root, {}, ctx);
    return { reachable: true, info };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export const localTtsProvider: TtsProvider = {
  id: "local",
  label: PROVIDER_LABEL,
  requiresApiKey: false,
  requiresBaseUrl: true,
  // The voice/model are configured inside TTS Studio — the client never picks them.
  requiresVoice: false,
  instructions:
    "Run TTS Studio locally (pip install tts-studio, then run `tts-studio`), open its web UI, " +
    "install an engine and pick a TTS model + voice on its API page. Then paste the base URL " +
    "shown there (default http://127.0.0.1:8000/v1) below and connect. Nothing else to configure — " +
    "model/voice changes you save in TTS Studio apply automatically.",
  fetchModels(): Promise<TtsModelInfo[]> {
    // Deliberately empty: the model is chosen inside TTS Studio's web UI, not here.
    return Promise.resolve([]);
  },
  fetchVoices(): Promise<TtsVoiceInfo[]> {
    // Deliberately empty: the voice is chosen inside TTS Studio's web UI, not here.
    return Promise.resolve([]);
  },
  async synthesize(
    text: string,
    config: TtsToolsConfig,
    ctx,
  ): Promise<TtsSynthesisResult> {
    const root = ttsStudioSpeechRoot(config);
    if (!root) throw new Error("No TTS Studio base URL configured. Add it in the TTS panel.");
    const format = FORMATS[(config.outputFormat?.trim() || "mp3").toLowerCase()] ?? FORMATS.mp3!;
    const headers: Record<string, string> = {};
    if (config.apiKey?.trim()) headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    try {
      const { audio, contentType } = await ttsPostForBinary(
        `${root}/audio/speech`,
        headers,
        { input: text, output: (config.outputFormat?.trim() || "mp3").toLowerCase() },
        ctx,
      );
      return {
        audio,
        extension: format.extension,
        contentType,
        provider: "local",
        model: "server-configured",
        voice: "server-configured",
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
