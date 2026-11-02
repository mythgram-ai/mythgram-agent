import { OpenAICompatibleImageProvider, type ImageProviderRuntime } from "./base.js";
import { fallbackModels } from "./helpers.js";
import type { ImageGenerateOptions, ImageListOptions, ImageModel, ImageRawResult } from "../types.js";

/** Default NVIDIA NIM API base URL. */
export const NVIDIA_IMAGE_BASE_URL = "https://ai.api.nvidia.com/v1/genai";

/** Documented NVIDIA NIM text-to-image model ids (no image model-list endpoint). */
const NVIDIA_IMAGE_MODELS = [
  "black-forest-labs/flux.1-dev",
  "black-forest-labs/flux.1-schnell",
  "black-forest-labs/flux_2-klein-4b",
  "stabilityai/stable-diffusion-3.5-large",
] as const;

/**
 * NVIDIA NIM image generation.
 *
 * NVIDIA exposes one NIM endpoint per model under `/v1/genai/{publisher}/{model}`.
 * The request/response shape matches the `/images/generations` convention this
 * base class already implements (`data[].b64_json`/`url`), so only the URL
 * differs. Auth uses `Authorization: Bearer nvapi-...`.
 *
 * Model discovery uses the NIM catalog (`GET {base}/../models`) when available and
 * falls back to the documented model list otherwise.
 *
 * Docs: https://build.nvidia.com/explore/visual-design
 */
export class NvidiaImageProvider extends OpenAICompatibleImageProvider {
  constructor(runtime: Partial<ImageProviderRuntime> = {}) {
    super({
      kind: "nvidia",
      name: "NVIDIA NIM",
      baseUrl: NVIDIA_IMAGE_BASE_URL,
      headers: {},
      manualModels: [],
      ...runtime,
    });
  }

  /**
   * NVIDIA's model id is the full `publisher/model` slug; the per-model endpoint
   * lives at `{base}/{model}`.
   *   base = https://ai.api.nvidia.com/v1/genai
   *   model = black-forest-labs/flux.1-dev
   *   url   = https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev
   */
  protected override imagesUrl(base: string): string {
    return base;
  }

  override async listModels(options: ImageListOptions): Promise<ImageModel[]> {
    // NVIDIA NIM has no single listing endpoint; manual models (when the user set
    // them) win, otherwise offer the documented catalog.
    if (this.runtime.manualModels.length > 0) return this.manualModels();
    void options;
    return fallbackModels(NVIDIA_IMAGE_MODELS);
  }

  /** Send the model in the URL path and keep the prompt/steps provider fields. */
  override async generate(options: ImageGenerateOptions): Promise<ImageRawResult> {
    const base = this.resolveBaseUrl(options.baseUrl).replace(/\/+$/, "");
    const model = (options.model || NVIDIA_IMAGE_MODELS[0]!).replace(/^\/+/, "");
    const { width, height } = this.sizeFor(options.aspectRatio);
    const body: Record<string, unknown> = {
      prompt: options.prompt,
      width,
      height,
      cfg_scale: 3.5,
      steps: 50,
      seed: 0,
      samples: 1,
    };
    const payload = await this.fetchJson<Record<string, unknown>>(
      `${base}/${model}`,
      {
        method: "POST",
        headers: this.requestHeaders(options.apiKey),
        body: JSON.stringify(body),
      },
      { timeoutMs: 240_000, signal: options.signal },
    );
    const image = await this.extractImage(payload, { ...options, model });
    return { ...image, model };
  }

  /** Dimensions for an aspect ratio on a 1024 bounding box. */
  private sizeFor(ratio: string | undefined): { width: number; height: number } {
    switch ((ratio ?? "1:1").trim()) {
      case "16:9":
        return { width: 1344, height: 768 };
      case "9:16":
        return { width: 768, height: 1344 };
      case "4:3":
        return { width: 1216, height: 832 };
      case "3:4":
        return { width: 832, height: 1216 };
      default:
        return { width: 1024, height: 1024 };
    }
  }
}
