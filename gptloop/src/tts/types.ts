/**
 * TTS (text-to-speech) engine types.
 *
 * The engine does NOT ship any speech model — it renders speech through
 * pre-created services: a locally-run TTS Studio instance (open-source models
 * behind an OpenAI-compatible speech API) or one of the supported cloud TTS
 * providers. Every provider adapts its own HTTP API to one small interface
 * (see `TtsProvider`), so the generate_speech tool and the /api/tts endpoints
 * stay provider-agnostic.
 */

/** Every TTS provider the engine can drive. */
export type TtsProviderId =
  /** Local TTS Studio (open-source models, OpenAI-compatible /v1 speech API). */
  | "local"
  /** OpenRouter — OpenAI-compatible /api/v1/audio/speech routed to TTS models. */
  | "openrouter"
  /** Microsoft Azure Speech (cognitiveservices/v1). */
  | "azure_speech"
  /** ElevenLabs text-to-speech. */
  | "elevenlabs"
  /** Google Cloud Text-to-Speech. */
  | "google"
  /** Gradium low-latency TTS. */
  | "gradium"
  /** Inworld TTS. */
  | "inworld"
  /** MiniMax T2A v2. */
  | "minimax"
  /** Volcengine (ByteDance) TTS. */
  | "volcengine"
  /** xAI Grok TTS. */
  | "xai"
  /** Xiaomi MiMo TTS. */
  | "xiaomi_mimo"
  /** KittenML KittenTTS. */
  | "kittenml"
  /** Any extra OpenAI-compatible speech endpoint (localhost allowed). */
  | "custom";

/**
 * The TTS configuration the user chose in the frontend TTS panel, carried with
 * every turn (mirroring the WebToolsConfig pattern) and injected into the
 * ToolContext. Voice/model/credential selection is entirely user-owned — the
 * generate_speech tool never invents any of it.
 */
export interface TtsToolsConfig {
  /** Active provider. Absent/unknown = no TTS connected. */
  provider?: TtsProviderId;
  /** Cloud API key (or TTS Studio / custom endpoint key — optional there). */
  apiKey?: string;
  /**
   * Base URL for the local (TTS Studio) and custom OpenAI-compatible providers,
   * e.g. "http://127.0.0.1:8000/v1". May point at localhost.
   */
  baseUrl?: string;
  /** Selected TTS model id (provider-specific; ignored by providers without models). */
  model?: string;
  /** Selected voice id/name (provider-specific). */
  voice?: string;
  /** BCP-47 language hint (xAI `language`, Google `languageCode`). */
  language?: string;
  /** Speech speed multiplier where the provider supports one (e.g. 0.7–1.5). */
  speed?: number;
  /** Output audio format where the provider supports one (e.g. "mp3", "wav"). */
  outputFormat?: string;
  /** OpenAI-style delivery instructions (OpenRouter passthrough). */
  instructions?: string;
  /** Azure Speech service region (e.g. "eastus"). */
  azureRegion?: string;
  /** Volcengine App ID (required by the Volcengine TTS API). */
  volcengineAppId?: string;
  /** Volcengine cluster (defaults to "volcano_tts"). */
  volcengineCluster?: string;
  /** MiniMax GroupId (required by some MiniMax accounts). */
  minimaxGroupId?: string;
}

/** One TTS model offered by a provider (live-fetched where the API exposes it). */
export interface TtsModelInfo {
  /** Model id exactly as the provider API expects it. */
  id: string;
  /** Human-readable label for the picker. */
  label?: string;
}

/** One voice offered by a provider/model (live-fetched — never hard-coded). */
export interface TtsVoiceInfo {
  /** Voice id exactly as the provider API expects it. */
  id: string;
  /** Human-readable label for the picker. */
  label?: string;
  /** Language/locale tag when the provider reports one. */
  language?: string;
  /** Gender when the provider reports one. */
  gender?: string;
  /** Sample audio URL when the provider reports one. */
  previewUrl?: string;
}

/** Audio bytes a provider produced, before the engine writes the file. */
export interface TtsSynthesisResult {
  /** Raw audio bytes. */
  audio: Buffer;
  /** File extension WITHOUT the leading dot (e.g. "mp3"). */
  extension: string;
  /** MIME type of the audio (e.g. "audio/mpeg"). */
  contentType: string;
  /** Provider that rendered the audio. */
  provider: TtsProviderId;
  /** Model used (when the provider supports one). */
  model?: string;
  /** Voice used (when the provider supports one). */
  voice?: string;
}

/** Abort/timeout plumbing handed to provider calls. */
export interface TtsRequestContext {
  /** Abort signal so long-running synthesis stops when the turn is cancelled. */
  signal?: AbortSignal;
}

/** What every TTS provider adapter implements. */
export interface TtsProvider {
  id: TtsProviderId;
  /** Human-readable provider name for the UI. */
  label: string;
  /** True when an API key is mandatory for synthesis. */
  requiresApiKey: boolean;
  /** True when a base URL is mandatory (local / custom OpenAI-compatible). */
  requiresBaseUrl: boolean;
  /** True when a voice must be selected for synthesis to work. */
  requiresVoice: boolean;
  /**
   * Provider-specific required config fields beyond apiKey/baseUrl (e.g. the Azure
   * region). Returns human-readable names of everything that is missing.
   */
  missingRequirements?(config: TtsToolsConfig): string[];
  /** Short setup instructions shown in the TTS panel. */
  instructions: string;
  /** Live model list when the provider exposes one; otherwise undefined. */
  fetchModels?(config: TtsToolsConfig, ctx: TtsRequestContext): Promise<TtsModelInfo[]>;
  /** Live voice list when the provider exposes one; otherwise undefined. */
  fetchVoices?(config: TtsToolsConfig, ctx: TtsRequestContext): Promise<TtsVoiceInfo[]>;
  /** Render `text` to audio bytes. Throws a descriptive Error on any failure. */
  synthesize(text: string, config: TtsToolsConfig, ctx: TtsRequestContext): Promise<TtsSynthesisResult>;
}
