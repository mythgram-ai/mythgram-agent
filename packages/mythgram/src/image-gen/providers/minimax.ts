import { ImageProviderBase, type ImageProviderRuntime } from "./base.js";
import {
  asRecord,
  clampAspectRatio,
  decodeBase64,
  detectImageFormat,
  fallbackModels,
  mimeForFormat,
  pickArray,
} from "./helpers.js";
import { IMAGE_GENERATION_TIMEOUT_MS } from "../client.js";
import type {
  ImageGenerateOptions,
  ImageListOptions,
  ImageModel,
  ImageRawResult,
} from "../types.js";

/** Default MiniMax API base URL (international). */
export const MINIMAX_IMAGE_BASE_URL = "https://api.minimax.io";

/** Documented MiniMax image model ids (no image model-list endpoint is documented). */
const MINIMAX_IMAGE_MODELS = ["image-01"] as const;

/** Aspect ratios MiniMax accepts (a subset of its documented set). */
const MINIMAX_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

/**
 * MiniMax text-to-image.
 *
 *   POST {base}/v1/image_generation — JSON in, base64 (or URL) images out
 *
 * Auth uses `Authorization: Bearer`. Text is capped at 1500 characters.
 *
 * Docs: https://platform.minimax.io/docs/api-reference/image-generation-t2i
 */
export class MiniMaxImageProvider extends ImageProviderBase {
  constructor(runtime: Partial<ImageProviderRuntime> = {}) {
    super({
      kind: "minimax",
      name: "MiniMax",
      baseUrl: MINIMAX_IMAGE_BASE_URL,
      headers: {},
      manualModels: [],
      ...runtime,
    });
  }

  private headers(apiKey: string): Record<string, string> {
    return this.withRuntimeHeaders({
      Authorization: `Bearer ${(apiKey ?? "").trim()}`,
      "Content-Type": "application/json",
    });
  }

  async listModels(_options: ImageListOptions): Promise<ImageModel[]> {
    if (this.runtime.manualModels.length > 0) return this.manualModels();
    return fallbackModels(MINIMAX_IMAGE_MODELS);
  }

  async generate(options: ImageGenerateOptions): Promise<ImageRawResult> {
    if (!(options.apiKey ?? "").trim()) throw new Error("A MiniMax API key is required.");
    const base = this.resolveBaseUrl(options.baseUrl);
    const model = options.model || "image-01";
    const body = {
      model,
      prompt: options.prompt.slice(0, 1500),
      aspect_ratio: clampAspectRatio(options.aspectRatio, MINIMAX_ASPECT_RATIOS),
      response_format: "base64",
      n: 1,
    };

    const payload = await this.fetchJson<{
      data?: { image_base64?: unknown; image_urls?: unknown } | null;
      base_resp?: { status_code?: number; status_msg?: string };
    }>(
      `${base}/v1/image_generation`,
      { method: "POST", headers: this.headers(options.apiKey), body: JSON.stringify(body) },
      { timeoutMs: IMAGE_GENERATION_TIMEOUT_MS, signal: options.signal },
    );

    const status = payload.base_resp?.status_code;
    if (typeof status === "number" && status !== 0) {
      throw new Error(payload.base_resp?.status_msg || `MiniMax error ${status}`);
    }

    const data = asRecord(payload.data);
    const base64 = data ? pickArray(data, "image_base64")[0] : undefined;
    if (typeof base64 === "string" && base64) {
      const bytes = decodeBase64(base64);
      const format = detectImageFormat(bytes, "jpeg");
      return { bytes, contentType: mimeForFormat(format), format, model };
    }

    const url = data ? pickArray(data, "image_urls")[0] : undefined;
    if (typeof url === "string" && url) {
      const { bytes } = await this.fetchBinary(
        url,
        { method: "GET", headers: this.withRuntimeHeaders({}) },
        { timeoutMs: IMAGE_GENERATION_TIMEOUT_MS, signal: options.signal },
      );
      const format = detectImageFormat(bytes, "jpeg");
      return { bytes, contentType: mimeForFormat(format), format, model };
    }

    throw new Error("MiniMax returned no image data.");
  }
}
