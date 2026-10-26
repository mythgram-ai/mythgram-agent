import type { TtsFetch } from "./client.js";
import { CustomTtsProvider } from "./providers/custom.js";
import { KittenMlTtsProvider, KITTENML_TTS_BASE_URL } from "./providers/kittenml.js";
import { OpenRouterTtsProvider, OPENROUTER_TTS_BASE_URL } from "./providers/openrouter.js";
import { SarvamTtsProvider, SARVAM_TTS_BASE_URL } from "./providers/sarvam.js";
import { AzureTtsProvider, AZURE_TTS_BASE_URL } from "./providers/azure.js";
import { ElevenLabsTtsProvider, ELEVENLABS_TTS_BASE_URL } from "./providers/elevenlabs.js";
import { GoogleTtsProvider, GOOGLE_TTS_BASE_URL } from "./providers/google.js";
import { GradiumTtsProvider, GRADIUM_TTS_BASE_URL } from "./providers/gradium.js";
import { InworldTtsProvider, INWORLD_TTS_BASE_URL } from "./providers/inworld.js";
import { MiniMaxTtsProvider, MINIMAX_TTS_BASE_URL } from "./providers/minimax.js";
import { VolcengineTtsProvider, VOLCENGINE_TTS_BASE_URL } from "./providers/volcengine.js";
import { XaiTtsProvider, XAI_TTS_BASE_URL } from "./providers/xai.js";
import { MimoTtsProvider, MIMO_TTS_BASE_URL } from "./providers/mimo.js";
import type { TtsHeader, TtsProviderConfig } from "./types.js";
import type { TtsProvider, TtsProviderRuntime } from "./providers/base.js";

/** Collapse a stored header list into a request header record. */
function headersRecord(headers: TtsHeader[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of headers) {
    const k = (key ?? "").trim();
    if (k) out[k] = value;
  }
  return out;
}

/**
 * Materialize a live provider adapter from a stored configuration.
 *
 * Adding a new built-in provider is a two-line change: add a `case` here and a
 * catalog entry in configuration.ts.
 */
export function buildTtsProvider(
  config: TtsProviderConfig,
  options: { fetchFn?: TtsFetch } = {},
): TtsProvider {
  const base = (defaultBase: string): Partial<TtsProviderRuntime> => ({
    baseUrl: config.baseUrl || defaultBase,
    fetchFn: options.fetchFn,
  });
  const userHeaders = headersRecord(config.headers);

  switch (config.kind) {
    case "openrouter":
      return new OpenRouterTtsProvider(base(OPENROUTER_TTS_BASE_URL));
    case "kittenml":
      return new KittenMlTtsProvider(base(KITTENML_TTS_BASE_URL));
    case "sarvam":
      return new SarvamTtsProvider(base(SARVAM_TTS_BASE_URL));
    case "azure":
      return new AzureTtsProvider(base(AZURE_TTS_BASE_URL));
    case "elevenlabs":
      return new ElevenLabsTtsProvider(base(ELEVENLABS_TTS_BASE_URL));
    case "google":
      return new GoogleTtsProvider(base(GOOGLE_TTS_BASE_URL));
    case "gradium":
      return new GradiumTtsProvider(base(GRADIUM_TTS_BASE_URL));
    case "inworld":
      return new InworldTtsProvider(base(INWORLD_TTS_BASE_URL));
    case "minimax":
      return new MiniMaxTtsProvider(base(MINIMAX_TTS_BASE_URL));
    case "volcengine":
      return new VolcengineTtsProvider(base(VOLCENGINE_TTS_BASE_URL));
    case "xai":
      return new XaiTtsProvider(base(XAI_TTS_BASE_URL));
    case "mimo":
      return new MimoTtsProvider(base(MIMO_TTS_BASE_URL));
    case "custom":
      return new CustomTtsProvider({
        id: config.id,
        name: config.name,
        baseUrl: config.baseUrl,
        headers: userHeaders,
        models: config.models,
        voices: config.voices,
        responseFormat: config.responseFormat || "mp3",
        fetchFn: options.fetchFn,
      });
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Unsupported TTS provider kind: ${String(exhaustive)}`);
    }
  }
}
