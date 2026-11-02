import { ImageProviderBase, type ImageProviderRuntime } from "./base.js";
import {
  asRecord,
  clampAspectRatio,
  decodeBase64,
  formatFromContentType,
  mimeForFormat,
  pickArray,
  pickString,
} from "./helpers.js";
import { IMAGE_GENERATION_TIMEOUT_MS } from "../client.js";
import type {
  ImageGenerateOptions,
  ImageListOptions,
  ImageModel,
  ImageRawResult,
} from "../types.js";

/** Default Google Generative Language API base URL. */
export const GEMINI_IMAGE_BASE_URL = "https://generativelanguage.googleapis.com";

/** Aspect ratios accepted by the Imagen `predict` endpoint. */
const GEMINI_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

/** True when the model id targets the Imagen `predict` endpoint rather than `generateContent`. */
function isImagen(model: string): boolean {
  return /imagen/i.test(model);
}

/** The short model id from a `models/...` resource name. */
function shortName(resource: string): string {
  return (resource ?? "").replace(/^models\//, "").trim();
}

/**
 * Google Gemini / Imagen image generation.
 *
 * Two wire protocols are covered:
 *   - Imagen models (`imagen-*`): POST {base}/v1beta/models/{model}:predict
 *   - Gemini image models:        POST {base}/v1beta/models/{model}:generateContent
 *
 * The API key is sent as the `x-goog-api-key` header. Model discovery uses
 * GET {base}/v1beta/models and keeps image-capable models.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/image-generation
 */
export class GeminiImageProvider extends ImageProviderBase {
  constructor(runtime: Partial<ImageProviderRuntime> = {}) {
    super({
      kind: "gemini",
      name: "Google Gemini",
      baseUrl: GEMINI_IMAGE_BASE_URL,
      headers: {},
      manualModels: [],
      ...runtime,
    });
  }

  private headers(apiKey: string): Record<string, string> {
    const key = (apiKey ?? "").trim();
    if (!key) throw new Error("A Google Gemini API key is required.");
    return this.withRuntimeHeaders({ "x-goog-api-key": key, "Content-Type": "application/json" });
  }

  async listModels(options: ImageListOptions): Promise<ImageModel[]> {
    const base = this.resolveBaseUrl(options.baseUrl);
    try {
      const payload = await this.fetchJson<{ models?: unknown[] }>(
        `${base}/v1beta/models`,
        { method: "GET", headers: this.headers(options.apiKey) },
        { signal: options.signal },
      );
      const models: ImageModel[] = [];
      const seen = new Set<string>();
      for (const item of pickArray(payload as Record<string, unknown>, "models")) {
        const record = asRecord(item);
        if (!record) continue;
        const id = shortName(pickString(record, "name"));
        if (!id || seen.has(id)) continue;
        const displayName = pickString(record, "displayName") || id;
        const haystack = `${id} ${displayName}`.toLowerCase();
        // Keep image-capable models only; the catalog stays focused on generation.
        if (!haystack.includes("image") && !haystack.includes("imagen")) continue;
        seen.add(id);
        models.push({ id, name: displayName });
      }
      if (models.length > 0) return models;
    } catch (error) {
      if (this.runtime.manualModels.length === 0) throw error;
    }
    return this.manualModels();
  }

  async generate(options: ImageGenerateOptions): Promise<ImageRawResult> {
    const base = this.resolveBaseUrl(options.baseUrl);
    const model = options.model || "gemini-2.5-flash-image";
    const headers = this.headers(options.apiKey);
    return isImagen(model)
      ? this.generateImagen(base, model, options, headers)
      : this.generateContent(base, model, options, headers);
  }

  /** Imagen: `:predict` returns `predictions[0].bytesBase64Encoded`. */
  private async generateImagen(
    base: string,
    model: string,
    options: ImageGenerateOptions,
    headers: Record<string, string>,
  ): Promise<ImageRawResult> {
    const payload = await this.fetchJson<{ predictions?: unknown[] }>(
      `${base}/v1beta/models/${encodeURIComponent(model)}:predict`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          instances: [{ prompt: options.prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: clampAspectRatio(options.aspectRatio, GEMINI_ASPECT_RATIOS),
          },
        }),
      },
      { timeoutMs: IMAGE_GENERATION_TIMEOUT_MS, signal: options.signal },
    );
    const first = asRecord(pickArray(payload, "predictions")[0]);
    const base64 = first ? pickString(first, "bytesBase64Encoded", "bytes_base64_encoded") : "";
    if (!base64) throw new Error("Gemini returned no image data.");
    const mime = first ? pickString(first, "mimeType", "mime_type") : "";
    const format = mime ? formatFromContentType(mime, "png") : "png";
    return { bytes: decodeBase64(base64), contentType: mime || mimeForFormat(format), format, model };
  }

  /** Gemini image models: `:generateContent` returns inlineData parts. */
  private async generateContent(
    base: string,
    model: string,
    options: ImageGenerateOptions,
    headers: Record<string, string>,
  ): Promise<ImageRawResult> {
    const payload = await this.fetchJson<Record<string, unknown>>(
      `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          contents: [{ parts: [{ text: options.prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      },
      { timeoutMs: IMAGE_GENERATION_TIMEOUT_MS, signal: options.signal },
    );

    const candidate = asRecord(pickArray(payload, "candidates")[0]);
    const content = candidate ? asRecord(candidate.content) : null;
    const parts = content ? pickArray(content, "parts") : [];
    for (const part of parts) {
      const record = asRecord(part);
      if (!record) continue;
      const inline = asRecord(record.inlineData ?? record.inline_data);
      if (!inline) continue;
      const base64 = pickString(inline, "data");
      if (!base64) continue;
      const mime = pickString(inline, "mimeType", "mime_type");
      const format = mime ? formatFromContentType(mime, "png") : "png";
      return { bytes: decodeBase64(base64), contentType: mime || mimeForFormat(format), format, model };
    }
    throw new Error("Gemini returned no image data.");
  }
}
