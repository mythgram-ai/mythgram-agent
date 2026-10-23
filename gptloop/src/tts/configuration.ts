import {
  type TtsBuiltinKind,
  type TtsOutputFormat,
  type TtsProviderConfig,
  type TtsProviderKind,
} from "./types.js";

/**
 * Static catalog of the built-in TTS provider kinds.
 *
 * This is the single source of truth the panel renders: labels, links, whether
 * an API key is required, whether models/voices can be listed live, and the
 * step-by-step setup instructions shown to the user. Providers are otherwise
 * fully data-driven — models and voices are fetched from the provider, never
 * hard-coded here.
 */
export interface TtsProviderDefinition {
  kind: TtsProviderKind;
  /** Short human label. */
  name: string;
  /** One-line summary. */
  description: string;
  /** Documentation link (used by the panel "Docs" button). */
  docsUrl: string;
  /** Where the user creates an API key. */
  signupUrl: string;
  /** OpenAI-compatible API base URL (no trailing slash). */
  defaultBaseUrl: string;
  /** Whether an API key must be present before listing/synthesizing. */
  requiresApiKey: boolean;
  /** Whether the provider exposes a `/models` endpoint for listing. */
  supportsModelListing: boolean;
  /** Whether the provider exposes a voice listing endpoint. */
  supportsVoiceListing: boolean;
  /** Suggested model when nothing is configured yet. */
  defaultModel: string;
  /** Suggested voice when nothing is configured yet. */
  defaultVoice: string;
  /** Preferred output format. */
  defaultFormat: TtsOutputFormat;
  /** Ordered setup instructions shown in the panel. */
  instructions: string[];
}

/** The built-in provider catalog. Order here is the panel's render order. */
export const TTS_PROVIDER_CATALOG: Record<TtsProviderKind, TtsProviderDefinition> = {
  openrouter: {
    kind: "openrouter",
    name: "OpenRouter",
    description: "One API key for many text-to-speech models (OpenAI, Gemini, Mistral, Fish Audio, ...).",
    docsUrl: "https://openrouter.ai/docs/guides/overview/multimodal/tts",
    signupUrl: "https://openrouter.ai/keys",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requiresApiKey: true,
    supportsModelListing: true,
    supportsVoiceListing: true,
    defaultModel: "openai/gpt-4o-mini-tts",
    defaultVoice: "alloy",
    defaultFormat: "mp3",
    instructions: [
      "Create an API key at openrouter.ai/keys and paste it below.",
      "Open “Models & voices”, pick a text-to-speech model, then choose one of its supported voices.",
      "Type your text and press Generate. Audio is returned as an MP3 you can play or download.",
      "TTS models are billed per character — check a model's price on its OpenRouter page before long generations.",
    ],
  },
  kittenml: {
    kind: "kittenml",
    name: "KittenML",
    description: "Kitten TTS 2 and the KittenTTS 0.8 family — fast, low-cost voices with 20+ languages.",
    docsUrl: "https://docs.kittenml.com/tts/generate-speech",
    signupUrl: "https://platform.kittenml.com/developers/api-keys",
    defaultBaseUrl: "https://api.kittenml.com/v1",
    requiresApiKey: true,
    supportsModelListing: true,
    supportsVoiceListing: true,
    defaultModel: "kitten-tts-2-latest",
    defaultVoice: "eleanor_somber_female_32",
    defaultFormat: "mp3",
    instructions: [
      "Create an API key with the tts:generate permission at platform.kittenml.com/developers/api-keys.",
      "Paste it below, then open “Models & voices”.",
      "Kitten TTS 2 (kitten-tts-2-latest) lists 170+ voices across 20 languages; the KittenTTS 0.8 models use a fixed set of 8 English voices.",
      "Pick a model + voice, type your text, and press Generate. Audio is returned as an MP3 you can play or download.",
    ],
  },
  custom: {
    kind: "custom",
    name: "Custom provider",
    description: "Any OpenAI-compatible /audio/speech endpoint — a hosted service or a local server.",
    docsUrl: "https://platform.openai.com/docs/api-reference/audio/createSpeech",
    signupUrl: "",
    defaultBaseUrl: "",
    requiresApiKey: false,
    supportsModelListing: true,
    supportsVoiceListing: false,
    defaultModel: "",
    defaultVoice: "",
    defaultFormat: "mp3",
    instructions: [
      "Enter the provider's OpenAI-compatible base URL (it must expose /audio/speech), e.g. http://localhost:8880/v1.",
      "Add the API key if the server requires one — leave it blank for local servers that need no auth.",
      "Optionally add custom headers (for example an organization or version header).",
      "Declare the model and the voices this server accepts, then type the model/voice by hand and Generate.",
      "“Fetch models” tries GET /models; if the server does not implement it, list the models manually.",
    ],
  },
};

/** The built-in provider definitions, in panel render order. */
export function ttsBuiltinDefinitions(): TtsProviderDefinition[] {
  return [TTS_PROVIDER_CATALOG.openrouter, TTS_PROVIDER_CATALOG.kittenml];
}

export function ttsProviderDefinition(kind: TtsProviderKind): TtsProviderDefinition {
  return TTS_PROVIDER_CATALOG[kind];
}

/** A fresh, empty configuration for one provider kind. */
export function createDefaultTtsProvider(
  kind: TtsProviderKind,
  id: string,
  now: number,
): TtsProviderConfig {
  const definition = ttsProviderDefinition(kind);
  return {
    id,
    kind,
    name: definition.name,
    enabled: true,
    apiKey: "",
    baseUrl: definition.defaultBaseUrl,
    model: definition.defaultModel,
    voice: definition.defaultVoice,
    responseFormat: definition.defaultFormat,
    headers: [],
    models: [],
    voices: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** True when the given id names one of the built-in provider kinds. */
export function isBuiltinProviderId(id: string): id is TtsBuiltinKind {
  return id === "openrouter" || id === "kittenml";
}
