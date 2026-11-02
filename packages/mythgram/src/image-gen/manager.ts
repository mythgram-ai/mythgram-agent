import type { AppStateRepo } from "../database/repositories/appStateRepo.js";
import { ImageGenError, type ImageFetch } from "./client.js";
import {
  imageProviderDefinition,
  isBuiltinImageProviderId,
  type ImageProviderDefinition,
} from "./configuration.js";
import { buildImageProvider } from "./registry.js";
import { ImageStore, type ImageProviderPatch } from "./store.js";
import {
  IMAGE_PROVIDER_KINDS,
  normalizeImageAgentConfig,
  toPublicImageProvider,
  type ImageAgentConfig,
  type ImageAspectRatio,
  type ImageModel,
  type ImageProviderConfig,
  type ImageProviderKind,
  type ImageProviderPublic,
} from "./types.js";
import { extensionForFormat } from "./providers/helpers.js";

/** Everything the manager needs from the rest of the app. */
export interface ImageManagerDeps {
  appState: AppStateRepo;
  /** Server fallback keys (used when a config has no stored key). */
  openrouterApiKey?: string;
  geminiApiKey?: string;
  minimaxApiKey?: string;
  nvidiaApiKey?: string;
  clipdropApiKey?: string;
  /** Injectable fetch implementation (tests); defaults to the global fetch. */
  fetchFn?: ImageFetch;
}

/** One generation request as accepted from the API layer. */
export interface ImageGenerateRequest {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  /** Optional abort signal so a cancelled turn stops an in-flight generation. */
  signal?: AbortSignal;
}

/** The result of a generation request, with the image base64-encoded. */
export interface ImageGenerationResult {
  providerId: string;
  providerKind: ImageProviderKind;
  providerName: string;
  model: string;
  aspectRatio: string;
  format: string;
  mime: string;
  /** The raw image bytes, base64-encoded, ready for the browser. */
  base64: string;
  filename: string;
  bytes: number;
}

const MAX_PROMPT_CHARS = 4000;

function sanitizeFilenameBase(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 40) || "image";
}

/**
 * ImageManager — the lifecycle owner for the image generation engine.
 *
 * It persists provider configurations in the SQLite app_state repository,
 * resolves the API key for each provider (stored key, else env fallback),
 * fetches live model lists, and performs generation through the matching
 * provider adapter.
 */
export class ImageManager {
  private readonly store: ImageStore;
  private readonly deps: ImageManagerDeps;

  constructor(deps: ImageManagerDeps) {
    this.deps = deps;
    this.store = new ImageStore(deps.appState);
    this.store.ensureBuiltins();
  }

  /** The static catalog of provider kinds (labels, docs, setup instructions). */
  catalog(): ImageProviderDefinition[] {
    return IMAGE_PROVIDER_KINDS.map(imageProviderDefinition);
  }

  /** Browser-safe provider configurations. */
  listPublic(): ImageProviderPublic[] {
    return this.store.list().map((config) => toPublicImageProvider(config, this.hasApiKey(config)));
  }

  /** The stored configuration for one provider id, or null. */
  get(id: string): ImageProviderConfig | null {
    return this.store.get(id);
  }

  /**
   * Create a provider. A built-in kind upserts its single record (id === kind);
   * `kind: "custom"` mints a new provider record.
   */
  create(input: ImageProviderPatch & { kind?: unknown }): ImageProviderConfig {
    const kind = typeof input.kind === "string" ? input.kind.trim().toLowerCase() : "";
    if (isBuiltinImageProviderId(kind)) return this.store.upsertBuiltin(kind, input);
    if (kind === "custom") return this.store.createCustom(input);
    throw new Error("Unknown provider kind.");
  }

  /** Update a provider by id. Returns the updated config, or null when missing. */
  update(id: string, input: ImageProviderPatch): ImageProviderConfig | null {
    return this.store.update(id, input);
  }

  /** Delete a custom provider (built-ins cannot be removed). */
  delete(id: string): boolean {
    return this.store.delete(id);
  }

  /** Fetch the live model list for a provider. */
  async listModels(id: string): Promise<ImageModel[]> {
    const { config, provider } = this.resolve(id);
    return provider.listModels({
      apiKey: this.resolveApiKey(config),
      baseUrl: config.baseUrl || undefined,
    });
  }

  /** Generate an image and return it base64-encoded for the browser. */
  async generate(id: string, request: ImageGenerateRequest): Promise<ImageGenerationResult> {
    const { config, provider } = this.resolve(id);
    const prompt = (request.prompt ?? "").trim();
    if (!prompt) throw new Error("A prompt is required.");
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new Error(`The prompt is too long (max ${MAX_PROMPT_CHARS} characters).`);
    }
    const model = (request.model ?? "").trim() || config.model;
    if (!model && imageProviderDefinition(config.kind).supportsModelListing) {
      throw new Error("A model is required.");
    }
    const aspectRatio = (request.aspectRatio ?? "").trim() || config.aspectRatio;

    const image = await provider.generate({
      apiKey: this.resolveApiKey(config),
      baseUrl: config.baseUrl || undefined,
      model,
      prompt,
      aspectRatio,
      signal: request.signal,
    });

    const extension = extensionForFormat(image.format || "png");
    const filename = `${sanitizeFilenameBase(config.name)}-${Date.now()}.${extension}`;
    return {
      providerId: config.id,
      providerKind: config.kind,
      providerName: config.name,
      model: image.model || model,
      aspectRatio,
      format: image.format || "png",
      mime: image.contentType,
      base64: Buffer.from(image.bytes).toString("base64"),
      filename,
      bytes: image.bytes.length,
    };
  }

  /**
   * Pick the best connected image provider for automatic (agent-driven)
   * generation, or null when none is usable. Selection prioritizes:
   *   1. configured built-in providers that have a usable API key (in catalog order),
   *   2. the keyless Pollinations provider,
   *   3. user-defined custom providers (which require only a base URL).
   * Disabled providers are never selected.
   */
  selectProvider(): ImageProviderConfig | null {
    const enabled = this.store.list().filter((config) => config.enabled);
    const keyed = enabled.filter(
      (config) => config.kind !== "custom" && this.hasApiKey(config),
    );
    if (keyed.length > 0) return keyed[0];
    const keyless = enabled.find((config) => config.kind === "pollinations");
    if (keyless) return keyless;
    const custom = enabled.filter(
      (config) => config.kind === "custom" && config.baseUrl.trim().length > 0,
    );
    if (custom.length > 0) return custom[0];
    return null;
  }

  /**
   * Generate an image with the best available provider, automatically selected
   * via `selectProvider()`. Throws a clear, typed error when no usable provider
   * is connected. Used by the agent's `generate_image` tool so the LLM never has
   * to pick a provider.
   */
  async generateAuto(request: ImageGenerateRequest): Promise<ImageGenerationResult> {
    const agent = this.store.getAgentConfig();
    const pinned = agent.providerId ? this.store.get(agent.providerId) : null;
    const config = pinned && pinned.enabled ? pinned : this.selectProvider();
    if (!config) {
      throw new ImageGenError(
        "image_no_provider",
        "No image generation provider is connected. Connect a provider in the Image generation " +
          "settings panel (Pollinations is free and keyless), then try again.",
      );
    }
    return this.generate(config.id, {
      prompt: request.prompt,
      model: agent.model || request.model,
      aspectRatio: agent.aspectRatio || request.aspectRatio,
      signal: request.signal,
    });
  }

  /** The persisted agent-image preferences (used by the generate_image tool). */
  getAgentConfig(): ImageAgentConfig {
    return this.store.getAgentConfig();
  }

  /**
   * Merge + normalize an agent-image settings patch, persist it, and return the
   * stored config. Absent fields keep their stored value.
   */
  updateAgentConfig(input: unknown): ImageAgentConfig {
    const current = this.store.getAgentConfig();
    const patch = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const next = normalizeImageAgentConfig({ ...current, ...patch });
    return this.store.setAgentConfig(next);
  }

  /** The aspect ratio auto-selection would use (config default). */
  defaultAspectRatio(): ImageAspectRatio {
    return this.selectProvider()?.aspectRatio ?? "1:1";
  }

  /** Resolve a stored config + its live adapter, or throw a clear error. */
  private resolve(id: string): {
    config: ImageProviderConfig;
    provider: ReturnType<typeof buildImageProvider>;
  } {
    const config = this.store.get(id);
    if (!config) throw new Error(`Unknown image provider: ${id}`);
    if (!config.enabled) throw new Error(`The ${config.name} provider is disabled.`);
    const provider = buildImageProvider(config, { fetchFn: this.deps.fetchFn });
    return { config, provider };
  }

  /** The API key used for a config: the stored key, else the env fallback. */
  private resolveApiKey(config: ImageProviderConfig): string {
    const stored = (config.apiKey ?? "").trim();
    if (stored) return stored;
    switch (config.kind) {
      case "openrouter":
        return (this.deps.openrouterApiKey ?? "").trim();
      case "gemini":
        return (this.deps.geminiApiKey ?? "").trim();
      case "minimax":
        return (this.deps.minimaxApiKey ?? "").trim();
      case "nvidia":
        return (this.deps.nvidiaApiKey ?? "").trim();
      case "clipdrop":
        return (this.deps.clipdropApiKey ?? "").trim();
      default:
        return "";
    }
  }

  /** Whether a usable key exists (stored or env) for the browser projection. */
  private hasApiKey(config: ImageProviderConfig): boolean {
    return this.resolveApiKey(config).length > 0;
  }
}
