import { createImageProviderId } from "../database/ids.js";
import type { AppStateRepo } from "../database/repositories/appStateRepo.js";
import {
  createDefaultImageProvider,
  imageProviderDefinition,
  isBuiltinImageProviderId,
} from "./configuration.js";
import {
  IMAGE_BUILTIN_KINDS,
  isImageAspectRatio,
  normalizeImageAgentConfig,
  normalizeImageHeaders,
  normalizeImageProvider,
  normalizeImageStringList,
  type ImageAgentConfig,
  type ImageBuiltinKind,
  type ImageHeader,
  type ImageProviderConfig,
} from "./types.js";

/** app_state document key holding the agent-image preferences. */
export const IMAGE_AGENT_STATE_KEY = "imageAgent";

/** A partial update to a provider config. `undefined` means "leave unchanged". */
export interface ImageProviderPatch {
  name?: unknown;
  enabled?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  aspectRatio?: unknown;
  headers?: unknown;
  models?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  if (value === true || value === "yes" || value === "on" || value === 1) return true;
  if (value === false || value === "no" || value === "off" || value === 0) return false;
  return undefined;
}

/**
 * ImageStore — persistent image provider configurations.
 *
 * It reuses the application's existing persistence architecture: every config
 * lives in the SQLite-backed `app_state` document keyed `imageGen`. API keys are
 * stored server-side only and are never served (see toPublicImageProvider).
 */
export class ImageStore {
  constructor(private readonly appState: AppStateRepo) {}

  /** All stored configs, normalized (unknown kinds / malformed rows dropped). */
  list(): ImageProviderConfig[] {
    const raw = this.appState.get("imageGen");
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    const out: ImageProviderConfig[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const config = normalizeImageProvider(item, { id: `img_${createImageProviderId()}`, now });
      if (!config || seen.has(config.id)) continue;
      seen.add(config.id);
      out.push(config);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** One config by id, or null. */
  get(id: string): ImageProviderConfig | null {
    if (!id) return null;
    return this.list().find((c) => c.id === id) ?? null;
  }

  /** The single config for a built-in provider kind, or null. */
  getByKind(kind: ImageBuiltinKind): ImageProviderConfig | null {
    return this.list().find((c) => c.id === kind) ?? null;
  }

  /** The persisted agent-image preferences (normalized; defaults when unset). */
  getAgentConfig(): ImageAgentConfig {
    return normalizeImageAgentConfig(this.appState.get(IMAGE_AGENT_STATE_KEY));
  }

  /** Persist the agent-image preferences (normalized) and return them. */
  setAgentConfig(config: ImageAgentConfig): ImageAgentConfig {
    const normalized = normalizeImageAgentConfig(config);
    this.appState.set(IMAGE_AGENT_STATE_KEY, normalized);
    return normalized;
  }

  /**
   * Seed any missing built-in provider configs so the panel always has one card
   * per provider. Idempotent.
   */
  ensureBuiltins(): void {
    const existing = this.list();
    const byId = new Set(existing.map((c) => c.id));
    const now = Date.now();
    const additions: ImageProviderConfig[] = [];
    for (const kind of IMAGE_BUILTIN_KINDS) {
      if (!byId.has(kind)) additions.push(createDefaultImageProvider(kind, kind, now));
    }
    if (additions.length > 0) this.persist([...existing, ...additions]);
  }

  /**
   * Upsert a built-in provider config by kind (id === kind). The stored record
   * keeps its original createdAt.
   */
  upsertBuiltin(kind: ImageBuiltinKind, patch: ImageProviderPatch): ImageProviderConfig {
    const existing = this.getByKind(kind);
    if (!existing) {
      const created = createDefaultImageProvider(kind, kind, Date.now());
      const next = this.applyPatch(created, patch);
      this.persist([...this.list(), next]);
      return next;
    }
    const next = this.applyPatch(existing, patch);
    this.replace(next);
    return next;
  }

  /** Create a new custom provider. Throws on unusable input. */
  createCustom(patch: ImageProviderPatch): ImageProviderConfig {
    const definition = imageProviderDefinition("custom");
    const now = Date.now();
    const base = createDefaultImageProvider("custom", `img_${createImageProviderId()}`, now);
    base.baseUrl = asString(patch.baseUrl)?.trim().replace(/\/+$/, "") ?? base.baseUrl;
    base.name = asString(patch.name)?.trim().slice(0, 70) || definition.name;
    const config = this.applyPatch(base, patch);
    if (!config.baseUrl) throw new Error("A base URL is required for a custom provider.");
    this.persist([...this.list(), config]);
    return config;
  }

  /** Update any config by id. Returns the updated config, or null when missing. */
  update(id: string, patch: ImageProviderPatch): ImageProviderConfig | null {
    const existing = this.get(id);
    if (!existing) return null;
    const next = this.applyPatch(existing, patch);
    this.replace(next);
    return next;
  }

  /** Delete a config. Built-in configs cannot be removed. */
  delete(id: string): boolean {
    if (isBuiltinImageProviderId(id)) return false;
    const all = this.list();
    const next = all.filter((c) => c.id !== id);
    if (next.length === all.length) return false;
    this.persist(next);
    return true;
  }

  private applyPatch(base: ImageProviderConfig, patch: ImageProviderPatch): ImageProviderConfig {
    const name = asString(patch.name);
    const apiKey = asString(patch.apiKey);
    const baseUrl = asString(patch.baseUrl);
    const model = asString(patch.model);
    const aspectRatio = asString(patch.aspectRatio)?.trim();

    return {
      ...base,
      name: name !== undefined && name.trim() ? name.trim().slice(0, 70) : base.name,
      enabled: asBool(patch.enabled) ?? base.enabled,
      // `apiKey` present (even empty) replaces; absent keeps the stored key.
      apiKey: apiKey !== undefined ? apiKey.trim() : base.apiKey,
      baseUrl: baseUrl !== undefined ? baseUrl.trim().replace(/\/+$/, "") : base.baseUrl,
      model: model !== undefined ? model.trim() : base.model,
      aspectRatio:
        aspectRatio !== undefined
          ? isImageAspectRatio(aspectRatio)
            ? aspectRatio
            : "1:1"
          : base.aspectRatio,
      headers: patch.headers !== undefined ? normalizeImageHeaders(patch.headers) : base.headers,
      models: patch.models !== undefined ? normalizeImageStringList(patch.models) : base.models,
      updatedAt: Date.now(),
    };
  }

  private replace(config: ImageProviderConfig): void {
    const next = this.list().map((c) => (c.id === config.id ? config : c));
    this.persist(next);
  }

  private persist(configs: ImageProviderConfig[]): void {
    this.appState.set("imageGen", configs);
  }
}

export type { ImageHeader };
