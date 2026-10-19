/**
 * Volcengine (ByteDance) TTS provider — POSTs to
 * `https://openspeech.bytedance.com/api/v1/tts` with `Authorization: Bearer;<token>`
 * and a JSON body carrying app/{appid,token,cluster}; the response JSON carries
 * Base64-encoded audio in `data` (success code 3000).
 * https://docs.volcengine.com/docs/DoubaoVoice/HTTPinterfaceone-timecomposition-non-streaming
 */
import type {
  TtsModelInfo,
  TtsProvider,
  TtsSynthesisResult,
  TtsVoiceInfo,
} from "../types.js";

import { ttsPostJson, throwTtsProviderError } from "../http.js";

const PROVIDER_LABEL = "Volcengine";
const TTS_URL = "https://openspeech.bytedance.com/api/v1/tts";

const FORMATS: Record<string, { encoding: string; extension: string; contentType: string }> = {
  mp3: { encoding: "mp3", extension: "mp3", contentType: "audio/mpeg" },
  wav: { encoding: "wav", extension: "wav", contentType: "audio/wav" },
  ogg: { encoding: "ogg_opus", extension: "ogg", contentType: "audio/ogg" },
  pcm: { encoding: "pcm", extension: "pcm", contentType: "audio/pcm" },
};

interface VolcResponse {
  code?: number;
  message?: string;
  data?: string;
  addition?: { duration?: string };
}

export const volcengineTtsProvider: TtsProvider = {
  id: "volcengine",
  label: PROVIDER_LABEL,
  requiresApiKey: true,
  requiresBaseUrl: false,
  requiresVoice: true,
  instructions:
    "Use your Volcengine access token plus the App ID (and cluster, default volcano_tts) from the " +
    "Volcengine console. Set the voice_type exactly as listed in the Volcengine voice catalog " +
    "(e.g. zh_female_vv_uranus_bigtts) — the catalog is documented at docs.volcengine.com; there is " +
    "no public voice-list API.",
  missingRequirements(config) {
    return config.volcengineAppId?.trim() ? [] : ["App ID"];
  },
  // Volcengine exposes no public model/voice-list endpoints.
  fetchModels(): Promise<TtsModelInfo[]> {
    return Promise.resolve([]);
  },
  fetchVoices(): Promise<TtsVoiceInfo[]> {
    return Promise.resolve([]);
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    if (!config.apiKey?.trim()) throw new Error("No Volcengine access token configured. Add it in the TTS panel.");
    if (!config.volcengineAppId?.trim()) {
      throw new Error("No Volcengine App ID configured. Add it in the TTS panel.");
    }
    if (!config.voice?.trim()) throw new Error("No Volcengine voice_type set. Enter one in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "mp3").toLowerCase();
    const format = FORMATS[formatKey] ?? FORMATS.mp3!;
    try {
      const data = await ttsPostJson<VolcResponse>(
        TTS_URL,
        {
          Authorization: `Bearer;${config.apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        {
          app: {
            appid: config.volcengineAppId.trim(),
            token: config.apiKey.trim(),
            cluster: config.volcengineCluster?.trim() || "volcano_tts",
          },
          user: { uid: "gptloop-tts" },
          audio: {
            voice_type: config.voice.trim(),
            encoding: format.encoding,
            ...(typeof config.speed === "number" && config.speed > 0
              ? { speed_ratio: Math.min(2, Math.max(0.1, config.speed)) }
              : {}),
          },
          request: {
            reqid: crypto.randomUUID(),
            text,
            text_type: "plain",
            operation: "query",
          },
        },
        ctx,
      );
      // 3000000-series codes are success; anything else carries a message.
      if (typeof data.code === "number" && data.code !== 3000) {
        throw new Error(data.message || `Volcengine TTS failed (code ${data.code}).`);
      }
      if (!data.data) throw new Error("Volcengine returned no audio data.");
      return {
        audio: Buffer.from(data.data, "base64"),
        extension: format.extension,
        contentType: format.contentType,
        provider: "volcengine",
        voice: config.voice,
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
