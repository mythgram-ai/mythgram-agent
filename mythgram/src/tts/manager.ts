import type { AppStateRepo } from "../database/repositories/appStateRepo.js";
import type { TtsFetch } from "./client.js";
import {
  isBuiltinProviderId,
  ttsProviderDefinition,
  type TtsProviderDefinition,
} from "./configuration.js";
import { buildTtsProvider } from "./registry.js";
import { TtsStore, type TtsProviderPatch } from "./store.js";
import {
  TTS_PROVIDER_KINDS,
  toPublicTtsProvider,
  type TtsModel,
  type TtsProviderConfig,
  type TtsProviderKind,
  type TtsProviderPublic,
  type TtsVoice,
} from "./types.js";

/** Everything the manager needs from the rest of the app. */
export interface TtsManagerDeps {
  appState: AppStateRepo;
  /** Server fallback keys (used when a config has no stored key). */
  openrouterApiKey?: string;
  kittenmlApiKey?: string;
  /** Injectable fetch implementation (tests); defaults to the global fetch. */
  fetchFn?: TtsFetch;
}

/** One synthesis request as accepted from the API layer. */
export interface TtsSynthesizeRequest {
  text: string;
  model?: string;
  voice?: string;
  language?: string;
  format?: string;
  speed?: number;
  instructions?: string;
}

/** The result of a synthesis request, with the audio base64-encoded. */
export interface TtsSynthesisResult {
  providerId: string;
  providerKind: TtsProviderKind;
  providerName: string;
  model: string;
  voice: string;
  format: string;
  mime: string;
  /** The raw audio bytes, base64-encoded, ready for the browser. */
  base64: string;
  filename: string;
  bytes: number;
}

const MAX_INPUT_CHARS = 40_000;

function sanitizeFilenameBase(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 40) || "speech";
}

/**
 * TtsManager — the lifecycle owner for the TTS engine.
 *
 * It persists provider configurations in the SQLite app_state repository,
 * resolves the API key for each provider (stored key, else env fallback),
 * fetches live models/voices, and performs synthesis through the matching
 * provider adapter.
 */
export class TtsManager {
  private readonly store: TtsStore;
  private readonly deps: TtsManagerDeps;

  constructor(deps: TtsManagerDeps) {
    this.deps = deps;
    this.store = new TtsStore(deps.appState);
    this.store.ensureBuiltins();
  }

  /** The static catalog of provider kinds (labels, docs, setup instructions). */
  catalog(): TtsProviderDefinition[] {
    return TTS_PROVIDER_KINDS.map(ttsProviderDefinition);
  }

  /** Browser-safe provider configurations. */
  listPublic(): TtsProviderPublic[] {
    return this.store.list().map((config) => toPublicTtsProvider(config, this.hasApiKey(config)));
  }

  /** The stored configuration for one provider id, or null. */
  get(id: string): TtsProviderConfig | null {
    return this.store.get(id);
  }

  /**
   * Create a provider. A built-in kind upserts its single record (id === kind);
   * `kind: "custom"` mints a new provider record.
   */
  create(input: TtsProviderPatch & { kind?: unknown }): TtsProviderConfig {
    const kind = typeof input.kind === "string" ? input.kind.trim().toLowerCase() : "";
    if (isBuiltinProviderId(kind)) return this.store.upsertBuiltin(kind, input);
    if (kind === "custom") return this.store.createCustom(input);
    throw new Error("Unknown provider kind. Expected openrouter, kittenml, or custom.");
  }

  /** Update a provider by id. Returns the updated config, or null when missing. */
  update(id: string, input: TtsProviderPatch): TtsProviderConfig | null {
    return this.store.update(id, input);
  }

  /** Delete a custom provider (built-ins cannot be removed). */
  delete(id: string): boolean {
    return this.store.delete(id);
  }

  /** Fetch the live model list for a provider. */
  async listModels(id: string): Promise<TtsModel[]> {
    const { config, provider } = this.resolve(id);
    const models = await provider.listModels({
      apiKey: this.resolveApiKey(config),
      baseUrl: config.baseUrl || undefined,
      language: config.language || undefined,
    });
    return models;
  }

  /** Fetch the live voice list for a provider (optionally for one model). */
  async listVoices(id: string, model?: string): Promise<TtsVoice[]> {
    const { config, provider } = this.resolve(id);
    return provider.listVoices(
      {
        apiKey: this.resolveApiKey(config),
        baseUrl: config.baseUrl || undefined,
        language: config.language || undefined,
      },
      model || config.model || undefined,
    );
  }

  /** Synthesize speech and return the audio base64-encoded for the browser. */
  async synthesize(id: string, request: TtsSynthesizeRequest): Promise<TtsSynthesisResult> {
    const { config, provider } = this.resolve(id);
    const text = (request.text ?? "").trim();
    if (!text) throw new Error("Text is required.");
    if (text.length > MAX_INPUT_CHARS) {
      throw new Error(`Text is too long (max ${MAX_INPUT_CHARS} characters).`);
    }
    const model = (request.model ?? "").trim() || config.model;
    if (!model) throw new Error("A model is required.");
    const voice = (request.voice ?? "").trim() || config.voice;
    const language = (request.language ?? "").trim() || config.language;
    const format = (request.format ?? "").trim().toLowerCase() || config.responseFormat;

    const audio = await provider.synthesize({
      apiKey: this.resolveApiKey(config),
      baseUrl: config.baseUrl || undefined,
      model,
      input: text,
      voice: voice || undefined,
      language: language || undefined,
      responseFormat: format || undefined,
      speed: typeof request.speed === "number" ? request.speed : undefined,
      instructions: request.instructions?.trim() || undefined,
    });

    const extension = audio.format || format || "mp3";
    const filename = `${sanitizeFilenameBase(config.name)}-${Date.now()}.${extension}`;
    return {
      providerId: config.id,
      providerKind: config.kind,
      providerName: config.name,
      model: audio.model || model,
      voice,
      format: extension,
      mime: audio.contentType,
      base64: Buffer.from(audio.bytes).toString("base64"),
      filename,
      bytes: audio.bytes.length,
    };
  }

  /** Resolve a stored config + its live adapter, or throw a clear error. */
  private resolve(id: string): { config: TtsProviderConfig; provider: ReturnType<typeof buildTtsProvider> } {
    const config = this.store.get(id);
    if (!config) throw new Error(`Unknown TTS provider: ${id}`);
    if (!config.enabled) throw new Error(`The ${config.name} provider is disabled.`);
    const provider = buildTtsProvider(config, { fetchFn: this.deps.fetchFn });
    return { config, provider };
  }

  /** The API key used for a config: the stored key, else the env fallback. */
  private resolveApiKey(config: TtsProviderConfig): string {
    const stored = (config.apiKey ?? "").trim();
    if (stored) return stored;
    if (config.kind === "openrouter") return (this.deps.openrouterApiKey ?? "").trim();
    if (config.kind === "kittenml") return (this.deps.kittenmlApiKey ?? "").trim();
    return "";
  }

  /** Whether a usable key exists (stored or env) for the browser projection. */
  private hasApiKey(config: TtsProviderConfig): boolean {
    return this.resolveApiKey(config).length > 0;
  }
}
