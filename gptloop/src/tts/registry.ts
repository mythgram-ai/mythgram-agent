/**
 * TTS provider registry — one source of truth for every supported provider.
 * The generate_speech tool resolves the user's active provider here; the
 * /api/tts endpoints use it for the live model/voice catalogs.
 */
import type { TtsProvider, TtsProviderId } from "./types.js";
import { localTtsProvider } from "./providers/local.js";
import { openRouterTtsProvider } from "./providers/openrouter.js";
import { azureTtsProvider } from "./providers/azure.js";
import { elevenLabsTtsProvider } from "./providers/elevenlabs.js";
import { googleTtsProvider } from "./providers/google.js";
import { gradiumTtsProvider } from "./providers/gradium.js";
import { inworldTtsProvider } from "./providers/inworld.js";
import { minimaxTtsProvider } from "./providers/minimax.js";
import { volcengineTtsProvider } from "./providers/volcengine.js";
import { xaiTtsProvider } from "./providers/xai.js";
import { mimoTtsProvider } from "./providers/mimo.js";
import { kittenmlTtsProvider } from "./providers/kittenml.js";
import { customTtsProvider } from "./providers/custom.js";

/** Every supported TTS provider, in panel display order (local first). */
const ALL_PROVIDERS: readonly TtsProvider[] = [
  localTtsProvider,
  openRouterTtsProvider,
  azureTtsProvider,
  elevenLabsTtsProvider,
  googleTtsProvider,
  gradiumTtsProvider,
  inworldTtsProvider,
  minimaxTtsProvider,
  volcengineTtsProvider,
  xaiTtsProvider,
  mimoTtsProvider,
  kittenmlTtsProvider,
  customTtsProvider,
];

const PROVIDERS_BY_ID = new Map<string, TtsProvider>(ALL_PROVIDERS.map((p) => [p.id, p]));

/** Every supported provider id (for the panel's provider picker). */
export const TTS_PROVIDER_IDS: readonly TtsProviderId[] = ALL_PROVIDERS.map((p) => p.id);

/** Look up a provider adapter by id (undefined for unknown ids). */
export function getTtsProvider(id: string | undefined): TtsProvider | undefined {
  return PROVIDERS_BY_ID.get(id ?? "");
}

/** Every provider adapter, in display order. */
export function allTtsProviders(): readonly TtsProvider[] {
  return ALL_PROVIDERS;
}
