import {
  IMAGE_BUILTIN_KINDS,
  type ImageAspectRatio,
  type ImageBuiltinKind,
  type ImageProviderConfig,
  type ImageProviderKind,
} from "./types.js";

/**
 * Static catalog of the built-in image provider kinds.
 *
 * This is the single source of truth the panel renders: labels, links, whether
 * an API key is required, whether models can be listed live, and the step-by-step
 * setup instructions shown to the user. Models are otherwise fully data-driven —
 * fetched from the provider where an endpoint exists, with a documented fallback
 * list where it does not.
 */
export interface ImageProviderDefinition {
  kind: ImageProviderKind;
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
  /** Whether an API key must be present before listing/generating. */
  requiresApiKey: boolean;
  /** Whether the provider exposes a model-listing endpoint. */
  supportsModelListing: boolean;
  /** Suggested model when nothing is configured yet. */
  defaultModel: string;
  /** Suggested aspect ratio when nothing is configured yet. */
  defaultAspectRatio: ImageAspectRatio;
  /** Ordered setup instructions shown in the panel. */
  instructions: string[];
}

/** The built-in provider catalog. Order here is the panel's render order. */
export const IMAGE_PROVIDER_CATALOG: Record<ImageProviderKind, ImageProviderDefinition> = {
  openrouter: {
    kind: "openrouter",
    name: "OpenRouter",
    description: "One API key for many image models (GPT-Image, Gemini, FLUX, Seedream, ...).",
    docsUrl: "https://openrouter.ai/docs/features/multimodal/image-generation",
    signupUrl: "https://openrouter.ai/keys",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requiresApiKey: true,
    supportsModelListing: true,
    defaultModel: "google/gemini-2.5-flash-image",
    defaultAspectRatio: "1:1",
    instructions: [
      "Create an API key at openrouter.ai/keys and paste it below.",
      "Open “Models”, pick an image model (filtered to image-output models on OpenRouter), then choose an aspect ratio.",
      "Type a prompt and press Generate. Requests are billed per generated image.",
      "Models that return non-PNG output (JPEG, WebP, SVG) are saved with the correct extension.",
    ],
  },
  minimax: {
    kind: "minimax",
    name: "MiniMax",
    description: "MiniMax image-01 text-to-image with multiple aspect ratios.",
    docsUrl: "https://platform.minimax.io/docs/api-reference/image-generation-t2i",
    signupUrl: "https://platform.minimax.io",
    defaultBaseUrl: "https://api.minimax.io",
    requiresApiKey: true,
    supportsModelListing: false,
    defaultModel: "image-01",
    defaultAspectRatio: "1:1",
    instructions: [
      "Create an API key on the MiniMax platform and paste it below (auth uses Authorization: Bearer).",
      "Choose a model (image-01) and an aspect ratio.",
      "Prompts are capped at 1500 characters per request.",
      "Images are returned base64-encoded and saved as PNG/JPEG in the workspace.",
    ],
  },
  gemini: {
    kind: "gemini",
    name: "Google Gemini",
    description: "Google Gemini (Nano Banana) and Imagen image generation.",
    docsUrl: "https://ai.google.dev/gemini-api/docs/image-generation",
    signupUrl: "https://aistudio.google.com/app/apikey",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    requiresApiKey: true,
    supportsModelListing: true,
    defaultModel: "gemini-2.5-flash-image",
    defaultAspectRatio: "1:1",
    instructions: [
      "Create an API key in Google AI Studio and paste it below (sent as the x-goog-api-key header).",
      "Open “Models” to list image-capable models (Gemini image and Imagen families).",
      "Gemini models use generateContent; Imagen models (imagen-*) use predict — both are supported.",
      "Choose an aspect ratio and press Generate.",
    ],
  },
  clipdrop: {
    kind: "clipdrop",
    name: "Clipdrop",
    description: "Clipdrop text-to-image (Jasper.ai) — 1024x1024 PNG output.",
    docsUrl: "https://clipdrop.co/apis/docs/text-to-image",
    signupUrl: "https://clipdrop.co/apis/account",
    defaultBaseUrl: "https://clipdrop-api.co",
    requiresApiKey: true,
    supportsModelListing: false,
    defaultModel: "",
    defaultAspectRatio: "1:1",
    instructions: [
      "Create an API key in your Clipdrop account page and paste it below (auth uses the x-api-key header).",
      "Clipdrop always returns a 1024x1024 PNG, so the aspect ratio and model are ignored.",
      "Prompts are capped at 1000 characters. Each successful call consumes one credit.",
      "By default a key allows 60 requests per minute.",
    ],
  },
  pollinations: {
    kind: "pollinations",
    name: "Pollinations",
    description: "Free, keyless image generation (FLUX) — no signup required.",
    docsUrl: "https://github.com/pollinations/pollinations/blob/master/APIDOCS.md",
    signupUrl: "https://enter.pollinations.ai",
    defaultBaseUrl: "https://image.pollinations.ai",
    requiresApiKey: false,
    supportsModelListing: false,
    defaultModel: "flux",
    defaultAspectRatio: "1:1",
    instructions: [
      "No API key is required — Pollinations is free and anonymous.",
      "Images are fetched from a GET URL built from your prompt; the default model is flux.",
      "Free requests are rate-limited per IP (roughly one image every 45 seconds).",
      "For higher limits and no logo, add an optional token from enter.pollinations.ai.",
    ],
  },
  nvidia: {
    kind: "nvidia",
    name: "NVIDIA NIM",
    description: "NVIDIA NIM visual-design models (FLUX, Stable Diffusion 3.5, ...).",
    docsUrl: "https://build.nvidia.com/explore/visual-design",
    signupUrl: "https://build.nvidia.com",
    defaultBaseUrl: "https://ai.api.nvidia.com/v1/genai",
    requiresApiKey: true,
    supportsModelListing: false,
    defaultModel: "black-forest-labs/flux.1-dev",
    defaultAspectRatio: "1:1",
    instructions: [
      "Create an API key at build.nvidia.com and paste it below (auth uses Authorization: Bearer nvapi-...).",
      "Pick a model from the documented catalog; each model is a NIM endpoint under /v1/genai/{publisher}/{model}.",
      "Choose an aspect ratio and press Generate.",
      "FLUX.1-dev is non-commercial; check each model's license on its build.nvidia.com page.",
    ],
  },
  custom: {
    kind: "custom",
    name: "Custom provider",
    description: "Any OpenAI-compatible /images/generations endpoint — a hosted service or a local server.",
    docsUrl: "https://platform.openai.com/docs/api-reference/images",
    signupUrl: "",
    defaultBaseUrl: "",
    requiresApiKey: false,
    supportsModelListing: true,
    defaultModel: "",
    defaultAspectRatio: "1:1",
    instructions: [
      "Enter the provider's OpenAI-compatible base URL (it must expose /images/generations), e.g. http://localhost:8880/v1.",
      "Add the API key if the server requires one — leave it blank for local servers that need no auth.",
      "Optionally add custom headers (for example an organization or version header).",
      "Declare the models this server accepts, then select a model and press Generate.",
      "“Fetch models” tries GET /models; if the server does not implement it, list the models manually.",
    ],
  },
};

/** The built-in provider definitions, in panel render order. */
export function imageBuiltinDefinitions(): ImageProviderDefinition[] {
  return IMAGE_BUILTIN_KINDS.map((kind) => IMAGE_PROVIDER_CATALOG[kind]);
}

export function imageProviderDefinition(kind: ImageProviderKind): ImageProviderDefinition {
  return IMAGE_PROVIDER_CATALOG[kind];
}

/** A fresh, empty configuration for one provider kind. */
export function createDefaultImageProvider(
  kind: ImageProviderKind,
  id: string,
  now: number,
): ImageProviderConfig {
  const definition = imageProviderDefinition(kind);
  return {
    id,
    kind,
    name: definition.name,
    enabled: true,
    apiKey: "",
    baseUrl: definition.defaultBaseUrl,
    model: definition.defaultModel,
    aspectRatio: definition.defaultAspectRatio,
    headers: [],
    models: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** True when the given id names one of the built-in provider kinds. */
export function isBuiltinImageProviderId(id: string): id is ImageBuiltinKind {
  return (IMAGE_BUILTIN_KINDS as readonly string[]).includes(id);
}
