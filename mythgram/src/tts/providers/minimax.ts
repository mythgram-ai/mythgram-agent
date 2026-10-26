import { TtsProviderBase, type TtsProviderRuntime } from "./base.js";
import { asRecord, decodeHex, mimeForFormat, pickArray, pickString } from "./helpers.js";
import type { TtsAudioResult, TtsListOptions, TtsModel, TtsSynthesizeOptions, TtsVoice } from "../types.js";

/** Default MiniMax API base URL (international). */
export const MINIMAX_TTS_BASE_URL = "https://api.minimax.io";

/** Documented MiniMax speech model ids (no speech model-list endpoint is documented). */
const MINIMAX_MODELS = [
  "speech-2.8-hd", "speech-2.8-turbo",
  "speech-2.6-hd", "speech-2.6-turbo",
  "speech-02-hd", "speech-02-turbo",
] as const;

/** Map an engine format to a MiniMax `audio_setting.format`. */
function minimaxFormat(format: string | undefined, fallback: string): string {
  switch ((format || fallback || "mp3").trim().toLowerCase()) {
    case "wav":
      return "wav";
    case "pcm":
      return "pcm";
    case "flac":
      return "flac";
    case "opus":
    case "ogg":
      return "opus";
    default:
      return "mp3";
  }
}

/**
 * MiniMax text-to-speech (T2A v2).
 *
 *   POST {base}/v1/t2a_v2      — JSON in, hex-encoded audio out (`data.audio`)
 *   POST {base}/v1/get_voice   — voice catalog (POST, not GET)
 *
 * Auth uses `Authorization: Bearer`.
 *
 * Docs: https://platform.minimax.io/docs/api-reference/speech-t2a-http
 */
export class MiniMaxTtsProvider extends TtsProviderBase {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "minimax",
      name: "MiniMax",
      baseUrl: MINIMAX_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "mp3",
      ...runtime,
    });
  }

  private headers(apiKey: string): Record<string, string> {
    return this.withRuntimeHeaders({ Authorization: `Bearer ${(apiKey ?? "").trim()}`, "Content-Type": "application/json" });
  }

  async listModels(): Promise<TtsModel[]> {
    return MINIMAX_MODELS.map((id) => ({ id, name: id, voices: [], languages: [] }));
  }

  async listVoices(options: TtsListOptions): Promise<TtsVoice[]> {
    if (this.runtime.manualVoices.length > 0) {
      return this.runtime.manualVoices.map((id) => ({ id, name: id }));
    }
    const base = this.resolveBaseUrl(options.baseUrl);
    const payload = await this.fetchJson<Record<string, unknown>>(
      `${base}/v1/get_voice`,
      {
        method: "POST",
        headers: this.headers(options.apiKey),
        body: JSON.stringify({ voice_type: "all" }),
      },
      { signal: options.signal },
    );
    const voices: TtsVoice[] = [];
    const seen = new Set<string>();
    for (const key of ["system_voice", "voice_cloning", "voice_generation"]) {
      for (const item of pickArray(payload, key)) {
        const record = asRecord(item);
        if (!record) continue;
        const id = pickString(record, "voice_id", "voiceId");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        voices.push({ id, name: pickString(record, "voice_name", "name") || id });
      }
    }
    return voices;
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    if (!(options.apiKey ?? "").trim()) throw new Error("A MiniMax API key is required.");
    const voice = (options.voice ?? "").trim();
    if (!voice) throw new Error("A MiniMax voice id is required.");
    const base = this.resolveBaseUrl(options.baseUrl);
    const format = minimaxFormat(options.responseFormat, this.runtime.defaultFormat);
    const voiceSetting: Record<string, unknown> = { voice_id: voice };
    if (typeof options.speed === "number" && Number.isFinite(options.speed)) {
      voiceSetting.speed = Math.min(2, Math.max(0.5, options.speed));
    }
    const body: Record<string, unknown> = {
      model: options.model || "speech-2.8-hd",
      text: options.input,
      stream: false,
      output_format: "hex",
      voice_setting: voiceSetting,
      audio_setting: { format },
    };
    if (options.language) body.language_boost = options.language;

    const payload = await this.fetchJson<{
      data?: { audio?: string } | null;
      base_resp?: { status_code?: number; status_msg?: string };
    }>(
      `${base}/v1/t2a_v2`,
      { method: "POST", headers: this.headers(options.apiKey), body: JSON.stringify(body) },
      { signal: options.signal },
    );
    const status = payload.base_resp?.status_code;
    if (typeof status === "number" && status !== 0) {
      throw new Error(payload.base_resp?.status_msg || `MiniMax error ${status}`);
    }
    const hex = payload.data?.audio;
    if (!hex) throw new Error("MiniMax returned no audio.");
    return {
      bytes: decodeHex(hex),
      contentType: mimeForFormat(format),
      format,
      model: options.model || "speech-2.8-hd",
    };
  }
}
