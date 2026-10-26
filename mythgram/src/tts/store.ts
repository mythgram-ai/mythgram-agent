import { createTtsProviderId } from "../database/ids.js";
import type { AppStateRepo } from "../database/repositories/appStateRepo.js";
import {
  createDefaultTtsProvider,
  isBuiltinProviderId,
  ttsProviderDefinition,
} from "./configuration.js";
import {
  TTS_BUILTIN_KINDS,
  isTtsOutputFormat,
  normalizeHeaders,
  normalizeStringList,
  normalizeTtsProvider,
  type TtsBuiltinKind,
  type TtsHeader,
  type TtsProviderConfig,
} from "./types.js";

/** A partial update to a provider config. `undefined` means "leave unchanged". */
export interface TtsProviderPatch {
  name?: unknown;
  enabled?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  voice?: unknown;
  language?: unknown;
  responseFormat?: unknown;
  headers?: unknown;
  models?: unknown;
  voices?: unknown;
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
 * TtsStore — persistent TTS provider configurations.
 *
 * It reuses the application's existing persistence architecture: every config
 * lives in the SQLite-backed `app_state` document keyed `tts`. API keys are
 * stored server-side only and are never served (see toPublicTtsProvider).
 */
export class TtsStore {
  constructor(private readonly appState: AppStateRepo) {}

  /** All stored configs, normalized (unknown kinds / malformed rows dropped). */
  list(): TtsProviderConfig[] {
    const raw = this.appState.get("tts");
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    const out: TtsProviderConfig[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const config = normalizeTtsProvider(item, { id: `tts_${createTtsProviderId()}`, now });
      if (!config || seen.has(config.id)) continue;
      seen.add(config.id);
      out.push(config);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** One config by id, or null. */
  get(id: string): TtsProviderConfig | null {
    if (!id) return null;
    return this.list().find((c) => c.id === id) ?? null;
  }

  /** The single config for a built-in provider kind, or null. */
  getByKind(kind: TtsBuiltinKind): TtsProviderConfig | null {
    return this.list().find((c) => c.id === kind) ?? null;
  }

  /**
   * Seed any missing built-in provider configs so the panel always has an
   * OpenRouter and KittenML card to configure. Idempotent.
   */
  ensureBuiltins(): void {
    const existing = this.list();
    const byId = new Set(existing.map((c) => c.id));
    const now = Date.now();
    const additions: TtsProviderConfig[] = [];
    for (const kind of TTS_BUILTIN_KINDS) {
      if (!byId.has(kind)) additions.push(createDefaultTtsProvider(kind, kind, now));
    }
    if (additions.length > 0) this.persist([...existing, ...additions]);
  }

  /**
   * Upsert a built-in provider config by kind (id === kind). The stored record
   * keeps its original createdAt.
   */
  upsertBuiltin(kind: TtsBuiltinKind, patch: TtsProviderPatch): TtsProviderConfig {
    const existing = this.getByKind(kind);
    if (!existing) {
      const created = createDefaultTtsProvider(kind, kind, Date.now());
      const next = this.applyPatch(created, patch);
      this.persist([...this.list(), next]);
      return next;
    }
    const next = this.applyPatch(existing, patch);
    this.replace(next);
    return next;
  }

  /** Create a new custom provider. Throws on unusable input. */
  createCustom(patch: TtsProviderPatch): TtsProviderConfig {
    const definition = ttsProviderDefinition("custom");
    const now = Date.now();
    const base = createDefaultTtsProvider("custom", `tts_${createTtsProviderId()}`, now);
    base.baseUrl = asString(patch.baseUrl)?.trim().replace(/\/+$/, "") ?? base.baseUrl;
    base.name = asString(patch.name)?.trim().slice(0, 70) || definition.name;
    const config = this.applyPatch(base, patch);
    if (!config.baseUrl) throw new Error("A base URL is required for a custom provider.");
    this.persist([...this.list(), config]);
    return config;
  }

  /** Update any config by id. Returns the updated config, or null when missing. */
  update(id: string, patch: TtsProviderPatch): TtsProviderConfig | null {
    const existing = this.get(id);
    if (!existing) return null;
    const next = this.applyPatch(existing, patch);
    this.replace(next);
    return next;
  }

  /** Delete a config. Built-in configs cannot be removed. */
  delete(id: string): boolean {
    if (isBuiltinProviderId(id)) return false;
    const all = this.list();
    const next = all.filter((c) => c.id !== id);
    if (next.length === all.length) return false;
    this.persist(next);
    return true;
  }

  private applyPatch(base: TtsProviderConfig, patch: TtsProviderPatch): TtsProviderConfig {
    const name = asString(patch.name);
    const apiKey = asString(patch.apiKey);
    const baseUrl = asString(patch.baseUrl);
    const model = asString(patch.model);
    const voice = asString(patch.voice);
    const language = asString(patch.language);
    const responseFormat = asString(patch.responseFormat)?.trim().toLowerCase();

    return {
      ...base,
      name: name !== undefined && name.trim() ? name.trim().slice(0, 70) : base.name,
      enabled: asBool(patch.enabled) ?? base.enabled,
      // `apiKey` present (even empty) replaces; absent keeps the stored key.
      apiKey: apiKey !== undefined ? apiKey.trim() : base.apiKey,
      baseUrl: baseUrl !== undefined ? baseUrl.trim().replace(/\/+$/, "") : base.baseUrl,
      model: model !== undefined ? model.trim() : base.model,
      voice: voice !== undefined ? voice.trim() : base.voice,
      language: language !== undefined ? language.trim() : base.language,
      responseFormat:
        responseFormat !== undefined
          ? isTtsOutputFormat(responseFormat)
            ? responseFormat
            : ""
          : base.responseFormat,
      headers: patch.headers !== undefined ? normalizeHeaders(patch.headers) : base.headers,
      models: patch.models !== undefined ? normalizeStringList(patch.models) : base.models,
      voices: patch.voices !== undefined ? normalizeStringList(patch.voices) : base.voices,
      updatedAt: Date.now(),
    };
  }

  private replace(config: TtsProviderConfig): void {
    const next = this.list().map((c) => (c.id === config.id ? config : c));
    this.persist(next);
  }

  private persist(configs: TtsProviderConfig[]): void {
    this.appState.set("tts", configs);
  }
}

export type { TtsHeader };
