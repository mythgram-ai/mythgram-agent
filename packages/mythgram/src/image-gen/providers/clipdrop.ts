import { ImageProviderBase, type ImageProviderRuntime } from "./base.js";
import { extensionForFormat, fallbackModels, formatFromContentType } from "./helpers.js";
import { IMAGE_GENERATION_TIMEOUT_MS } from "../client.js";
import type {
  ImageGenerateOptions,
  ImageListOptions,
  ImageModel,
  ImageRawResult,
} from "../types.js";

/** Default Clipdrop API base URL. */
export const CLIPDROP_IMAGE_BASE_URL = "https://clipdrop-api.co";

/**
 * Clipdrop text-to-image.
 *
 *   POST {base}/text-to-image/v1 — multipart/form-data (`prompt`), PNG bytes out
 *
 * Auth uses the `x-api-key` header. Output is always a 1024x1024 PNG, so the
 * aspect ratio is ignored. There is no model concept.
 *
 * Docs: https://clipdrop.co/apis/docs/text-to-image
 */
export class ClipdropImageProvider extends ImageProviderBase {
  constructor(runtime: Partial<ImageProviderRuntime> = {}) {
    super({
      kind: "clipdrop",
      name: "Clipdrop",
      baseUrl: CLIPDROP_IMAGE_BASE_URL,
      headers: {},
      manualModels: [],
      ...runtime,
    });
  }

  async listModels(_options: ImageListOptions): Promise<ImageModel[]> {
    return fallbackModels(this.runtime.manualModels);
  }

  async generate(options: ImageGenerateOptions): Promise<ImageRawResult> {
    if (!(options.apiKey ?? "").trim()) throw new Error("A Clipdrop API key is required.");
    const base = this.resolveBaseUrl(options.baseUrl);
    const form = new FormData();
    form.append("prompt", options.prompt.slice(0, 1000));

    const { bytes, contentType } = await this.fetchBinary(
      `${base}/text-to-image/v1`,
      {
        method: "POST",
        // Do NOT set Content-Type: fetch adds the multipart boundary automatically.
        headers: this.withRuntimeHeaders({ "x-api-key": options.apiKey.trim() }),
        body: form,
      },
      { timeoutMs: IMAGE_GENERATION_TIMEOUT_MS, signal: options.signal },
    );

    const format = extensionForFormat(formatFromContentType(contentType, "png"));
    return {
      bytes,
      contentType: "image/png",
      format: format === "jpg" ? "jpeg" : format,
      model: options.model || "clipdrop",
    };
  }
}
