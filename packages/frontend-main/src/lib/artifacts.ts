import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";

/** The kind of content an artifact holds (shown as a label on the artifact card). */
export type ArtifactType =
  | "markdown"
  | "code_file"
  | "text"
  | "html"
  | "csv"
  | "json"
  | "docs"
  | "design"
  | "slides";

/** Every valid artifact type, in display order. */
export const ARTIFACT_TYPES: readonly ArtifactType[] = [
  "markdown",
  "code_file",
  "text",
  "html",
  "csv",
  "json",
  "docs",
  "design",
  "slides",
];

/** Metadata describing one saved artifact. */
export interface ArtifactMeta {
  id: string;
  title: string;
  description: string;
  type: ArtifactType;
  /** Workspace-relative posix path of the artifact file, e.g. ".mythgram/artifacts/<id>.md". */
  file: string;
  sizeBytes: number;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Full artifact payload including its raw file content. */
export interface ArtifactWithContent extends ArtifactMeta {
  content: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Normalize one artifact metadata payload, or null when it is malformed. */
export function normalizeArtifactMeta(raw: unknown): ArtifactMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  const file = str(r.file).trim();
  if (!id || !file) return null;
  const type = (ARTIFACT_TYPES as readonly string[]).includes(str(r.type))
    ? (str(r.type) as ArtifactType)
    : "text";
  return {
    id,
    title: str(r.title).trim() || id,
    description: str(r.description),
    type,
    file,
    sizeBytes: num(r.sizeBytes ?? r.size_bytes),
    pinned: r.pinned === true,
    createdAt: num(r.createdAt ?? r.created_at),
    updatedAt: num(r.updatedAt ?? r.updated_at),
  };
}

/** Normalize a list of artifact metadata payloads (drops malformed entries). */
export function normalizeArtifactList(raw: unknown): ArtifactMeta[] {
  if (!Array.isArray(raw)) return [];
  const out: ArtifactMeta[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const meta = normalizeArtifactMeta(item);
    if (!meta || seen.has(meta.id)) continue;
    seen.add(meta.id);
    out.push(meta);
  }
  return out;
}

/** Normalize an artifact payload that also carries its raw content. */
export function normalizeArtifactWithContent(raw: unknown): ArtifactWithContent | null {
  const meta = normalizeArtifactMeta(raw);
  if (!meta) return null;
  return { ...meta, content: str((raw as Record<string, unknown>).content) };
}

export async function fetchArtifacts(signal?: AbortSignal): Promise<ArtifactMeta[]> {
  const data = await requestJson<{ artifacts?: unknown }>(
    routeUrl(API_ROUTES.artifactsList),
    undefined,
    signal,
  );
  return normalizeArtifactList(data.artifacts);
}

export async function fetchArtifact(id: string, signal?: AbortSignal): Promise<ArtifactWithContent> {
  const data = await requestJson<{ artifact?: unknown }>(
    routeUrl(API_ROUTES.artifactsGet, { params: { id } }),
    undefined,
    signal,
  );
  const artifact = normalizeArtifactWithContent(data.artifact);
  if (!artifact) throw new Error("The artifact could not be loaded.");
  return artifact;
}

export async function updateArtifact(
  id: string,
  patch: { title?: string; description?: string; type?: ArtifactType; content?: string },
): Promise<ArtifactMeta> {
  const data = await requestJson<{ artifact?: unknown }>(
    routeUrl(API_ROUTES.artifactsUpdate, { params: { id } }),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  const artifact = normalizeArtifactMeta(data.artifact);
  if (!artifact) throw new Error("The artifact could not be updated.");
  return artifact;
}

export async function pinArtifact(id: string, pinned: boolean): Promise<ArtifactMeta> {
  const data = await requestJson<{ artifact?: unknown }>(
    routeUrl(API_ROUTES.artifactsPin, { params: { id } }),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    },
  );
  const artifact = normalizeArtifactMeta(data.artifact);
  if (!artifact) throw new Error("The artifact could not be updated.");
  return artifact;
}

export async function duplicateArtifact(id: string): Promise<ArtifactMeta> {
  const data = await requestJson<{ artifact?: unknown }>(
    routeUrl(API_ROUTES.artifactsDuplicate, { params: { id } }),
    { method: "POST" },
  );
  const artifact = normalizeArtifactMeta(data.artifact);
  if (!artifact) throw new Error("The artifact could not be duplicated.");
  return artifact;
}

export async function deleteArtifact(id: string): Promise<ArtifactMeta> {
  const data = await requestJson<{ artifact?: unknown }>(
    routeUrl(API_ROUTES.artifactsDelete, { params: { id } }),
    { method: "DELETE" },
  );
  const artifact = normalizeArtifactMeta(data.artifact);
  if (!artifact) throw new Error("The artifact could not be deleted.");
  return artifact;
}
