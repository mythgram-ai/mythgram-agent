import type { ProviderRegistry } from "./providers/registry.js";
import { resolveProvider } from "./providers/registry.js";

/**
 * Server-side context-window resolution for backend-originated turns
 * (messaging channels, scheduled runs) that have no client to resolve it.
 *
 * Web-app turns receive an already-resolved `context_limit` from the frontend
 * (provider catalog wins, else the user's manual entry). Channels and
 * schedules run with no browser attached, so they resolve the same value
 * here: the user's manual Settings entry wins (no network), otherwise the
 * provider's model catalog is consulted (cached). Unknown limits resolve to
 * null, which keeps summarization handoff disabled — the same safe posture
 * as a web turn without a limit. Never throws.
 */

/** Bounds for a manually entered context limit, in tokens (mirrors the frontend). */
export const MANUAL_LIMIT_MIN = 1_000;
export const MANUAL_LIMIT_MAX = 1_000_000_000;

/** How long a successfully resolved catalog limit is reused without refetching. */
export const CATALOG_LIMIT_TTL_MS = 60 * 60_000;

/** How long a failed/unknown catalog lookup suppresses refetching (manual entries bypass the cache). */
export const CATALOG_MISS_TTL_MS = 5 * 60_000;

/** Upper bound for one catalog lookup so a slow provider can never stall a turn start. */
export const CATALOG_LOOKUP_TIMEOUT_MS = 15_000;

interface CachedLimit {
  limit: number | null;
  at: number;
}

const catalogCache = new Map<string, CachedLimit>();

/** Test hook: drop all cached catalog limits. */
export function clearContextLimitCache(): void {
  catalogCache.clear();
}

/** Storage key for one provider+model pair's manual limit (mirrors the frontend). */
export function manualLimitKey(provider: string, model: string): string {
  return `${provider.trim()}::${model.trim()}`;
}

/**
 * The user's manual Settings entry for a provider+model pair, or null when
 * absent/invalid. Reads the same `manualContextLimits` document shape the
 * frontend persists into the `settings` app-state document.
 */
export function manualContextLimit(limits: unknown, provider: string, model: string): number | null {
  try {
    if (!limits || typeof limits !== "object" || Array.isArray(limits)) return null;
    if (!provider.trim() || !model.trim()) return null;
    const raw = (limits as Record<string, unknown>)[manualLimitKey(provider, model)];
    return typeof raw === "number" && Number.isInteger(raw) && raw >= MANUAL_LIMIT_MIN && raw <= MANUAL_LIMIT_MAX
      ? raw
      : null;
  } catch {
    return null;
  }
}

export interface CatalogLimitInput {
  providers: ProviderRegistry;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  customProvider?: unknown;
  /** Lookup timeout override (tests use a short window). */
  timeoutMs?: number;
}

/**
 * Best-effort catalog lookup of a model's context window (tokens) via the
 * provider's model list. Results (including misses) are cached process-wide
 * so one slow provider cannot stall every turn. Returns null when the
 * provider/model is unknown, the lookup fails/times out, or the catalog
 * publishes no usable window. Never throws.
 */
export async function catalogContextLimit(input: CatalogLimitInput): Promise<number | null> {
  try {
    const providerId = (input.provider ?? "").trim();
    const model = (input.model ?? "").trim();
    if (!providerId || !model) return null;

    const key = manualLimitKey(providerId, model);
    const cached = catalogCache.get(key);
    if (cached) {
      const ttl = cached.limit !== null ? CATALOG_LIMIT_TTL_MS : CATALOG_MISS_TTL_MS;
      if (Date.now() - cached.at < ttl) return cached.limit;
    }

    const timeoutMs =
      typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
        ? Math.min(input.timeoutMs, 60_000)
        : CATALOG_LOOKUP_TIMEOUT_MS;

    let limit: number | null = null;
    try {
      const provider = resolveProvider(input.providers, providerId, input.customProvider);
      const models = await withTimeout(provider.listModels(input.apiKey, input.baseUrl), timeoutMs);
      const match =
        models.find((m) => m.id === model) ??
        models.find((m) => m.id.trim().toLowerCase() === model.toLowerCase());
      const window = match?.context_window;
      limit =
        typeof window === "number" && Number.isFinite(window) && window > 0 ? Math.floor(window) : null;
    } catch {
      limit = null;
    }
    catalogCache.set(key, { limit, at: Date.now() });
    return limit;
  } catch {
    return null;
  }
}

export interface ServerContextLimitInput extends CatalogLimitInput {
  /** Raw `manualContextLimits` document from Settings (manual entry wins, no network). */
  manualLimits?: unknown;
}

/**
 * Full server-side resolution: the manual Settings entry wins immediately;
 * otherwise the cached provider catalog is consulted. Null when unknown
 * (handoff stays disabled). Never throws.
 */
export async function resolveServerContextLimit(input: ServerContextLimitInput): Promise<number | null> {
  const manual = manualContextLimit(input.manualLimits, input.provider, input.model);
  if (manual !== null) return manual;
  return catalogContextLimit(input);
}

/** Reject with an error when `task` takes longer than `ms` (bounds catalog lookups). */
function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Context-limit lookup timed out.")), ms);
    if (typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([task.finally(() => clearTimeout(timer)), timeout]);
}
