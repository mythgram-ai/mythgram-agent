/**
 * MiniMax TTS provider — POSTs to `https://api.minimax.io/v1/t2a_v2` (Bearer
 * key); the response JSON carries hex-encoded audio in `data.audio`. Voices
 * are fetched live from `POST /v1/get_voice`. Models are the documented T2A
 * model versions. Some accounts require a `GroupId` query parameter.
 * https://platform.minimax.io/docs/api-reference/speech-t2a-http
 */
import { ttsPostJson, throwTtsProviderError } from "../http.js";
import type { TtsModelInfo, TtsProvider, TtsSynthesisResult, TtsToolsConfig, TtsVoiceInfo } from "../types.js";

const PROVIDER_LABEL = "MiniMax";
const API_ROOT = "https://api.minimax.io/v1";

const FORMATS: Record<string, { format: string; extension: string; contentType: string }> = {
  mp3: { format: "mp3", extension: "mp3", contentType: "audio/mpeg" },
  wav: { format: "wav", extension: "wav", contentType: "audio/wav" },
  pcm: { format: "pcm", extension: "pcm", contentType: "audio/pcm" },
  flac: { format: "flac", extension: "flac", contentType: "audio/flac" },
};

/** MiniMax T2A model versions (documented enum — no model-list endpoint). */
const MINIMAX_MODELS: TtsModelInfo[] = [
  { id: "speech-2.8-hd", label: "speech-2.8-hd" },
  { id: "speech-2.8-turbo", label: "speech-2.8-turbo" },
  { id: "speech-2.6-hd", label: "speech-2.6-hd" },
  { id: "speech-2.6-turbo", label: "speech-2.6-turbo" },
  { id: "speech-02-hd", label: "speech-02-hd" },
  { id: "speech-02-turbo", label: "speech-02-turbo" },
  { id: "speech-01-hd", label: "speech-01-hd" },
  { id: "speech-01-turbo", label: "speech-01-turbo" },
];

function groupSuffix(config: TtsToolsConfig): string {
  return config.minimaxGroupId?.trim() ? `?GroupId=${encodeURIComponent(config.minimaxGroupId.trim())}` : "";
}

function authHeaders(config: TtsToolsConfig): Record<string, string> {
  if (!config.apiKey?.trim()) throw new Error("No MiniMax API key configured. Add it in the TTS panel.");
  return { Authorization: `Bearer ${config.apiKey.trim()}` };
}

interface MiniMaxVoice {
  voice_id?: string;
  /** Older API versions return the id in `name`. */
  name?: string;
}

export const minimaxTtsProvider: TtsProvider = {
  id: "minimax",
  label: PROVIDER_LABEL,
  requiresApiKey: true,
  requiresBaseUrl: false,
  requiresVoice: true,
  instructions:
    "Use your MiniMax API key (and GroupId if your account uses one). Pick a model version and a " +
    "voice id from the live voice list (system voices + your cloned voices).",
  fetchModels(): Promise<TtsModelInfo[]> {
    return Promise.resolve(MINIMAX_MODELS);
  },
  async fetchVoices(config, ctx): Promise<TtsVoiceInfo[]> {
    try {
      const data = await ttsPostJson<{
        system_voice?: MiniMaxVoice[];
        voices?: MiniMaxVoice[];
        base_resp?: { status_code?: number; status_msg?: string };
      }>(
        `${API_ROOT}/get_voice${groupSuffix(config)}`,
        authHeaders(config),
        { voice_type: "all" },
        ctx,
      );
      if (data.base_resp && typeof data.base_resp.status_code === "number" && data.base_resp.status_code !== 0) {
        throw new Error(data.base_resp.status_msg || `MiniMax get_voice failed (${data.base_resp.status_code}).`);
      }
      const voices = [...(data.system_voice ?? []), ...(data.voices ?? [])];
      return voices
        .map((v) => ({ id: String(v.voice_id ?? v.name ?? ""), label: String(v.voice_id ?? v.name ?? "") }))
        .filter((v) => v.id.length > 0);
    } catch (error) {
      throwTtsProviderError(`${PROVIDER_LABEL} voice list`, error);
    }
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    if (!config.voice?.trim()) throw new Error("No MiniMax voice selected. Pick one in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "mp3").toLowerCase();
    const format = FORMATS[formatKey] ?? FORMATS.mp3!;
    try {
      const data = await ttsPostJson<{
        data?: { audio?: string };
        base_resp?: { status_code?: number; status_msg?: string };
      }>(
        `${API_ROOT}/t2a_v2${groupSuffix(config)}`,
        authHeaders(config),
        {
          model: config.model?.trim() || "speech-2.8-hd",
          text,
          stream: false,
          voice_setting: {
            voice_id: config.voice.trim(),
            ...(typeof config.speed === "number" && config.speed > 0
              ? { speed: Math.min(2, Math.max(0.5, config.speed)) }
              : {}),
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: format.format,
            channel: 1,
          },
        },
        ctx,
      );
      if (data.base_resp && typeof data.base_resp.status_code === "number" && data.base_resp.status_code !== 0) {
        throw new Error(data.base_resp.status_msg || `MiniMax TTS failed (${data.base_resp.status_code}).`);
      }
      const hex = data.data?.audio;
      if (!hex) throw new Error("MiniMax returned no audio data.");
      return {
        audio: Buffer.from(hex, "hex"),
        extension: format.extension,
        contentType: format.contentType,
        provider: "minimax",
        model: config.model?.trim() || "speech-2.8-hd",
        voice: config.voice,
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
