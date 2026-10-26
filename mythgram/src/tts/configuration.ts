import {
  TTS_BUILTIN_KINDS,
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
 * hard-coded here (fallbacks are only used where a provider has no listing API).
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
  /** API base URL (no trailing slash). */
  defaultBaseUrl: string;
  /** Whether an API key must be present before listing/synthesizing. */
  requiresApiKey: boolean;
  /** Whether the provider exposes a model-listing endpoint. */
  supportsModelListing: boolean;
  /** Whether the provider exposes a voice-listing endpoint. */
  supportsVoiceListing: boolean;
  /** Suggested model when nothing is configured yet. */
  defaultModel: string;
  /** Suggested voice when nothing is configured yet. */
  defaultVoice: string;
  /** Suggested BCP-47 language / locale, when the provider needs one. */
  defaultLanguage: string;
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
    defaultLanguage: "",
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
    defaultLanguage: "",
    defaultFormat: "mp3",
    instructions: [
      "Create an API key with the tts:generate permission at platform.kittenml.com/developers/api-keys.",
      "Paste it below, then open “Models & voices”.",
      "Kitten TTS 2 (kitten-tts-2-latest) lists 170+ voices across 20 languages; the KittenTTS 0.8 models use a fixed set of 8 English voices.",
      "Pick a model + voice, type your text, and press Generate. Audio is returned as an MP3 you can play or download.",
    ],
  },
  sarvam: {
    kind: "sarvam",
    name: "Sarvam AI",
    description: "Bulbul Indic text-to-speech across 11 Indian languages.",
    docsUrl: "https://docs.sarvam.ai/api-reference/text-to-speech/convert",
    signupUrl: "https://dashboard.sarvam.ai",
    defaultBaseUrl: "https://api.sarvam.ai",
    requiresApiKey: true,
    supportsModelListing: false,
    supportsVoiceListing: false,
    defaultModel: "bulbul:v3",
    defaultVoice: "shubh",
    defaultLanguage: "hi-IN",
    defaultFormat: "wav",
    instructions: [
      "Create an API key in the Sarvam dashboard and paste it below (auth uses the api-subscription-key header).",
      "Pick a Bulbul model — v3 is the default, v2 is legacy, v4-flash has 200+ persona voices.",
      "Set the language (e.g. hi-IN, en-IN, ta-IN) and a speaker; Sarvam has no model/voice listing API, so the documented catalogs are offered.",
      "Audio is returned as WAV or MP3 depending on the chosen format. Text is capped at 2500 characters per request.",
    ],
  },
  azure: {
    kind: "azure",
    name: "Azure Speech",
    description: "Microsoft Azure Neural TTS with hundreds of locales and voices.",
    docsUrl: "https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech",
    signupUrl: "https://portal.azure.com",
    defaultBaseUrl: "https://eastus.tts.speech.microsoft.com",
    requiresApiKey: true,
    supportsModelListing: false,
    supportsVoiceListing: true,
    defaultModel: "Neural",
    defaultVoice: "en-US-JennyNeural",
    defaultLanguage: "",
    defaultFormat: "mp3",
    instructions: [
      "Create a Speech resource in the Azure portal and copy its key.",
      "Set the Base URL to your resource's region host, e.g. https://eastus.tts.speech.microsoft.com (the region is part of the host).",
      "Paste the subscription key below (auth uses the Ocp-Apim-Subscription-Key header).",
      "Open “Models & voices” to load the voice catalog, then pick a voice. Requests are sent as SSML; audio length is capped at 10 minutes.",
    ],
  },
  elevenlabs: {
    kind: "elevenlabs",
    name: "ElevenLabs",
    description: "High-quality expressive voices with a large model and voice catalog.",
    docsUrl: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
    signupUrl: "https://elevenlabs.io/app/settings/api-keys",
    defaultBaseUrl: "https://api.elevenlabs.io",
    requiresApiKey: true,
    supportsModelListing: true,
    supportsVoiceListing: true,
    defaultModel: "eleven_multilingual_v2",
    defaultVoice: "",
    defaultLanguage: "",
    defaultFormat: "mp3",
    instructions: [
      "Create an API key in the ElevenLabs dashboard and paste it below (auth uses the xi-api-key header).",
      "Open “Models & voices” to fetch your models and voices live.",
      "Pick a voice (required — it is part of the request URL), then a model such as eleven_multilingual_v2 or eleven_flash_v2_5.",
      "Output format is chosen from the format dropdown (e.g. MP3 44.1kHz).",
    ],
  },
  google: {
    kind: "google",
    name: "Google Cloud TTS",
    description: "Google Cloud Text-to-Speech with Standard, WaveNet, Neural2, Studio and Chirp3-HD voices.",
    docsUrl: "https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize",
    signupUrl: "https://console.cloud.google.com/apis/credentials",
    defaultBaseUrl: "https://texttospeech.googleapis.com",
    requiresApiKey: true,
    supportsModelListing: false,
    supportsVoiceListing: true,
    defaultModel: "Neural2",
    defaultVoice: "en-US-Neural2-C",
    defaultLanguage: "",
    defaultFormat: "mp3",
    instructions: [
      "Enable the Cloud Text-to-Speech API and create an OAuth access token with the cloud-platform scope.",
      "Paste the access token below (sent as Authorization: Bearer).",
      "Open “Models & voices” to list voices; the voice name encodes its model family (e.g. en-US-Neural2-C).",
      "Input is capped at 5000 bytes per request. Audio is returned base64-encoded by Google.",
    ],
  },
  gradium: {
    kind: "gradium",
    name: "Gradium",
    description: "Low-latency expressive TTS (en, fr, de, es, pt) with voice cloning.",
    docsUrl: "https://docs.gradium.ai/api-reference/endpoint/tts-post",
    signupUrl: "https://platform.gradium.ai",
    defaultBaseUrl: "https://api.gradium.ai/api",
    requiresApiKey: true,
    supportsModelListing: false,
    supportsVoiceListing: true,
    defaultModel: "default",
    defaultVoice: "YTpq7expH9539ERJ",
    defaultLanguage: "",
    defaultFormat: "wav",
    instructions: [
      "Create an API key (starts with gd_) and paste it below (auth uses the x-api-key header).",
      "Open “Models & voices” to load the voice catalog, or paste a voice uid.",
      "Choose an output format — WAV, PCM, Opus, ulaw/alaw are supported.",
      "Only 5 languages (en/fr/de/es/pt) are currently supported.",
    ],
  },
  inworld: {
    kind: "inworld",
    name: "Inworld TTS",
    description: "Inworld's low-latency TTS models with delivery controls and voice design.",
    docsUrl: "https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech",
    signupUrl: "https://platform.inworld.ai",
    defaultBaseUrl: "https://api.inworld.ai",
    requiresApiKey: true,
    supportsModelListing: false,
    supportsVoiceListing: true,
    defaultModel: "inworld-tts-2",
    defaultVoice: "Alex",
    defaultLanguage: "",
    defaultFormat: "mp3",
    instructions: [
      "In the Inworld portal, copy the Basic credential (the pre-encoded base64 key:secret) and paste it below.",
      "Auth uses Authorization: Basic <credential> — do not add a prefix, the value is used as-is.",
      "Open “Models & voices” to list voices, then choose a model: inworld-tts-2 or inworld-tts-2-flash.",
      "Text is capped at 2000 UTF-16 code units per request.",
    ],
  },
  minimax: {
    kind: "minimax",
    name: "MiniMax",
    description: "MiniMax Speech models (2.8/2.6/02) with expressive multilingual voices.",
    docsUrl: "https://platform.minimax.io/docs/api-reference/speech-t2a-http",
    signupUrl: "https://platform.minimax.io",
    defaultBaseUrl: "https://api.minimax.io",
    requiresApiKey: true,
    supportsModelListing: false,
    supportsVoiceListing: true,
    defaultModel: "speech-2.8-hd",
    defaultVoice: "English_expressive_narrator",
    defaultLanguage: "",
    defaultFormat: "mp3",
    instructions: [
      "Create an API key on the MiniMax platform and paste it below (auth uses Authorization: Bearer).",
      "Open “Models & voices” — MiniMax lists system, cloned and generated voices (a POST endpoint under the hood).",
      "Pick a speech model such as speech-2.8-hd or speech-2.8-turbo, then a voice.",
      "Audio is returned hex-encoded by MiniMax; text is capped at 10,000 characters.",
    ],
  },
  volcengine: {
    kind: "volcengine",
    name: "Volcengine",
    description: "ByteDance Doubao speech synthesis (large-model voices, Chinese + English).",
    docsUrl: "https://www.volcengine.com/docs/6561/1257584",
    signupUrl: "https://console.volcengine.com",
    defaultBaseUrl: "https://openspeech.bytedance.com",
    requiresApiKey: true,
    supportsModelListing: false,
    supportsVoiceListing: false,
    defaultModel: "volcano_tts",
    defaultVoice: "zh_female_vv_uranus_bigtts",
    defaultLanguage: "",
    defaultFormat: "mp3",
    instructions: [
      "In the Volcengine console, note your app id and access token.",
      "Paste the key below as appid:token (or just the token if your account does not use an app id).",
      "Auth uses Authorization: Bearer;<token>. The “model” dropdown selects the cluster (volcano_tts by default).",
      "Enter a voice_type from the documented catalog. Text is capped at 1024 UTF-8 bytes per request.",
    ],
  },
  xai: {
    kind: "xai",
    name: "xAI",
    description: "xAI (Grok) text-to-speech with built-in and custom voices.",
    docsUrl: "https://docs.x.ai/developers/rest-api-reference/inference/voice",
    signupUrl: "https://console.x.ai",
    defaultBaseUrl: "https://api.x.ai",
    requiresApiKey: true,
    supportsModelListing: true,
    supportsVoiceListing: true,
    defaultModel: "xai-tts",
    defaultVoice: "eve",
    defaultLanguage: "en",
    defaultFormat: "mp3",
    instructions: [
      "Create an API key at console.x.ai and paste it below (auth uses Authorization: Bearer).",
      "Open “Models & voices” to load the built-in voice catalog.",
      "Set the language (a BCP-47 code such as en, or auto) — it is required by the /v1/tts endpoint.",
      "Pick a voice (default eve) and optionally a speed between 0.7 and 1.5. Text is capped at 60,000 characters.",
    ],
  },
  mimo: {
    kind: "mimo",
    name: "Xiaomi MiMo",
    description: "Xiaomi MiMo-V2.5-TTS, served through an OpenAI-compatible Chat Completions API.",
    docsUrl: "https://mimo.mi.com/docs/api/audio/tts",
    signupUrl: "https://platform.xiaomimimo.com",
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    requiresApiKey: true,
    supportsModelListing: true,
    supportsVoiceListing: false,
    defaultModel: "mimo-v2.5-tts",
    defaultVoice: "mimo_default",
    defaultLanguage: "",
    defaultFormat: "wav",
    instructions: [
      "Create an API key on the Xiaomi MiMo platform and paste it below.",
      "MiMo uses the Chat Completions API: the text to speak is sent as the assistant message; the “Instructions” field becomes the style prompt.",
      "Pick a model (mimo-v2.5-tts) and a built-in voice (e.g. mimo_default, Mia, Chloe).",
      "Audio is returned base64-encoded; choose WAV, MP3 or PCM.",
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
    defaultLanguage: "",
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
  return TTS_BUILTIN_KINDS.map((kind) => TTS_PROVIDER_CATALOG[kind]);
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
    language: definition.defaultLanguage,
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
  return (TTS_BUILTIN_KINDS as readonly string[]).includes(id);
}
