import type { ImageFetch } from "./client.js";
import { CustomImageProvider } from "./providers/custom.js";
import { OpenRouterImageProvider, OPENROUTER_IMAGE_BASE_URL } from "./providers/openrouter.js";
import { MiniMaxImageProvider, MINIMAX_IMAGE_BASE_URL } from "./providers/minimax.js";
import { GeminiImageProvider, GEMINI_IMAGE_BASE_URL } from "./providers/gemini.js";
import { ClipdropImageProvider, CLIPDROP_IMAGE_BASE_URL } from "./providers/clipdrop.js";
import { PollinationsImageProvider, POLLINATIONS_IMAGE_BASE_URL } from "./providers/pollinations.js";
import { NvidiaImageProvider, NVIDIA_IMAGE_BASE_URL } from "./providers/nvidia.js";
import type { ImageHeader, ImageProviderConfig } from "./types.js";
import type { ImageProvider } from "./providers/base.js";

/** Collapse a stored header list into a request header record. */
function headersRecord(headers: ImageHeader[]): Record<string, string> {
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
export function buildImageProvider(
  config: ImageProviderConfig,
  options: { fetchFn?: ImageFetch } = {},
): ImageProvider {
  const base = (defaultBase: string): Partial<import("./providers/base.js").ImageProviderRuntime> => ({
    baseUrl: config.baseUrl || defaultBase,
    fetchFn: options.fetchFn,
  });
  const userHeaders = headersRecord(config.headers);

  switch (config.kind) {
    case "openrouter":
      return new OpenRouterImageProvider(base(OPENROUTER_IMAGE_BASE_URL));
    case "minimax":
      return new MiniMaxImageProvider(base(MINIMAX_IMAGE_BASE_URL));
    case "gemini":
      return new GeminiImageProvider(base(GEMINI_IMAGE_BASE_URL));
    case "clipdrop":
      return new ClipdropImageProvider(base(CLIPDROP_IMAGE_BASE_URL));
    case "pollinations":
      return new PollinationsImageProvider(base(POLLINATIONS_IMAGE_BASE_URL));
    case "nvidia":
      return new NvidiaImageProvider(base(NVIDIA_IMAGE_BASE_URL));
    case "custom":
      return new CustomImageProvider({
        id: config.id,
        name: config.name,
        baseUrl: config.baseUrl,
        headers: userHeaders,
        models: config.models,
        fetchFn: options.fetchFn,
      });
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Unsupported image provider kind: ${String(exhaustive)}`);
    }
  }
}
