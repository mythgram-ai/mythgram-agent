import type { TtsFetch } from "./client.js";
import { CustomTtsProvider } from "./providers/custom.js";
import { KittenMlTtsProvider, KITTENML_TTS_BASE_URL } from "./providers/kittenml.js";
import { OpenRouterTtsProvider, OPENROUTER_TTS_BASE_URL } from "./providers/openrouter.js";
import type { TtsHeader, TtsProviderConfig } from "./types.js";
import type { TtsProvider } from "./providers/base.js";

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
  switch (config.kind) {
    case "openrouter":
      return new OpenRouterTtsProvider({
        baseUrl: config.baseUrl || OPENROUTER_TTS_BASE_URL,
        fetchFn: options.fetchFn,
      });
    case "kittenml":
      return new KittenMlTtsProvider({
        baseUrl: config.baseUrl || KITTENML_TTS_BASE_URL,
        fetchFn: options.fetchFn,
      });
    case "custom":
      return new CustomTtsProvider({
        id: config.id,
        name: config.name,
        baseUrl: config.baseUrl,
        headers: headersRecord(config.headers),
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
