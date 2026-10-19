import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";
import type { TtsModelInfo, TtsProviderInfo, TtsSettings, TtsSpeechFile, TtsVoiceInfo } from "@/types";

/**
 * TTS panel API client — talks to the backend's /api/tts routes, which do the
 * actual provider calls server-side (so keys and localhost URLs never need
 * CORS or browser access).
 */

/** The per-provider payload the catalog/status/preview endpoints accept. */
export type TtsRequestConfig = Omit<TtsSettings, "provider"> & { provider: string };

export function ttsRequestConfig(tts: TtsSettings, providerOverride?: string): TtsRequestConfig {
  return {
    provider: providerOverride ?? tts.provider ?? "",
    apiKey: tts.apiKey,
    baseUrl: tts.baseUrl,
    model: tts.model,
    voice: tts.voice,
    language: tts.language,
    speed: tts.speed,
    outputFormat: tts.outputFormat,
    instructions: tts.instructions,
    azureRegion: tts.azureRegion,
    volcengineAppId: tts.volcengineAppId,
    volcengineCluster: tts.volcengineCluster,
    minimaxGroupId: tts.minimaxGroupId,
  };
}

/** List every supported TTS provider with requirements + setup instructions. */
export async function fetchTtsProviders(): Promise<TtsProviderInfo[]> {
  const data = await requestJson<{ providers?: TtsProviderInfo[] }>(
    routeUrl(API_ROUTES.ttsProviders),
  );
  return data.providers ?? [];
}

/** Fetch the live model catalog for a provider (POST /api/tts/models). */
export async function fetchTtsModels(config: TtsRequestConfig): Promise<TtsModelInfo[]> {
  const data = await requestJson<{ models?: TtsModelInfo[] }>(routeUrl(API_ROUTES.ttsModels), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  return data.models ?? [];
}

/** Fetch the live voice catalog for a provider (POST /api/tts/voices). */
export async function fetchTtsVoices(config: TtsRequestConfig): Promise<TtsVoiceInfo[]> {
  const data = await requestJson<{ voices?: TtsVoiceInfo[] }>(routeUrl(API_ROUTES.ttsVoices), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  return data.voices ?? [];
}

export interface TtsLocalStatus {
  reachable: boolean;
  info?: { status?: string; service?: string; auth_required?: boolean };
  error?: string;
}

/** Check whether the local TTS Studio service answers at the given base URL. */
export async function fetchTtsLocalStatus(baseUrl: string): Promise<TtsLocalStatus> {
  return requestJson<TtsLocalStatus>(routeUrl(API_ROUTES.ttsLocalStatus), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl }),
  });
}

/** Synthesize a short preview clip; resolves to the saved workspace file. */
export async function fetchTtsPreview(
  config: TtsRequestConfig,
  text?: string,
): Promise<TtsSpeechFile> {
  const data = await requestJson<{ ok?: boolean; file?: TtsSpeechFile }>(
    routeUrl(API_ROUTES.ttsPreview),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, text }),
    },
  );
  if (!data.file) throw new Error("Preview request returned no audio file.");
  return data.file;
}

/** Strip a trailing `/v1` (and slash) from a TTS Studio base URL to get its web UI origin. */
export function ttsStudioWebUiUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}
