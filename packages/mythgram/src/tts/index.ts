/**
 * Text-to-speech engine — public surface.
 *
 * Consumers (the API router, tests) import everything from here:
 *   `import { TtsManager } from "./tts/index.js"`
 */
export { TtsManager, type TtsManagerDeps, type TtsSynthesizeRequest, type TtsSynthesisResult } from "./manager.js";
export {
  LocalTtsInstaller,
  LocalTtsInstallError,
  LOCAL_TTS_INSTALL_METHODS,
  isLocalTtsInstallMethod,
  type LocalTtsInstallMethod,
  type LocalTtsInstallState,
  type LocalTtsInstallStatus,
  type LocalTtsInstallerDeps,
} from "./installer.js";
export { TtsStore, type TtsProviderPatch } from "./store.js";
export { buildTtsProvider } from "./registry.js";
export { createSpeechRuntime } from "./runtime.js";
export { ttsProviderDefinition, ttsBuiltinDefinitions, TTS_PROVIDER_CATALOG, type TtsProviderDefinition } from "./configuration.js";
export {
  TTS_PROVIDER_KINDS,
  TTS_BUILTIN_KINDS,
  TTS_OUTPUT_FORMATS,
  isTtsProviderKind,
  isTtsBuiltinKind,
  isTtsOutputFormat,
  normalizeTtsProvider,
  normalizeTtsAgentConfig,
  toPublicTtsProvider,
  type TtsProviderKind,
  type TtsBuiltinKind,
  type TtsProviderConfig,
  type TtsProviderPublic,
  type TtsAgentConfig,
  type TtsHeader,
  type TtsVoice,
  type TtsModel,
  type TtsAudioResult,
  type TtsSynthesizeOptions,
  type TtsListOptions,
} from "./types.js";
export { TtsError, type TtsFetch } from "./client.js";
export {
  OpenRouterTtsProvider,
  KittenMlTtsProvider,
  CustomTtsProvider,
  SarvamTtsProvider,
  AzureTtsProvider,
  ElevenLabsTtsProvider,
  GoogleTtsProvider,
  GradiumTtsProvider,
  InworldTtsProvider,
  MiniMaxTtsProvider,
  VolcengineTtsProvider,
  XaiTtsProvider,
  MimoTtsProvider,
  LocalTtsProvider,
} from "./providers/index.js";
