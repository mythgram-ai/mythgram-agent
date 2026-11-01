import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { createArtifactId } from "../database/ids.js";
import { resolveDataRoot } from "../config.js";
import { safeResolve } from "../utils/paths.js";
import {
  ARTIFACT_TYPES,
  type ArtifactMeta,
  type ArtifactType,
  type ArtifactWithContent,
  type SaveArtifactInput,
  type UpdateArtifactInput,
} from "./types.js";

/**
 * Artifacts are stored as plain files on disk inside the workspace so the agent can edit them
 * directly with the normal file tools. Layout:
 *
 *   <workspace>/.mythgram/artifacts/<id><ext>          — the artifact's raw file
 *   <workspace>/.mythgram/artifacts/artifacts.json     — the metadata manifest
 *
 * The manifest is the source of truth for title/description/type/pinned and maps each artifact id
 * to its file. The artifact id is also the file-name stem, so a file path is always derivable.
 */
export const ARTIFACTS_DIR = ".mythgram/artifacts";
/** Workspace-relative posix path of the metadata manifest. */
export const ARTIFACT_MANIFEST_FILE = ".mythgram/artifacts/artifacts.json";

/** Image, video, and audio file extensions that can NEVER be saved as artifacts. */
export const MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  // Images
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".ico",
  ".tif",
  ".tiff",
  ".avif",
  ".heic",
  ".heif",
  ".raw",
  // Video
  ".mp4",
  ".m4v",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".flv",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".3gp",
  ".3g2",
  ".ogv",
  // Audio
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".m4a",
  ".aac",
  ".flac",
  ".opus",
  ".wma",
  ".aiff",
  ".aif",
  ".mid",
  ".midi",
]);

/** Structured, model-readable error raised by every artifact operation. */
export class ArtifactError extends Error {
  readonly code: string;
  readonly extra?: Record<string, unknown>;

  constructor(code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "ArtifactError";
    this.code = code;
    this.extra = extra;
  }
}

/** True when the file extension belongs to the blocked media set (case-insensitive). */
export function isMediaExtension(ext: string): boolean {
  return MEDIA_EXTENSIONS.has(ext.trim().toLowerCase());
}

/** The type of an artifact file name/extension, or "" when it has no usable extension. */
function safeExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  // Keep only a conservative, filesystem-safe extension (".md", ".ts", ...). Anything with
  // unexpected characters is dropped so it can never introduce path traversal or odd names.
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : "";
}

/** Persisted manifest shape on disk. */
interface ArtifactManifest {
  artifacts: ArtifactMeta[];
}

/** True when `value` is one of the supported artifact types. */
export function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === "string" && (ARTIFACT_TYPES as readonly string[]).includes(value);
}

/**
 * Coerce an arbitrary persisted record into a well-typed ArtifactMeta, or null when it is
 * malformed. Never throws — a single corrupt manifest row must not break the whole listing.
 */
function normalizeMeta(raw: unknown): ArtifactMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const file = typeof r.file === "string" ? r.file.trim().replace(/\\/g, "/") : "";
  if (!id || !file) return null;
  const type: ArtifactType = isArtifactType(r.type) ? r.type : "text";
  return {
    id,
    title: typeof r.title === "string" && r.title.trim().length > 0 ? r.title : id,
    description: typeof r.description === "string" ? r.description : "",
    type,
    file,
    sizeBytes: typeof r.sizeBytes === "number" && Number.isFinite(r.sizeBytes) ? r.sizeBytes : 0,
    pinned: r.pinned === true,
    createdAt:
      typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
    updatedAt:
      typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) ? r.updatedAt : Date.now(),
  };
}

/** Absolute path of the artifacts directory inside the fixed data dir. */
export function artifactsDirAbs(workspaceRoot: string): string {
  return artifactAbs(workspaceRoot, ARTIFACTS_DIR);
}

/**
 * Absolute path of an artifact file given its logical workspace-relative path
 * (".mythgram/artifacts/<id>.<ext>"). The ".mythgram" prefix is mapped onto the fixed
 * application data directory so artifacts survive workspace switches.
 */
export function artifactAbs(workspaceRoot: string, file: string): string {
  const rel = file
    .replace(/\\/g, "/")
    .replace(/^\.mythgram\/?/, "")
    .split("/")
    .filter(Boolean);
  return path.join(resolveDataRoot(workspaceRoot), ...rel);
}

/** A copy safe to hand to the model/UI (no mutation aliasing). */
function cloneMeta(meta: ArtifactMeta): ArtifactMeta {
  return { ...meta };
}

/**
 * Read + normalize the artifact manifest. Missing or corrupt manifests degrade to an empty list so
 * the very first artifact save always succeeds.
 */
async function readManifest(workspaceRoot: string): Promise<ArtifactMeta[]> {
  const manifestAbs = artifactAbs(workspaceRoot, ARTIFACT_MANIFEST_FILE);
  let raw: string;
  try {
    raw = await fsp.readFile(manifestAbs, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = (parsed as ArtifactManifest | null)?.artifacts;
    if (!Array.isArray(list)) return [];
    const out: ArtifactMeta[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      const meta = normalizeMeta(item);
      if (!meta || seen.has(meta.id)) continue;
      seen.add(meta.id);
      out.push(meta);
    }
    return out;
  } catch {
    return [];
  }
}

/** Atomically write the manifest (tmp file + rename) so a crash never truncates it. */
async function writeManifest(workspaceRoot: string, artifacts: ArtifactMeta[]): Promise<void> {
  const dir = artifactsDirAbs(workspaceRoot);
  await fsp.mkdir(dir, { recursive: true });
  const target = artifactAbs(workspaceRoot, ARTIFACT_MANIFEST_FILE);
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ artifacts }, null, 2), "utf8");
  await fsp.rename(tmp, target);
}

/** Atomically write an artifact file (tmp file + rename). */
async function writeFileAtomic(target: string, content: string): Promise<number> {
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fsp.writeFile(tmp, content, "utf8");
  await fsp.rename(tmp, target);
  const stat = await fsp.stat(target);
  return stat.size;
}

/** Stable ordering: pinned first, then most recently updated. */
function sortArtifacts(list: ArtifactMeta[]): ArtifactMeta[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Filesystem-backed artifact store. Stateless apart from the workspace it is given per call, so a
 * single shared instance is safe to use from the agent tools and the HTTP API.
 */
export class ArtifactsManager {
  /** Every artifact (pinned first, newest first). */
  async list(workspaceRoot: string): Promise<ArtifactMeta[]> {
    return sortArtifacts(await readManifest(workspaceRoot));
  }

  /** Read one artifact's metadata by id. Returns null when unknown. */
  async get(id: string, workspaceRoot: string): Promise<ArtifactMeta | null> {
    const meta = (await readManifest(workspaceRoot)).find((m) => m.id === id);
    return meta ? cloneMeta(meta) : null;
  }

  /**
   * Save an existing workspace file as a new artifact. The source file is copied into the artifacts
   * folder under a fresh id; media files (image/video/audio) are rejected.
   */
  async save(input: SaveArtifactInput, workspaceRoot: string): Promise<ArtifactMeta> {
    const sourceAbs = safeResolve(workspaceRoot, input.artifactFilePath);
    const ext = safeExtension(sourceAbs);
    if (isMediaExtension(ext)) {
      throw new ArtifactError(
        "artifact_media_not_allowed",
        `Media files (image/video/audio) cannot be saved as artifacts: "${input.artifactFilePath}". ` +
          "Save a text-based file (markdown, code, html, csv, json, docs, design, slides) instead.",
        { extension: ext },
      );
    }

    let stat;
    try {
      stat = await fsp.stat(sourceAbs);
    } catch {
      throw new ArtifactError(
        "artifact_file_not_found",
        `The file to save as an artifact does not exist: "${input.artifactFilePath}".`,
        { artifact_file_path: input.artifactFilePath },
      );
    }
    if (!stat.isFile()) {
      throw new ArtifactError(
        "artifact_file_not_found",
        `The artifact path is not a regular file: "${input.artifactFilePath}".`,
        { artifact_file_path: input.artifactFilePath },
      );
    }

    const id = createArtifactId();
    const filename = `${id}${ext}`;
    const fileRel = `${ARTIFACTS_DIR}/${filename}`;
    const destAbs = artifactAbs(workspaceRoot, fileRel);

    await fsp.mkdir(artifactsDirAbs(workspaceRoot), { recursive: true });
    await fsp.copyFile(sourceAbs, destAbs);

    const now = Date.now();
    const meta: ArtifactMeta = {
      id,
      title: input.title.trim() || filename,
      description: input.description,
      type: isArtifactType(input.type) ? input.type : "text",
      file: fileRel,
      sizeBytes: stat.size,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    const next = (await readManifest(workspaceRoot)).filter((m) => m.id !== id);
    next.push(meta);
    await writeManifest(workspaceRoot, next);
    return cloneMeta(meta);
  }

  /** Read an artifact's metadata AND raw content. Throws when the id or file is missing. */
  async read(id: string, workspaceRoot: string): Promise<ArtifactWithContent> {
    const meta = await this.require(id, workspaceRoot);
    let content: string;
    try {
      content = await fsp.readFile(artifactAbs(workspaceRoot, meta.file), "utf8");
    } catch {
      throw new ArtifactError(
        "artifact_file_missing",
        `The artifact file for "${meta.title}" (id: ${meta.id}) is missing from disk.`,
        { artifact_id: meta.id, file: meta.file },
      );
    }
    return { ...meta, content };
  }

  /** Delete an artifact (file + manifest entry). Returns the removed metadata. */
  async remove(id: string, workspaceRoot: string): Promise<ArtifactMeta> {
    const manifest = await readManifest(workspaceRoot);
    const index = manifest.findIndex((m) => m.id === id);
    if (index === -1) {
      throw new ArtifactError(
        "artifact_not_found",
        `No artifact exists with id "${id}". Use list_artifacts to see the available artifact ids.`,
        { artifact_id: id, available_ids: manifest.map((m) => m.id) },
      );
    }
    const [removed] = manifest.splice(index, 1);
    await writeManifest(workspaceRoot, manifest);
    try {
      await fsp.rm(artifactAbs(workspaceRoot, removed!.file), { force: true });
    } catch {
      // The metadata removal already succeeded; a missing file is not fatal.
    }
    return cloneMeta(removed!);
  }

  /** Update an artifact's metadata and/or replace its file content. */
  async update(
    id: string,
    patch: UpdateArtifactInput,
    workspaceRoot: string,
  ): Promise<ArtifactMeta> {
    const manifest = await readManifest(workspaceRoot);
    const meta = manifest.find((m) => m.id === id);
    if (!meta) {
      throw new ArtifactError(
        "artifact_not_found",
        `No artifact exists with id "${id}". Use list_artifacts to see the available artifact ids.`,
        { artifact_id: id },
      );
    }
    if (typeof patch.title === "string" && patch.title.trim().length > 0) {
      meta.title = patch.title.trim();
    }
    if (typeof patch.description === "string") meta.description = patch.description;
    if (isArtifactType(patch.type)) meta.type = patch.type;
    if (typeof patch.content === "string") {
      meta.sizeBytes = await writeFileAtomic(artifactAbs(workspaceRoot, meta.file), patch.content);
    }
    meta.updatedAt = Date.now();
    await writeManifest(workspaceRoot, manifest);
    return cloneMeta(meta);
  }

  /** Pin/unpin an artifact. */
  async setPinned(id: string, pinned: boolean, workspaceRoot: string): Promise<ArtifactMeta> {
    const manifest = await readManifest(workspaceRoot);
    const meta = manifest.find((m) => m.id === id);
    if (!meta) {
      throw new ArtifactError(
        "artifact_not_found",
        `No artifact exists with id "${id}". Use list_artifacts to see the available artifact ids.`,
        { artifact_id: id },
      );
    }
    meta.pinned = pinned;
    meta.updatedAt = Date.now();
    await writeManifest(workspaceRoot, manifest);
    return cloneMeta(meta);
  }

  /** Duplicate an artifact under a new id (copies the file + metadata). */
  async duplicate(id: string, workspaceRoot: string): Promise<ArtifactMeta> {
    const source = await this.require(id, workspaceRoot);
    const ext = safeExtension(source.file);
    const newId = createArtifactId();
    const fileRel = `${ARTIFACTS_DIR}/${newId}${ext}`;
    await fsp.copyFile(
      artifactAbs(workspaceRoot, source.file),
      artifactAbs(workspaceRoot, fileRel),
    );
    const now = Date.now();
    const meta: ArtifactMeta = {
      ...source,
      id: newId,
      title: `${source.title} (copy)`,
      file: fileRel,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    const manifest = await readManifest(workspaceRoot);
    manifest.push(meta);
    await writeManifest(workspaceRoot, manifest);
    return cloneMeta(meta);
  }

  /** Resolve an artifact by id or throw a structured "not found" error. */
  private async require(id: string, workspaceRoot: string): Promise<ArtifactMeta> {
    const manifest = await readManifest(workspaceRoot);
    const meta = manifest.find((m) => m.id === id);
    if (!meta) {
      throw new ArtifactError(
        "artifact_not_found",
        `No artifact exists with id "${id}". Use list_artifacts to see the available artifact ids.`,
        { artifact_id: id, available_ids: manifest.map((m) => m.id) },
      );
    }
    return cloneMeta(meta);
  }
}

/** Shared, stateless artifact store instance for the agent tools and the HTTP API. */
export const artifactsManager = new ArtifactsManager();
