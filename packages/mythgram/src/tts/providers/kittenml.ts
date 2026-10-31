import { TTS_LIST_TIMEOUT_MS, ttsRequestJson } from "../client.js";
import { OpenAICompatibleTtsProvider, type TtsProviderRuntime } from "./base.js";
import type { TtsListOptions, TtsModel, TtsVoice } from "../types.js";

/** Default KittenML API base URL. */
export const KITTENML_TTS_BASE_URL = "https://api.kittenml.com/v1";

/**
 * The documented KittenML TTS model catalog. Used only as a fallback: the live
 * `/models` endpoint requires broader account eligibility and may be
 * unavailable even when a `tts:generate` key works, so the panel must still be
 * usable. Voices are always fetched live (see listVoices).
 */
const KITTENML_FALLBACK_MODELS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "kitten-tts-2-latest", name: "Kitten TTS 2" },
  { id: "kitten-tts-mini-0.8", name: "KittenTTS 0.8 Mini (80M)" },
  { id: "kitten-tts-micro-0.8", name: "KittenTTS 0.8 Micro (40M)" },
  { id: "kitten-tts-nano-0.8", name: "KittenTTS 0.8 Nano (15M)" },
];

/**
 * The three KittenTTS 0.8 models share a fixed eight-voice English catalog and
 * have no voice-listing endpoint. This mirrors the documented catalog and is
 * only used when listing a 0.8 model's voices.
 */
const KITTENML_08_VOICES: readonly string[] = [
  "Bella",
  "Jasper",
  "Luna",
  "Bruno",
  "Rosie",
  "Hugo",
  "Kiki",
  "Leo",
];

function isKitten08Model(model: string): boolean {
  return model.endsWith("-0.8");
}

/**
 * KittenML text-to-speech (Kitten TTS 2 + the KittenTTS 0.8 family).
 *
 *   POST {base}/audio/speech   — synthesize (OpenAI-compatible)
 *   GET  {base}/voices?model=  — list voices for a model (Kitten TTS 2)
 *
 * Docs: https://docs.kittenml.com/tts/generate-speech
 */
export class KittenMlTtsProvider extends OpenAICompatibleTtsProvider {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "kittenml",
      name: "KittenML",
      baseUrl: KITTENML_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "mp3",
      ...runtime,
    });
  }

  /** The `/models` endpoint may be unavailable; fall back to the documented set. */
  override async listModels(options: TtsListOptions): Promise<TtsModel[]> {
    try {
      const models = await super.listModels(options);
      if (models.length > 0) return models;
    } catch {
      // fall through to the documented catalog
    }
    return KITTENML_FALLBACK_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      voices: isKitten08Model(m.id)
        ? KITTENML_08_VOICES.map((id) => ({ id, name: id, model: m.id }))
        : [],
      languages: isKitten08Model(m.id) ? ["en"] : [],
    }));
  }

  /** List the voices for a model via the authenticated `/voices` endpoint. */
  override async listVoices(options: TtsListOptions, model?: string): Promise<TtsVoice[]> {
    if (this.runtime.manualVoices.length > 0) {
      return this.runtime.manualVoices.map((id) => ({ id, name: id, model }));
    }
    const base = this.resolveBaseUrl(options.baseUrl);
    const target = model || this.runtime.manualModels[0] || "kitten-tts-2-latest";
    try {
      const payload = await ttsRequestJson<{ data?: unknown[] }>(
        `${base}/voices?model=${encodeURIComponent(target)}`,
        { method: "GET", headers: this.requestHeaders(options.apiKey) },
        { fetchFn: this.runtime.fetchFn, timeoutMs: TTS_LIST_TIMEOUT_MS, signal: options.signal },
      );
      const items = Array.isArray(payload.data) ? payload.data : [];
      const voices: TtsVoice[] = [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const id = String(record.id ?? "").trim();
        if (!id) continue;
        const voice: TtsVoice = {
          id,
          name: String(record.name ?? id).trim() || id,
          model: String(record.model ?? target).trim() || target,
        };
        if (typeof record.language === "string" && record.language.trim()) {
          voice.language = record.language.trim();
        }
        if (typeof record.type === "string" && record.type.trim()) voice.type = record.type.trim();
        voices.push(voice);
      }
      if (voices.length > 0) return voices;
    } catch (error) {
      // A 0.8 model has no listing endpoint — use its fixed catalog regardless.
      if (!isKitten08Model(target)) throw error;
    }
    if (isKitten08Model(target)) {
      return KITTENML_08_VOICES.map((id) => ({ id, name: id, model: target, language: "en" }));
    }
    return [];
  }
}
