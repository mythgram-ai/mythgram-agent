/**
 * Image generation engine — public surface.
 *
 * Consumers (the API router, the server entry, tests) import everything from here:
 *   `import { ImageManager } from "./image-gen/index.js"`
 */
export {
  ImageManager,
  type ImageManagerDeps,
  type ImageGenerateRequest,
  type ImageGenerationResult,
} from "./manager.js";
export { ImageStore, type ImageProviderPatch } from "./store.js";
export { buildImageProvider } from "./registry.js";
export { createImageRuntime } from "./runtime.js";
export {
  imageProviderDefinition,
  imageBuiltinDefinitions,
  IMAGE_PROVIDER_CATALOG,
  type ImageProviderDefinition,
} from "./configuration.js";
export {
  IMAGE_PROVIDER_KINDS,
  IMAGE_BUILTIN_KINDS,
  IMAGE_ASPECT_RATIOS,
  isImageProviderKind,
  isImageBuiltinKind,
  isImageAspectRatio,
  normalizeImageProvider,
  normalizeImageAgentConfig,
  toPublicImageProvider,
  type ImageProviderKind,
  type ImageBuiltinKind,
  type ImageAspectRatio,
  type ImageProviderConfig,
  type ImageProviderPublic,
  type ImageAgentConfig,
  type ImageHeader,
  type ImageModel,
  type ImageRawResult,
  type ImageGenerateOptions,
  type ImageListOptions,
} from "./types.js";
export { ImageGenError, type ImageFetch } from "./client.js";
export {
  OpenRouterImageProvider,
  MiniMaxImageProvider,
  GeminiImageProvider,
  ClipdropImageProvider,
  PollinationsImageProvider,
  NvidiaImageProvider,
  CustomImageProvider,
} from "./providers/index.js";
