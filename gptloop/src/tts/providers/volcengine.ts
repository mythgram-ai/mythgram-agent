import { randomUUID } from "node:crypto";
import { TtsProviderBase, type TtsProviderRuntime } from "./base.js";
import { decodeBase64, mimeForFormat } from "./helpers.js";
import type { TtsAudioResult, TtsListOptions, TtsModel, TtsSynthesizeOptions, TtsVoice } from "../types.js";

/** Default Volcengine (ByteDance) speech API base URL. */
export const VOLCENGINE_TTS_BASE_URL = "https://openspeech.bytedance.com";

/** Documented clusters; used as the "model" selector. */
const VOLCENGINE_CLUSTERS = ["volcano_tts", "volcano_icl"] as const;

/** Sample of the documented large-model voice catalog. */
const VOLCENGINE_VOICES = [
  "zh_female_vv_uranus_bigtts", "zh_female_xiaohe_uranus_bigtts", "zh_male_m191_uranus_bigtts",
  "zh_male_taocheng_uranus_bigtts", "en_male_tim_uranus_bigtts", "en_female_dacey_uranus_bigtts",
  "zh_male_M392_conversation_wvae_bigtts", "zh_female_shuangkuaisisi_moon_bigtts",
];

/** Map an engine format to a Volcengine `encoding`. */
function volcengineEncoding(format: string | undefined, fallback: string): string {
  switch ((format || fallback || "mp3").trim().toLowerCase()) {
    case "wav":
      return "wav";
    case "pcm":
      return "pcm";
    case "opus":
    case "ogg":
      return "ogg_opus";
    default:
      return "mp3";
  }
}

/**
 * Volcengine (ByteDance Doubao) speech synthesis.
 *
 *   POST {base}/api/v1/tts  — JSON in, base64 audio out (`data`)
 *
 * Auth uses `Authorization: Bearer;<token>` (semicolon, no space). The API key
 * field accepts either the bare access token, or `appid:token` when the account
 * requires an app id. The "model" selector is the cluster (`volcano_tts`).
 *
 * Docs: https://www.volcengine.com/docs/6561/1257584
 */
export class VolcengineTtsProvider extends TtsProviderBase {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "volcengine",
      name: "Volcengine",
      baseUrl: VOLCENGINE_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "mp3",
      ...runtime,
    });
  }

  async listModels(): Promise<TtsModel[]> {
    return VOLCENGINE_CLUSTERS.map((id) => ({ id, name: id, voices: [], languages: [] }));
  }

  async listVoices(_options: TtsListOptions, model?: string): Promise<TtsVoice[]> {
    return VOLCENGINE_VOICES.map((id) => ({ id, name: id, model: model || undefined }));
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    const rawKey = (options.apiKey ?? "").trim();
    if (!rawKey) throw new Error("A Volcengine access token is required.");
    // Accept "appid:token" or a bare token (app id defaults to the token).
    const colon = rawKey.indexOf(":");
    const appid = colon > 0 ? rawKey.slice(0, colon) : rawKey;
    const token = colon > 0 ? rawKey.slice(colon + 1) : rawKey;

    const bytes = Buffer.byteLength(options.input, "utf8");
    if (bytes > 1024) throw new Error("Volcengine accepts at most 1024 bytes of UTF-8 text per request.");

    const base = this.resolveBaseUrl(options.baseUrl);
    const encoding = volcengineEncoding(options.responseFormat, this.runtime.defaultFormat);
    const audio: Record<string, unknown> = {
      voice_type: options.voice || VOLCENGINE_VOICES[0],
      encoding,
    };
    if (typeof options.speed === "number" && Number.isFinite(options.speed)) {
      audio.speed_ratio = Math.min(2, Math.max(0.1, options.speed));
    }
    const body = {
      app: { appid, token, cluster: options.model || "volcano_tts" },
      user: { uid: "gptloop" },
      audio,
      request: { reqid: randomUUID(), text: options.input, operation: "query" },
    };

    const payload = await this.fetchJson<{ code?: number; message?: string; data?: string }>(
      `${base}/api/v1/tts`,
      {
        method: "POST",
        headers: this.withRuntimeHeaders({
          Authorization: `Bearer;${token}`,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(body),
      },
      { signal: options.signal },
    );
    if (typeof payload.code === "number" && payload.code !== 3000) {
      throw new Error(payload.message || `Volcengine error ${payload.code}`);
    }
    if (!payload.data) throw new Error("Volcengine returned no audio.");
    return {
      bytes: decodeBase64(payload.data),
      contentType: mimeForFormat(encoding === "ogg_opus" ? "opus" : encoding),
      format: encoding === "ogg_opus" ? "opus" : encoding,
      model: options.model || "volcano_tts",
    };
  }
}
