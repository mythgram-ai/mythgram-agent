import { TtsProviderBase, type TtsProviderRuntime } from "./base.js";
import { decodeBase64, mimeForFormat } from "./helpers.js";
import type { TtsAudioResult, TtsListOptions, TtsModel, TtsSynthesizeOptions, TtsVoice } from "../types.js";

/** Default Sarvam AI API base URL. */
export const SARVAM_TTS_BASE_URL = "https://api.sarvam.ai";

/** Documented Bulbul model ids (no models endpoint exists). */
const SARVAM_MODELS = ["bulbul:v4-flash", "bulbul:v3", "bulbul:v2"] as const;

const SARVAM_V3_VOICES = [
  "shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan", "simran", "kavya",
  "amit", "dev", "ishita", "shreya", "ratan", "varun", "manan", "sumit", "roopa", "kabir",
  "aayan", "ashutosh", "advait", "anand", "tanya", "tarun", "sunny", "mani", "gokul", "vijay",
  "shruti", "suhani", "mohit", "kavitha", "rehan", "soham", "rupali",
];

const SARVAM_V2_VOICES = ["anushka", "manisha", "vidya", "arya", "abhilash", "karun", "hitesh"];

/** A sample of the large v4-flash persona catalog (`<name>_<language>_<style>`). */
const SARVAM_V4_VOICES = [
  "shubh_enhi_ads", "simran_en_customer", "ishita_hi_devotional", "aditya_en_news", "ritu_hi_story",
];

/** Map an engine format to a Sarvam output codec. */
function sarvamCodec(format: string | undefined, fallback: string): string {
  const value = (format || fallback || "wav").trim().toLowerCase();
  if (value === "pcm") return "linear16";
  if (value === "ogg") return "opus";
  return ["mp3", "wav", "flac", "aac", "opus", "linear16", "mulaw", "alaw"].includes(value)
    ? value
    : "wav";
}

/**
 * Sarvam AI (Bulbul) text-to-speech.
 *
 *   POST {base}/text-to-speech  — JSON in, base64 `audios` out
 *
 * Auth uses the `api-subscription-key` header (not Bearer). There is no models
 * or voices listing endpoint, so the documented catalogs are used.
 *
 * Docs: https://docs.sarvam.ai/api-reference/text-to-speech/convert
 */
export class SarvamTtsProvider extends TtsProviderBase {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "sarvam",
      name: "Sarvam AI",
      baseUrl: SARVAM_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "wav",
      ...runtime,
    });
  }

  async listModels(): Promise<TtsModel[]> {
    return SARVAM_MODELS.map((id) => ({ id, name: id, voices: [], languages: [] }));
  }

  async listVoices(_options: TtsListOptions, model?: string): Promise<TtsVoice[]> {
    const id = model ?? "";
    const list = id.includes("v2") ? SARVAM_V2_VOICES : id.includes("v4") ? SARVAM_V4_VOICES : SARVAM_V3_VOICES;
    return list.map((voice) => ({ id: voice, name: voice, model: model || undefined }));
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    if (!(options.apiKey ?? "").trim()) throw new Error("A Sarvam AI API key is required.");
    const base = this.resolveBaseUrl(options.baseUrl);
    const model = (options.model || "bulbul:v3").trim();
    const codec = sarvamCodec(options.responseFormat, this.runtime.defaultFormat);
    const body: Record<string, unknown> = {
      text: options.input,
      language_code: (options.language || "en-IN").trim(),
      model,
      output_audio_codec: codec,
    };
    if (options.voice) body.speaker = options.voice;
    if (typeof options.speed === "number" && Number.isFinite(options.speed)) body.pace = options.speed;

    const payload = await this.fetchJson<{ audios?: unknown }>(
      `${base}/text-to-speech`,
      {
        method: "POST",
        headers: this.withRuntimeHeaders({
          "api-subscription-key": options.apiKey,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(body),
      },
      { signal: options.signal },
    );
    const audios = Array.isArray(payload.audios) ? (payload.audios as unknown[]) : [];
    const first = audios.find((a): a is string => typeof a === "string" && a.length > 0);
    if (!first) throw new Error("Sarvam AI returned no audio.");
    return { bytes: decodeBase64(first), contentType: mimeForFormat(codec), format: codec, model };
  }
}
