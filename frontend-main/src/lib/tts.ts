import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";
import type {
  CustomHeader,
  LocalTtsInstallMethod,
  LocalTtsInstallStatus,
  TtsAgentConfig,
  TtsAudioResult,
  TtsModel,
  TtsOutputFormat,
  TtsProvider,
  TtsProviderDefinition,
  TtsProviderKind,
  TtsVoice,
} from "@/types";

/**
 * Text-to-speech client.
 *
 * Provider API keys are write-only: the browser sends a key on create/update,
 * the backend stores it in SQLite and only ever serves the public projection
 * (hasApiKey flag). Models and voices are always fetched live from the provider
 * — the browser never hard-codes them.
 */

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

const KINDS: TtsProviderKind[] = [
  "openrouter",
  "kittenml",
  "sarvam",
  "azure",
  "elevenlabs",
  "google",
  "gradium",
  "inworld",
  "minimax",
  "volcengine",
  "xai",
  "mimo",
  "localtts",
  "custom",
];

function normalizeProvider(raw: unknown): TtsProvider | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const kind = str(r.kind) as TtsProviderKind;
  if (!id || !KINDS.includes(kind)) return null;
  return {
    id,
    kind,
    name: str(r.name) || kind,
    enabled: r.enabled !== false,
    baseUrl: str(r.baseUrl),
    model: str(r.model),
    voice: str(r.voice),
    language: str(r.language),
    responseFormat: str(r.responseFormat),
    headers: normalizeHeaders(r.headers),
    models: normalizeStringList(r.models),
    voices: normalizeStringList(r.voices),
    hasApiKey: r.hasApiKey === true,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

function normalizeVoice(raw: unknown): TtsVoice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  const voice: TtsVoice = { id, name: str(r.name) || id };
  if (str(r.language)) voice.language = str(r.language);
  if (str(r.type)) voice.type = str(r.type);
  if (str(r.model)) voice.model = str(r.model);
  return voice;
}

function normalizeModel(raw: unknown): TtsModel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  const voices = Array.isArray(r.voices)
    ? r.voices.map(normalizeVoice).filter((v): v is TtsVoice => v !== null)
    : [];
  const languages = normalizeStringList(r.languages);
  return { id, name: str(r.name) || id, voices, languages };
}

export interface TtsProvidersPayload {
  providers: TtsProvider[];
  catalog: TtsProviderDefinition[];
}

export async function fetchTtsProviders(signal?: AbortSignal): Promise<TtsProvidersPayload> {
  const data = await requestJson<{ providers?: unknown[]; catalog?: unknown[] }>(
    routeUrl(API_ROUTES.ttsProviders),
    undefined,
    signal,
  );
  const providers = (Array.isArray(data.providers) ? data.providers : [])
    .map(normalizeProvider)
    .filter((p): p is TtsProvider => p !== null);
  const catalog = (Array.isArray(data.catalog) ? data.catalog : []) as TtsProviderDefinition[];
  return { providers, catalog };
}

export interface TtsProviderInput {
  kind?: TtsProviderKind;
  name?: string;
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
  language?: string;
  responseFormat?: TtsOutputFormat | "";
  headers?: CustomHeader[];
  models?: string[];
  voices?: string[];
}

export async function createTtsProvider(input: TtsProviderInput): Promise<TtsProvider> {
  const data = await requestJson<{ provider?: unknown }>(routeUrl(API_ROUTES.ttsProviderCreate), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const provider = normalizeProvider(data.provider);
  if (!provider) throw new Error("The backend did not return the created provider.");
  return provider;
}

export async function updateTtsProvider(id: string, patch: TtsProviderInput): Promise<TtsProvider> {
  const data = await requestJson<{ provider?: unknown }>(
    routeUrl(API_ROUTES.ttsProviderUpdate, { params: { id } }),
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

export async function deleteTtsProvider(id: string): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.ttsProviderDelete, { params: { id } }), {
    method: "DELETE",
  }).catch(() => {});
}

export async function fetchTtsModels(id: string, signal?: AbortSignal): Promise<TtsModel[]> {
  const data = await requestJson<{ models?: unknown[] }>(
    routeUrl(API_ROUTES.ttsProviderModels, { params: { id } }),
    undefined,
    signal,
  );
  return (Array.isArray(data.models) ? data.models : [])
    .map(normalizeModel)
    .filter((m): m is TtsModel => m !== null);
}

export async function fetchTtsVoices(
  id: string,
  model?: string,
  signal?: AbortSignal,
): Promise<TtsVoice[]> {
  const data = await requestJson<{ voices?: unknown[] }>(
    routeUrl(API_ROUTES.ttsProviderVoices, { params: { id }, query: { model } }),
    undefined,
    signal,
  );
  return (Array.isArray(data.voices) ? data.voices : [])
    .map(normalizeVoice)
    .filter((v): v is TtsVoice => v !== null);
}

export interface TtsSpeechInput {
  providerId: string;
  text: string;
  model?: string;
  voice?: string;
  language?: string;
  format?: TtsOutputFormat;
  speed?: number;
  instructions?: string;
}

export async function synthesizeTts(input: TtsSpeechInput): Promise<TtsAudioResult> {
  const data = await requestJson<{ audio?: unknown }>(routeUrl(API_ROUTES.ttsSpeech), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const audio = data.audio as TtsAudioResult | undefined;
  if (!audio || typeof audio.base64 !== "string" || !audio.base64) {
    throw new Error("The backend did not return audio.");
  }
  return audio;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Defensively normalize the agent speech settings payload. */
function normalizeAgentConfig(raw: unknown): TtsAgentConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    providerId: str(r.providerId),
    model: str(r.model),
    voice: str(r.voice),
    language: str(r.language),
    responseFormat: str(r.responseFormat),
    speed: numOrNull(r.speed),
    instructions: str(r.instructions),
  };
}

export interface TtsAgentPayload {
  config: TtsAgentConfig;
  /** Provider id auto-selection would currently pick ("" when none is available). */
  autoProviderId: string;
}

/** Read the agent speech settings (used by the generate_speech tool). */
export async function fetchTtsAgentConfig(signal?: AbortSignal): Promise<TtsAgentPayload> {
  const data = await requestJson<{ config?: unknown; auto_provider_id?: unknown }>(
    routeUrl(API_ROUTES.ttsAgent),
    undefined,
    signal,
  );
  return {
    config: normalizeAgentConfig(data.config),
    autoProviderId: str(data.auto_provider_id),
  };
}

export interface TtsAgentConfigInput {
  providerId?: string;
  model?: string;
  voice?: string;
  language?: string;
  responseFormat?: TtsOutputFormat | "";
  speed?: number | null;
  instructions?: string;
}

/** Update the agent speech settings and return the stored config. */
export async function updateTtsAgentConfig(input: TtsAgentConfigInput): Promise<TtsAgentConfig> {
  const data = await requestJson<{ config?: unknown }>(routeUrl(API_ROUTES.ttsAgentUpdate), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return normalizeAgentConfig(data.config);
}

function normalizeLocalTtsStatus(raw: unknown): LocalTtsInstallStatus {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const states = ["idle", "installing", "starting", "running", "failed"];
  const methods = ["pypi", "release", "docker"];
  const state = typeof r.state === "string" && states.includes(r.state) ? r.state : "idle";
  const method = typeof r.method === "string" && methods.includes(r.method) ? r.method : "";
  return {
    state: state as LocalTtsInstallStatus["state"],
    method: method as LocalTtsInstallStatus["method"],
    message: str(r.message),
    log: str(r.log),
    reachable: r.reachable === true,
    baseUrl: str(r.baseUrl),
    startedAt: numOrNull(r.startedAt),
    finishedAt: numOrNull(r.finishedAt),
    error: str(r.error) || null,
  };
}

/** Read the current local-tts install/run status. */
export async function fetchLocalTtsStatus(signal?: AbortSignal): Promise<LocalTtsInstallStatus> {
  const data = await requestJson<{ status?: unknown }>(
    routeUrl(API_ROUTES.ttsLocalStatus),
    undefined,
    signal,
  );
  return normalizeLocalTtsStatus(data.status);
}

/** Install and start local-tts with the chosen method (returns the initial status). */
export async function installLocalTts(method: LocalTtsInstallMethod): Promise<LocalTtsInstallStatus> {
  const data = await requestJson<{ status?: unknown }>(routeUrl(API_ROUTES.ttsLocalInstall), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method }),
  });
  return normalizeLocalTtsStatus(data.status);
}

/** Decode a base64 audio result into a playable Blob. */
export function audioResultToBlob(audio: TtsAudioResult): Blob {
  const binary = atob(audio.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: audio.mime || "audio/mpeg" });
}

/** Trigger a browser download of a synthesized audio result. */
export function downloadAudioResult(audio: TtsAudioResult): void {
  const url = URL.createObjectURL(audioResultToBlob(audio));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = audio.filename || "speech.mp3";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
