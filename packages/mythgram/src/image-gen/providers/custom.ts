import type { ImageFetch } from "../client.js";
import { OpenAICompatibleImageProvider } from "./base.js";

/**
 * A user-defined OpenAI-compatible image generation provider.
 *
 * Any endpoint exposing `POST {baseUrl}/images/generations` works — a hosted
 * service or a local server (the base URL may be `http://localhost:...`). The API
 * key is optional, arbitrary headers are merged into every request, and models
 * can be declared manually when the server has no listing endpoint.
 */
export interface CustomImageConfig {
  id: string;
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
  /** Manually declared models (used when GET /models is unavailable). */
  models?: string[];
  /** Injectable fetch implementation (tests). */
  fetchFn?: ImageFetch;
}

export class CustomImageProvider extends OpenAICompatibleImageProvider {
  constructor(config: CustomImageConfig) {
    super({
      kind: "custom",
      name: (config.name ?? "").trim() || "Custom provider",
      // The base URL is used verbatim — never rewritten or /v1-appended.
      baseUrl: (config.baseUrl ?? "").trim().replace(/\/+$/, ""),
      headers: sanitizeHeaderRecord(config.headers),
      manualModels: (config.models ?? []).map((m) => m.trim()).filter(Boolean),
      fetchFn: config.fetchFn,
    });
  }
}

function sanitizeHeaderRecord(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [key, value] of Object.entries(headers)) {
    const k = (key ?? "").trim();
    if (!k || k.toLowerCase().startsWith("content-type")) continue;
    out[k] = String(value ?? "");
  }
  return out;
}

/** Build a CustomImageProvider from a raw, untrusted payload. */
export function buildCustomImageProvider(config: unknown): CustomImageProvider {
  const record = (config ?? {}) as Record<string, unknown>;
  const headers: Record<string, string> = {};
  if (record.headers && typeof record.headers === "object" && !Array.isArray(record.headers)) {
    for (const [key, value] of Object.entries(record.headers as Record<string, unknown>)) {
      if (typeof value === "string") headers[key] = value;
    }
  }
  return new CustomImageProvider({
    id: typeof record.id === "string" ? record.id : "custom",
    name: typeof record.name === "string" ? record.name : "Custom provider",
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : "",
    headers,
    models: toStringArray(record.models),
  });
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}
