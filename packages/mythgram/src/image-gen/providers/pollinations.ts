import { OpenAICompatibleImageProvider, type ImageProviderRuntime } from "./base.js";
import { detectImageFormat, fallbackModels } from "./helpers.js";
import { IMAGE_GENERATION_TIMEOUT_MS } from "../client.js";
import type {
  ImageGenerateOptions,
  ImageListOptions,
  ImageModel,
  ImageRawResult,
} from "../types.js";

/** Default Pollinations image API base URL. */
export const POLLINATIONS_IMAGE_BASE_URL = "https://image.pollinations.ai";

/**
 * Pollinations AI image generation — free and keyless.
 *
 *   GET {base}/prompt/{urlEncodedPrompt}?width=&height=&seed=&model=&nologo=
 *
 * The response body is the image itself (PNG). An optional token can be passed
 * as an `Authorization: Bearer` header, but none is required.
 *
 * Docs: https://github.com/pollinations/pollinations/blob/master/APIDOCS.md
 */
export class PollinationsImageProvider extends OpenAICompatibleImageProvider {
  constructor(runtime: Partial<ImageProviderRuntime> = {}) {
    super({
      kind: "pollinations",
      name: "Pollinations",
      baseUrl: POLLINATIONS_IMAGE_BASE_URL,
      headers: {},
      manualModels: [],
      ...runtime,
    });
  }

  override async listModels(_options: ImageListOptions): Promise<ImageModel[]> {
    if (this.runtime.manualModels.length > 0) return this.manualModels();
    // Pollinations has no public image model-list endpoint; expose the documented default.
    return fallbackModels(["flux"]);
  }

  override async generate(options: ImageGenerateOptions): Promise<ImageRawResult> {
    const base = this.resolveBaseUrl(options.baseUrl);
    const { width, height } = this.sizeFor(options.aspectRatio);
    const query = new URLSearchParams({
      width: String(width),
      height: String(height),
      seed: String(Math.floor(Math.random() * 1_000_000)),
      nologo: "true",
    });
    if (options.model) query.set("model", options.model);
    const url = `${base}/prompt/${encodeURIComponent(options.prompt)}?${query.toString()}`;

    const headers = this.withRuntimeHeaders({ Accept: "image/*" });
    const key = (options.apiKey ?? "").trim();
    if (key) headers.Authorization = `Bearer ${key}`;

    const { bytes } = await this.fetchBinary(
      url,
      { method: "GET", headers },
      { timeoutMs: IMAGE_GENERATION_TIMEOUT_MS, signal: options.signal },
    );
    const format = detectImageFormat(bytes, "png");
    return {
      bytes,
      contentType: format === "jpeg" ? "image/jpeg" : `image/${format}`,
      format,
      model: options.model || "flux",
    };
  }

  /** Dimensions for an aspect ratio, capped to Pollinations' 768 bounding box. */
  private sizeFor(ratio: string | undefined): { width: number; height: number } {
    switch ((ratio ?? "1:1").trim()) {
      case "16:9":
        return { width: 768, height: 432 };
      case "9:16":
        return { width: 432, height: 768 };
      case "4:3":
        return { width: 768, height: 576 };
      case "3:4":
        return { width: 576, height: 768 };
      default:
        return { width: 768, height: 768 };
    }
  }
}
