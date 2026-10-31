import { OpenAICompatibleProvider } from "./base.js";
import type { ProviderModel } from "./types.js";

/**
 * A self-contained OpenAI-compatible provider configured by the user at runtime.
 *
 * Unlike the built-in providers (registered statically at boot), a custom provider
 * is constructed on demand from a `CustomProviderConfig` that travels with each
 * request. This is intentionally provider-agnostic: any endpoint exposing an
 * OpenAI-compatible Chat Completions API can be used without a code change.
 *
 * Differences from the built-in OpenAICompatibleProvider:
 *  - API key is OPTIONAL. When absent, no `Authorization` header is sent.
 *  - Arbitrary custom HTTP headers are merged into every request.
 *  - The base URL is taken verbatim from the user config (never `/v1`-appended).
 */
export interface CustomProviderConfig {
  /** Unique internal id (prefixed with the custom-provider marker). */
  id: string;
  /** Human-friendly name shown in the provider selector. */
  name: string;
  /** Exact value sent as the `model` field. */
  model: string;
  /** OpenAI-compatible API base URL, e.g. https://example.com/v1 */
  baseUrl: string;
  /** Optional key used for Bearer auth; omitted entirely when empty. */
  apiKey?: string;
  /** Optional extra HTTP headers (key/value) merged into every request. */
  headers?: Record<string, string>;
}

/** Marker prefix for dynamically-defined providers, also used by the frontend. */
export const CUSTOM_PROVIDER_PREFIX = "custom_";

/** Whether a provider id refers to a user-defined custom provider. */
export function isCustomProviderId(id: string | undefined): boolean {
  return Boolean(id && id.startsWith(CUSTOM_PROVIDER_PREFIX));
}

function normalizeConfig(config: CustomProviderConfig): CustomProviderConfig {
  return {
    ...config,
    name: (config.name ?? "").trim() || "Custom Provider",
    model: (config.model ?? "").trim(),
    baseUrl: (config.baseUrl ?? "").trim().replace(/\/+$/, ""),
    apiKey: config.apiKey?.trim() ?? "",
    headers: sanitizeHeaders(config.headers),
  };
}

/** Drop empty/invalid header entries so we never send malformed headers. */
function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [key, value] of Object.entries(headers)) {
    const k = (key ?? "").trim();
    const v = (value ?? "").trim();
    if (!k || !k.toLowerCase().startsWith("content-type")) out[k] = v;
  }
  return out;
}

export class CustomOpenAIProvider extends OpenAICompatibleProvider {
  private readonly customHeaders: Record<string, string>;

  constructor(config: CustomProviderConfig) {
    const normalized = normalizeConfig(config);
    super({
      id: normalized.id,
      label: normalized.name,
      extraHeaders: normalized.headers,
      defaultBaseUrl: normalized.baseUrl || "https://api.openai.com/v1",
    });
    this.customHeaders = normalized.headers ?? {};
  }

  /** The user-config base URL with a trailing slash stripped. */
  protected override baseUrl(_override?: string): string {
    return super.baseUrl(this.metadata.defaultBaseUrl);
  }

  /**
   * Build request headers: always include Content-Type, merge the user's custom
   * headers, and only attach Bearer auth when an API key was provided.
   */
  protected override headers(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.customHeaders,
    };
    const key = (apiKey ?? "").trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  /**
   * List models when an API key is provided and the endpoint exposes `/models`.
   * Custom providers usually type their models manually, so a missing key or an
   * unsupported endpoint simply yields an empty list instead of failing the call.
   */
  override async listModels(apiKey: string): Promise<ProviderModel[]> {
    if (!(apiKey ?? "").trim()) return [];
    try {
      return await super.listModels(apiKey);
    } catch {
      return [];
    }
  }
}

/**
 * Build a CustomOpenAIProvider from a raw, untrusted request payload. Defensively
 * coerces field types so malformed client input can never crash the agent loop.
 */
export function buildCustomProvider(config: unknown): CustomOpenAIProvider {
  const record = (config ?? {}) as Record<string, unknown>;
  const headers: Record<string, string> = {};
  const rawHeaders = record.headers;
  if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
    for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
      if (typeof value === "string") headers[key] = value;
    }
  }

  return new CustomOpenAIProvider({
    id:
      typeof record.id === "string" && record.id
        ? record.id
        : `${CUSTOM_PROVIDER_PREFIX}${Date.now().toString(36)}`,
    name: typeof record.name === "string" ? record.name : "Custom Provider",
    model: typeof record.model === "string" ? record.model : "",
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : "",
    apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
    headers,
  });
}