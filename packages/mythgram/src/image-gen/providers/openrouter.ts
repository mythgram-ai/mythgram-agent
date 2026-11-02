import {
  IMAGE_GENERATION_TIMEOUT_MS,
} from "../client.js";
import { OpenAICompatibleImageProvider, type ImageProviderRuntime } from "./base.js";
import { asRecord, decodeBase64, formatFromContentType, mimeForFormat, pickArray, pickString } from "./helpers.js";
import type {
  ImageGenerateOptions,
  ImageListOptions,
  ImageModel,
  ImageRawResult,
} from "../types.js";

/** Default OpenRouter API base URL. */
export const OPENROUTER_IMAGE_BASE_URL = "https://openrouter.ai/api/v1";

/** Aspect ratios OpenRouter normalizes to across providers. */
const OPENROUTER_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

function normalizeAspectRatio(ratio: string | undefined): string {
  const value = (ratio ?? "").trim();
  return (OPENROUTER_ASPECT_RATIOS as readonly string[]).includes(value) ? value : "1:1";
}

/**
 * OpenRouter image generation.
 *
 * OpenRouter exposes a dedicated Image API (`POST /images`) and an image-models
 * listing (`GET /images/models`). Images are returned base64-encoded with a
 * `media_type` field. Aspect ratios are normalized across providers.
 *
 * Docs: https://openrouter.ai/docs/features/multimodal/image-generation
 */
export class OpenRouterImageProvider extends OpenAICompatibleImageProvider {
  constructor(runtime: Partial<ImageProviderRuntime> = {}) {
    super({
      kind: "openrouter",
      name: "OpenRouter",
      baseUrl: OPENROUTER_IMAGE_BASE_URL,
      headers: {},
      manualModels: [],
      ...runtime,
    });
  }

  /** Attribute requests to the app (optional on OpenRouter but recommended). */
  protected override requestHeaders(apiKey: string): Record<string, string> {
    const headers = super.requestHeaders(apiKey);
    headers["HTTP-Referer"] ??= "https://github.com/mythgram";
    headers["X-Title"] ??= "Mythgram";
    return headers;
  }

  /** The dedicated image-models listing. */
  protected override modelsUrl(base: string): string {
    return `${base}/images/models`;
  }

  /** Parse the `{ data: [{ id, name }] }` envelope. */
  override async listModels(options: ImageListOptions): Promise<ImageModel[]> {
    const base = this.resolveBaseUrl(options.baseUrl);
    try {
      const payload = await this.fetchJson<unknown>(
        this.modelsUrl(base),
        { method: "GET", headers: this.requestHeaders(options.apiKey) },
        { signal: options.signal },
      );
      const items = pickArray(payload as Record<string, unknown>, "data");
      const models: ImageModel[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const record = asRecord(item);
        if (!record) continue;
        const id = pickString(record, "id", "name");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        models.push({ id, name: pickString(record, "name") || id });
      }
      if (models.length > 0) return models;
    } catch (error) {
      if (this.runtime.manualModels.length === 0) throw error;
    }
    return this.manualModels();
  }

  override async generate(options: ImageGenerateOptions): Promise<ImageRawResult> {
    const base = this.resolveBaseUrl(options.baseUrl);
    const payload = await this.fetchJson<Record<string, unknown>>(
      `${base}/images`,
      {
        method: "POST",
        headers: this.requestHeaders(options.apiKey),
        body: JSON.stringify({
          model: options.model,
          prompt: options.prompt,
          aspect_ratio: normalizeAspectRatio(options.aspectRatio),
          n: 1,
        }),
      },
      { timeoutMs: IMAGE_GENERATION_TIMEOUT_MS, signal: options.signal },
    );

    const data = pickArray(payload, "data");
    const first = asRecord(data[0]);
    const base64 = first ? pickString(first, "b64_json", "b64", "base64") : "";
    if (!base64) throw new Error("OpenRouter returned no image data.");
    const mediaType = first ? pickString(first, "media_type") : "";
    const format = mediaType ? formatFromContentType(mediaType, "png") : "png";
    return {
      bytes: decodeBase64(base64),
      contentType: mediaType || mimeForFormat(format),
      format,
      model: options.model,
    };
  }
}
