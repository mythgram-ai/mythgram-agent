import {
  IMAGE_GENERATION_TIMEOUT_MS,
  IMAGE_LIST_TIMEOUT_MS,
  imageRequestBinary,
  imageRequestJson,
  type ImageFetch,
} from "../client.js";
import {
  asRecord,
  decodeBase64,
  fallbackModels,
  formatFromContentType,
  mimeForFormat,
  pickArray,
  pickString,
  resolveBase,
  sizeForAspectRatio,
  toModel,
} from "./helpers.js";
import type {
  ImageGenerateOptions,
  ImageListOptions,
  ImageModel,
  ImageProviderKind,
  ImageRawResult,
} from "../types.js";

export { formatFromContentType } from "./helpers.js";

/**
 * Runtime configuration handed to a provider adapter. It carries everything the
 * adapter needs that is not per-request: the base URL, static headers, manually
 * declared models (custom providers), and an optional fetch implementation for tests.
 */
export interface ImageProviderRuntime {
  kind: ImageProviderKind;
  name: string;
  baseUrl: string;
  headers: Record<string, string>;
  manualModels: string[];
  fetchFn?: ImageFetch;
}

/** The contract every provider adapter implements. */
export interface ImageProvider {
  readonly kind: ImageProviderKind;
  readonly name: string;
  listModels(options: ImageListOptions): Promise<ImageModel[]>;
  generate(options: ImageGenerateOptions): Promise<ImageRawResult>;
}

/**
 * Shared base for every image adapter. It owns the runtime config and the common
 * URL/header plumbing. Concrete adapters implement `listModels` and `generate`.
 */
export abstract class ImageProviderBase implements ImageProvider {
  readonly kind: ImageProviderKind;
  readonly name: string;
  protected readonly runtime: ImageProviderRuntime;

  constructor(runtime: ImageProviderRuntime) {
    this.runtime = runtime;
    this.kind = runtime.kind;
    this.name = runtime.name;
  }

  /** The base URL for this request (override wins), with trailing slashes stripped. */
  protected resolveBaseUrl(override?: string): string {
    return resolveBase(this.runtime.baseUrl, override);
  }

  /** Merge user-configured headers over a provider's own headers. */
  protected withRuntimeHeaders(extra: Record<string, string>): Record<string, string> {
    return { ...extra, ...this.runtime.headers };
  }

  protected fetchJson<T>(
    url: string,
    init: RequestInit,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    return imageRequestJson<T>(url, init, {
      fetchFn: this.runtime.fetchFn,
      timeoutMs: options.timeoutMs ?? IMAGE_LIST_TIMEOUT_MS,
      signal: options.signal,
    });
  }

  protected fetchBinary(
    url: string,
    init: RequestInit,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<{ bytes: Uint8Array; contentType: string; headers: Headers }> {
    return imageRequestBinary(url, init, {
      fetchFn: this.runtime.fetchFn,
      timeoutMs: options.timeoutMs ?? IMAGE_GENERATION_TIMEOUT_MS,
      signal: options.signal,
    });
  }

  /** Fallback list from manually declared models (custom providers). */
  protected manualModels(): ImageModel[] {
    return fallbackModels(this.runtime.manualModels);
  }

  abstract listModels(options: ImageListOptions): Promise<ImageModel[]>;
  abstract generate(options: ImageGenerateOptions): Promise<ImageRawResult>;
}

/**
 * Base implementation of an OpenAI-compatible text-to-image provider.
 *
 * Generation is a single `POST {base}/images/generations` returning either
 * base64 (`data[].b64_json`) or a URL (`data[].url`) — the shape shared by
 * OpenAI, NVIDIA NIM, and most local servers. Model listing uses `GET {base}/models`.
 */
export class OpenAICompatibleImageProvider extends ImageProviderBase {
  /** Headers for a request: JSON content type, optional Bearer auth, static extras. */
  protected requestHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = this.withRuntimeHeaders({
      "Content-Type": "application/json",
    });
    const key = (apiKey ?? "").trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  /** The models-listing URL; subclasses may append query parameters. */
  protected modelsUrl(base: string): string {
    return `${base}/models`;
  }

  /** The image-generation URL. */
  protected imagesUrl(base: string): string {
    return `${base}/images/generations`;
  }

  async listModels(options: ImageListOptions): Promise<ImageModel[]> {
    const base = this.resolveBaseUrl(options.baseUrl);
    try {
      const payload = await this.fetchJson<unknown>(
        this.modelsUrl(base),
        { method: "GET", headers: this.requestHeaders(options.apiKey) },
        { signal: options.signal },
      );
      const items = Array.isArray(payload)
        ? (payload as unknown[])
        : pickArray(payload as Record<string, unknown>, "data", "models");
      const models: ImageModel[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const model = toModel(item);
        if (!model || seen.has(model.id)) continue;
        seen.add(model.id);
        models.push(model);
      }
      if (models.length > 0) return models;
    } catch (error) {
      if (this.runtime.manualModels.length === 0) throw error;
    }
    return this.manualModels();
  }

  async generate(options: ImageGenerateOptions): Promise<ImageRawResult> {
    const base = this.resolveBaseUrl(options.baseUrl);
    const { width, height } = sizeForAspectRatio(options.aspectRatio, 1024);
    const body: Record<string, unknown> = {
      model: options.model,
      prompt: options.prompt,
      n: 1,
      response_format: "b64_json",
      size: `${width}x${height}`,
    };

    const payload = await this.fetchJson<Record<string, unknown>>(
      this.imagesUrl(base),
      {
        method: "POST",
        headers: this.requestHeaders(options.apiKey),
        body: JSON.stringify(body),
      },
      { timeoutMs: IMAGE_GENERATION_TIMEOUT_MS, signal: options.signal },
    );

    const image = await this.extractImage(payload, options);
    return { ...image, model: options.model };
  }

  /** Pull the first image out of an OpenAI-compatible (or compatible) response. */
  protected async extractImage(
    payload: Record<string, unknown>,
    options: ImageGenerateOptions,
  ): Promise<{ bytes: Uint8Array; contentType: string; format: string }> {
    const data = pickArray(payload, "data", "images", "artifacts", "output");
    const first = asRecord(data[0]);
    if (!first) {
      throw new Error("The image provider returned no image data.");
    }
    const base64 = pickString(first, "b64_json", "b64", "base64", "image_base64", "image");
    if (base64) {
      const format = this.formatFromMediaType(pickString(first, "media_type", "mime_type"), "png");
      return { bytes: decodeBase64(base64), contentType: mimeForFormat(format), format };
    }
    const url = pickString(first, "url", "image_url", "imageUrl");
    if (url) {
      const { bytes, contentType } = await this.fetchBinary(
        url,
        { method: "GET", headers: this.withRuntimeHeaders({}) },
        { timeoutMs: IMAGE_GENERATION_TIMEOUT_MS, signal: options.signal },
      );
      const format = formatFromContentType(contentType, "png");
      return { bytes, contentType, format };
    }
    throw new Error("The image provider returned no image data.");
  }

  /** Derive a container format from a `media_type` field (e.g. `image/png`). */
  protected formatFromMediaType(mediaType: string, fallback: string): string {
    const value = (mediaType ?? "").toLowerCase();
    if (!value) return fallback;
    return formatFromContentType(value, fallback);
  }
}
