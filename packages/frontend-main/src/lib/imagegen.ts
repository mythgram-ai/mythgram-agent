import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";
import type {
  CustomHeader,
  ImageAspectRatio,
  ImageGenAgentConfig,
  ImageGenModel,
  ImageGenProvider,
  ImageGenProviderDefinition,
  ImageGenProviderKind,
  ImageGenResult,
} from "@/types";

/**
 * Image generation client.
 *
 * Provider API keys are write-only: the browser sends a key on create/update,
 * the backend stores it in SQLite and only ever serves the public projection
 * (hasApiKey flag). Models are fetched live from the provider where an endpoint
 * exists — the browser never hard-codes them.
 */

const KINDS: ImageGenProviderKind[] = [
  "openrouter",
  "minimax",
  "gemini",
  "clipdrop",
  "pollinations",
  "nvidia",
  "custom",
];

const ASPECT_RATIOS: ImageAspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4"];

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeHeaders(raw: unknown): CustomHeader[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomHeader[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const key = str(record.key).trim();
    if (!key) continue;
    out.push({ key, value: str(record.value) });
  }
  return out;
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function aspectRatioOf(raw: unknown): ImageAspectRatio {
  const value = str(raw) as ImageAspectRatio;
  return ASPECT_RATIOS.includes(value) ? value : "1:1";
}

function normalizeProvider(raw: unknown): ImageGenProvider | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const kind = str(r.kind) as ImageGenProviderKind;
  if (!id || !KINDS.includes(kind)) return null;
  return {
    id,
    kind,
    name: str(r.name) || kind,
    enabled: r.enabled !== false,
    baseUrl: str(r.baseUrl),
    model: str(r.model),
    aspectRatio: aspectRatioOf(r.aspectRatio),
    headers: normalizeHeaders(r.headers),
    models: normalizeStringList(r.models),
    hasApiKey: r.hasApiKey === true,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

function normalizeModel(raw: unknown): ImageGenModel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return { id, name: str(r.name) || id };
}

export interface ImageGenProvidersPayload {
  providers: ImageGenProvider[];
  catalog: ImageGenProviderDefinition[];
}

export async function fetchImageGenProviders(signal?: AbortSignal): Promise<ImageGenProvidersPayload> {
  const data = await requestJson<{ providers?: unknown[]; catalog?: unknown[] }>(
    routeUrl(API_ROUTES.imageGenProviders),
    undefined,
    signal,
  );
  const providers = (Array.isArray(data.providers) ? data.providers : [])
    .map(normalizeProvider)
    .filter((p): p is ImageGenProvider => p !== null);
  const catalog = (Array.isArray(data.catalog) ? data.catalog : []) as ImageGenProviderDefinition[];
  return { providers, catalog };
}

export interface ImageGenProviderInput {
  kind?: ImageGenProviderKind;
  name?: string;
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  aspectRatio?: ImageAspectRatio;
  headers?: CustomHeader[];
  models?: string[];
}

export async function createImageGenProvider(input: ImageGenProviderInput): Promise<ImageGenProvider> {
  const data = await requestJson<{ provider?: unknown }>(routeUrl(API_ROUTES.imageGenProviderCreate), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const provider = normalizeProvider(data.provider);
  if (!provider) throw new Error("The backend did not return the created provider.");
  return provider;
}

export async function updateImageGenProvider(
  id: string,
  patch: ImageGenProviderInput,
): Promise<ImageGenProvider> {
  const data = await requestJson<{ provider?: unknown }>(
    routeUrl(API_ROUTES.imageGenProviderUpdate, { params: { id } }),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  const provider = normalizeProvider(data.provider);
  if (!provider) throw new Error("The backend did not return the updated provider.");
  return provider;
}

export async function deleteImageGenProvider(id: string): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.imageGenProviderDelete, { params: { id } }), {
    method: "DELETE",
  }).catch(() => {});
}

export async function fetchImageGenModels(id: string, signal?: AbortSignal): Promise<ImageGenModel[]> {
  const data = await requestJson<{ models?: unknown[] }>(
    routeUrl(API_ROUTES.imageGenProviderModels, { params: { id } }),
    undefined,
    signal,
  );
  return (Array.isArray(data.models) ? data.models : [])
    .map(normalizeModel)
    .filter((m): m is ImageGenModel => m !== null);
}

export interface ImageGenInput {
  providerId: string;
  prompt: string;
  model?: string;
  aspectRatio?: ImageAspectRatio;
}

export async function generateImage(input: ImageGenInput): Promise<ImageGenResult> {
  const data = await requestJson<{ image?: unknown }>(routeUrl(API_ROUTES.imageGenGenerate), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const image = data.image as ImageGenResult | undefined;
  if (!image || typeof image.base64 !== "string" || !image.base64) {
    throw new Error("The backend did not return an image.");
  }
  return image;
}

/** Defensively normalize the agent image settings payload. */
function normalizeAgentConfig(raw: unknown): ImageGenAgentConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    providerId: str(r.providerId),
    model: str(r.model),
    aspectRatio: aspectRatioOf(r.aspectRatio),
  };
}

export interface ImageGenAgentPayload {
  config: ImageGenAgentConfig;
  /** Provider id auto-selection would currently pick ("" when none is available). */
  autoProviderId: string;
}

export async function fetchImageGenAgentConfig(signal?: AbortSignal): Promise<ImageGenAgentPayload> {
  const data = await requestJson<{ config?: unknown; auto_provider_id?: unknown }>(
    routeUrl(API_ROUTES.imageGenAgent),
    undefined,
    signal,
  );
  return {
    config: normalizeAgentConfig(data.config),
    autoProviderId: str(data.auto_provider_id),
  };
}

export interface ImageGenAgentConfigInput {
  providerId?: string;
  model?: string;
  aspectRatio?: ImageAspectRatio;
}

export async function updateImageGenAgentConfig(
  input: ImageGenAgentConfigInput,
): Promise<ImageGenAgentConfig> {
  const data = await requestJson<{ config?: unknown }>(routeUrl(API_ROUTES.imageGenAgentUpdate), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return normalizeAgentConfig(data.config);
}

/** Decode a base64 image result into a displayable data URL. */
export function imageResultToDataUrl(image: ImageGenResult): string {
  return `data:${image.mime || "image/png"};base64,${image.base64}`;
}

/** Trigger a browser download of a generated image result. */
export function downloadImageResult(image: ImageGenResult): void {
  const anchor = document.createElement("a");
  anchor.href = imageResultToDataUrl(image);
  anchor.download = image.filename || "image.png";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
