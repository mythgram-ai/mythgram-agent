import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Shared checkpoint infrastructure (GitHub-commit-style workspace backups).
 *
 * A checkpoint is a `.zip` snapshot of the current workspace files stored under
 * `.mythgram/backups/<name>.zip`, plus a manifest entry (name + description) in
 * `.mythgram/backups/checkpoints.json`. Restoring first takes an automatic safety
 * backup of the current workspace into `.mythgram/backups/btocptd/` ("back to old
 * checkpoint tool data") so a mistaken restore can always be undone.
 *
 * The ZIP format is implemented here with only `node:zlib` (deflate) — no new
 * dependencies — mirroring how the built-in scraper avoids external libraries.
 * Generated files, VCS data, and the agent's own state directory are never
 * included in a snapshot.
 */

/** Directory (relative to the workspace root) holding checkpoint zips + manifest. */
export const CHECKPOINT_BACKUPS_DIR = ".mythgram/backups";

/** Directory (relative to the workspace root) holding automatic safety backups. */
export const CHECKPOINT_SAFETY_DIR = ".mythgram/backups/btocptd";

/** Manifest file (relative to the workspace root) mapping names to descriptions. */
export const CHECKPOINT_MANIFEST_FILE = ".mythgram/backups/checkpoints.json";

/** Maximum length of a checkpoint name (mirrors the sub-agent/skill caps). */
export const MAX_CHECKPOINT_NAME_CHARS = 70;

/** Maximum length of a checkpoint description (mirrors the sub-agent/skill caps). */
export const MAX_CHECKPOINT_DESC_CHARS = 300;

/**
 * A valid checkpoint name: alphanumeric segments separated by single hyphens or
 * underscores (e.g. "checkpoint298" or "before-refactor"). No spaces, no slashes,
 * no dots — so the name is always a safe, single file stem.
 */
export const CHECKPOINT_NAME_PATTERN = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;

/** Reserved name: the safety-backup directory itself. */
const RESERVED_NAME = "btocptd";

/** Directory names (at any depth) that are never included in a snapshot. */
const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set([
  ".mythgram",
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "dist",
  "build",
  ".build",
  ".next",
  "out",
  "coverage",
  ".nyc_output",
  ".cache",
  ".turbo",
  ".vite",
  ".parcel-cache",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".venv",
  "venv",
  "target",
  ".gradle",
]);

/** File names (at any depth) that are never included in a snapshot. */
const EXCLUDED_FILE_NAMES: ReadonlySet<string> = new Set([".gitignore", ".DS_Store"]);

/** Root-level workspace entries that a restore never deletes. */
const RESTORE_PRESERVED_ROOTS: ReadonlySet<string> = new Set([".mythgram", ".git", ".gitignore"]);

/** Single files larger than this are skipped (reported, never fatal). */
const MAX_SINGLE_FILE_BYTES = 200 * 1024 * 1024;

/** A workspace snapshot larger than this is refused with a clear error. */
const MAX_SNAPSHOT_BYTES = 1024 * 1024 * 1024;

/** Hard caps when reading a zip (zip-bomb defense on restore). */
const MAX_ZIP_ENTRIES = 50_000;
const MAX_ZIP_SINGLE_FILE_BYTES = 500 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 1024 * 1024 * 1024;

/** One entry in the checkpoint manifest. */
export interface CheckpointRecord {
  name: string;
  description: string;
  /** Workspace-relative posix path of the zip, e.g. ".mythgram/backups/fix1.zip". */
  file: string;
  createdAt: number;
  sizeBytes: number;
  fileCount: number;
}

/** Sidecar written next to every automatic safety backup. */
interface SafetySidecar {
  name: string;
  file: string;
  createdAt: number;
  sizeBytes: number;
  fileCount: number;
  reason: string;
}

/**
 * Validate a user/LLM-supplied checkpoint name. Returns the trimmed name, or an
 * explanatory error string when the name is unusable.
 */
export function validateCheckpointName(raw: unknown): { name: string; error?: undefined } | { name: ""; error: string } {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) {
    return { name: "", error: "A checkpoint name is required (e.g. \"checkpoint298\"). Do not include \".zip\"." };
  }
  if (/\.zip$/i.test(name)) {
    return {
      name: "",
      error: `The checkpoint name must not include ".zip" — use "${name.replace(/\.zip$/i, "")}" instead.`,
    };
  }
  if (name.length > MAX_CHECKPOINT_NAME_CHARS) {
    return {
      name: "",
      error: `The checkpoint name must be ${MAX_CHECKPOINT_NAME_CHARS} characters or fewer.`,
    };
  }
  if (name.toLowerCase() === RESERVED_NAME) {
    return { name: "", error: `"${RESERVED_NAME}" is reserved for automatic safety backups. Choose another name.` };
  }
  if (!CHECKPOINT_NAME_PATTERN.test(name)) {
    return {
      name: "",
      error:
        "The checkpoint name must contain only letters, digits, and single hyphens or underscores " +
        "(e.g. \"checkpoint298\" or \"before-refactor\"). No spaces, slashes, dots, or \".zip\".",
    };
  }
  return { name };
}

/** Validate a checkpoint description. Returns the trimmed text or an error string. */
export function validateCheckpointDescription(raw: unknown): { description: string; error?: undefined } | { description: ""; error: string } {
  const description = typeof raw === "string" ? raw.trim() : "";
  if (!description) {
    return { description: "", error: "A short description is required (what this checkpoint contains)." };
  }
  if (description.length > MAX_CHECKPOINT_DESC_CHARS) {
    return {
      description: "",
      error: `The checkpoint description must be ${MAX_CHECKPOINT_DESC_CHARS} characters or fewer.`,
    };
  }
  return { description };
}

/** True when a workspace-relative posix path must be excluded from a snapshot. */
function isExcluded(relPosix: string): boolean {
  for (const segment of relPosix.split("/")) {
    if (!segment) continue;
    if (EXCLUDED_DIR_NAMES.has(segment)) return true;
    if (EXCLUDED_FILE_NAMES.has(segment)) return true;
  }
  return false;
}

/** Throw when the turn was aborted (checked between entries of long walks). */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("The checkpoint operation was aborted.");
    (error as { code?: string }).code = "aborted";
    throw error;
  }
}

// ---------------------------------------------------------------------------
// CRC32 (required by the ZIP format)
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(when = new Date()): { time: number; date: number } {
  const time = ((when.getHours() & 31) << 11) | ((when.getMinutes() & 63) << 5) | (Math.floor(when.getSeconds() / 2) & 31);
  const date = (((when.getFullYear() - 1980) & 127) << 9) | (((when.getMonth() + 1) & 15) << 5) | (when.getDate() & 31);
  return { time, date };
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (store + deflate, UTF-8 names, no spanning, no encryption)
// ---------------------------------------------------------------------------

export interface ZipEntryInput {
  /** Posix relative path inside the zip (`a/b.txt`, or `a/dir/` for directories). */
  name: string;
  isDir: boolean;
  data: Buffer;
}

/** Serialize entries into a complete `.zip` file buffer. */
export function createZipBuffer(entries: ZipEntryInput[]): Buffer {
  const fileChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = entry.isDir ? Buffer.alloc(0) : entry.data;
    const compressed = entry.isDir ? raw : deflateRawSync(raw, { level: 6 });
    const method = entry.isDir ? 0 : 8;
    const crc = entry.isDir ? 0 : crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    fileChunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(63, 4); // made by UNIX
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    // NOTE: `<<` yields a signed int32 in JS, so normalize with `>>> 0` —
    // file mode 0o100644 would otherwise go negative and fail the u32 write.
    const externalAttrs = entry.isDir ? ((0o40755 << 16) | 0x10) >>> 0 : ((0o100644 << 16) >>> 0);
    central.writeUInt32LE(externalAttrs, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...fileChunks, centralDir, end]);
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader (deflate + store, with zip-slip + zip-bomb guards)
// ---------------------------------------------------------------------------

export interface ZipEntryOutput {
  name: string;
  isDir: boolean;
  data: Buffer;
}

/** Parse a `.zip` buffer into its entries. Throws on corrupt or hostile zips. */
export function parseZipBuffer(zip: Buffer): ZipEntryOutput[] {
  if (zip.length < 22) throw new Error("Not a zip file (too small).");

  // Locate the end-of-central-directory record (no comment is written, but scan
  // defensively from the tail so foreign zips still parse).
  let eocd = -1;
  const scanFrom = Math.max(0, zip.length - 66_000);
  for (let i = zip.length - 22; i >= scanFrom; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("Not a zip file (end record not found).");

  const entryCount = zip.readUInt16LE(eocd + 8);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new Error(`Zip has too many entries (${entryCount}). Refusing to extract.`);
  }
  if (centralOffset + centralSize > zip.length) throw new Error("Zip central directory is corrupt.");

  const out: ZipEntryOutput[] = [];
  let totalBytes = 0;
  let pos = centralOffset;

  for (let n = 0; n < entryCount; n += 1) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error("Zip central directory is corrupt.");
    const method = zip.readUInt16LE(pos + 10);
    const crc = zip.readUInt32LE(pos + 16);
    const compSize = zip.readUInt32LE(pos + 20);
    const rawSize = zip.readUInt32LE(pos + 24);
    const nameLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const commentLen = zip.readUInt16LE(pos + 32);
    const localOffset = zip.readUInt32LE(pos + 42);
    const name = zip.toString("utf8", pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;

    if (method !== 0 && method !== 8) {
      throw new Error(`Unsupported zip compression method (${method}) for "${name}".`);
    }
    if (rawSize > MAX_ZIP_SINGLE_FILE_BYTES) {
      throw new Error(`Zip entry "${name}" is too large. Refusing to extract.`);
    }
    totalBytes += rawSize;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new Error("Zip is too large in total. Refusing to extract.");
    }

    const safe = sanitizeZipEntryName(name);
    if (!safe) continue; // skips directory markers handled below via isDir
    const isDir = name.endsWith("/");

    // Locate the entry data through its local header.
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Zip local header is corrupt.");
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > zip.length) throw new Error("Zip entry data is truncated.");
    const stored = zip.subarray(dataStart, dataEnd);

    let data: Buffer;
    if (isDir || rawSize === 0) {
      data = Buffer.alloc(0);
    } else if (method === 0) {
      data = Buffer.from(stored);
    } else {
      try {
        data = Buffer.from(inflateRawSync(stored));
      } catch {
        throw new Error(`Could not decompress zip entry "${name}". The checkpoint may be corrupt.`);
      }
    }
    if (data.length !== rawSize) throw new Error(`Zip entry "${name}" has an unexpected size.`);
    if (!isDir && crc32(data) !== crc) {
      throw new Error(`Zip entry "${name}" failed its integrity check. The checkpoint may be corrupt.`);
    }
    out.push({ name: safe, isDir, data });
  }

  return out;
}

/**
 * Normalize a zip entry name to a safe workspace-relative posix path.
 * Returns null for directory markers (handled via `isDir`) and rejects
 * absolute paths, drive letters, backslashes escapes, and `..` traversal.
 */
function sanitizeZipEntryName(raw: string): string | null {
  let name = raw.replace(/\\/g, "/").trim();
  if (!name || name === "/") return null;
  name = name.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!name) return null;
  if (/^[A-Za-z]:(\/|$)/.test(name)) return null;
  const segments = name.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return null;
  }
  return segments.join("/");
}

// ---------------------------------------------------------------------------
// Workspace collection / extraction
// ---------------------------------------------------------------------------

export interface CollectedSnapshot {
  entries: ZipEntryInput[];
  fileCount: number;
  totalBytes: number;
  skipped: string[];
}

/** Walk the workspace and collect every snapshotted file + directory entry. */
export async function collectWorkspaceSnapshot(
  workspaceRoot: string,
  signal?: AbortSignal,
): Promise<CollectedSnapshot> {
  const entries: ZipEntryInput[] = [];
  const skipped: string[] = [];
  let fileCount = 0;
  let totalBytes = 0;
  let steps = 0;

  const walk = async (dirAbs: string, dirRel: string): Promise<void> => {
    let dirents;
    try {
      dirents = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip it, never fail the whole snapshot
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      steps += 1;
      if (steps % 256 === 0) throwIfAborted(signal);
      const rel = dirRel ? `${dirRel}/${dirent.name}` : dirent.name;
      if (isExcluded(rel)) continue;
      const abs = path.join(dirAbs, dirent.name);
      if (dirent.isSymbolicLink()) {
        skipped.push(`${rel} (symlink skipped)`);
        continue;
      }
      if (dirent.isDirectory()) {
        entries.push({ name: `${rel}/`, isDir: true, data: Buffer.alloc(0) });
        await walk(abs, rel);
      } else if (dirent.isFile()) {
        let stat;
        try {
          stat = await fs.stat(abs);
        } catch {
          skipped.push(`${rel} (unreadable, skipped)`);
          continue;
        }
        if (stat.size > MAX_SINGLE_FILE_BYTES) {
          skipped.push(`${rel} (larger than 200 MB, skipped)`);
          continue;
        }
        totalBytes += stat.size;
        if (totalBytes > MAX_SNAPSHOT_BYTES) {
          throw new Error(
            "The workspace snapshot would exceed 1 GB. Remove build artifacts or large media files and try again.",
          );
        }
        let data: Buffer;
        try {
          data = await fs.readFile(abs);
        } catch {
          skipped.push(`${rel} (unreadable, skipped)`);
          totalBytes -= stat.size;
          continue;
        }
        entries.push({ name: rel, isDir: false, data });
        fileCount += 1;
      }
      // sockets, fifos, devices, ... are skipped silently
    }
  };

  await walk(workspaceRoot, "");
  throwIfAborted(signal);
  return { entries, fileCount, totalBytes, skipped };
}

/** Write a zip buffer atomically (temp file + rename, so a crash never leaves a half zip). */
export async function writeZipAtomic(absPath: string, zip: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmpPath = `${absPath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmpPath, zip);
    await fs.rename(tmpPath, absPath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Extract checkpoint entries into the workspace. Entries targeting excluded
 * top-level locations (`.mythgram`, `.git`, ...) are skipped so a restore can
 * never overwrite agent state or version control. Returns what was restored.
 */
export async function extractSnapshotEntries(
  workspaceRoot: string,
  zipEntries: ZipEntryOutput[],
  signal?: AbortSignal,
): Promise<{ fileCount: number; dirCount: number; totalBytes: number; skipped: string[] }> {
  let fileCount = 0;
  let dirCount = 0;
  let totalBytes = 0;
  const skipped: string[] = [];

  for (const entry of zipEntries) {
    throwIfAborted(signal);
    const top = entry.name.split("/")[0]!;
    if (EXCLUDED_DIR_NAMES.has(top) || EXCLUDED_FILE_NAMES.has(top)) {
      skipped.push(`${entry.name} (protected location, skipped)`);
      continue;
    }
    const abs = path.join(workspaceRoot, ...entry.name.split("/"));
    const rel = path.relative(workspaceRoot, abs);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      skipped.push(`${entry.name} (escapes workspace, skipped)`);
      continue;
    }
    if (entry.isDir) {
      await fs.mkdir(abs, { recursive: true });
      dirCount += 1;
      continue;
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, entry.data);
    fileCount += 1;
    totalBytes += entry.data.length;
  }

  return { fileCount, dirCount, totalBytes, skipped };
}

/**
 * Delete every workspace entry except the preserved roots (`.mythgram`, `.git`,
 * `.gitignore`). Returns the number of deleted top-level entries.
 */
export async function clearWorkspaceForRestore(
  workspaceRoot: string,
  signal?: AbortSignal,
): Promise<number> {
  let dirents;
  try {
    dirents = await fs.readdir(workspaceRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Could not read the workspace: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let deleted = 0;
  for (const dirent of dirents) {
    throwIfAborted(signal);
    if (RESTORE_PRESERVED_ROOTS.has(dirent.name)) continue;
    await fs.rm(path.join(workspaceRoot, dirent.name), { recursive: true, force: true });
    deleted += 1;
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Manifest + safety backups
// ---------------------------------------------------------------------------

/** Read the checkpoint manifest (never throws — a missing/corrupt file is empty). */
export async function readCheckpointManifest(workspaceRoot: string): Promise<CheckpointRecord[]> {
  const abs = path.join(workspaceRoot, ...CHECKPOINT_MANIFEST_FILE.split("/"));
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CheckpointRecord[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (typeof record.name !== "string" || !record.name) continue;
      out.push({
        name: record.name,
        description: typeof record.description === "string" ? record.description : "",
        file: typeof record.file === "string" ? record.file : checkpointZipRel(record.name),
        createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
        sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : 0,
        fileCount: typeof record.fileCount === "number" ? record.fileCount : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Persist the checkpoint manifest atomically. */
export async function writeCheckpointManifest(
  workspaceRoot: string,
  records: CheckpointRecord[],
): Promise<void> {
  const abs = path.join(workspaceRoot, ...CHECKPOINT_MANIFEST_FILE.split("/"));
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmpPath = `${abs}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(records, null, 2), "utf8");
    await fs.rename(tmpPath, abs);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Workspace-relative posix path of a checkpoint zip. */
export function checkpointZipRel(name: string): string {
  return `${CHECKPOINT_BACKUPS_DIR}/${name}.zip`;
}

/** Absolute path of a checkpoint zip. The name is validated upstream, so the join is safe. */
export function checkpointZipAbs(workspaceRoot: string, name: string): string {
  return path.join(workspaceRoot, CHECKPOINT_BACKUPS_DIR, `${name}.zip`);
}

/** Absolute path of the safety-backup directory. */
export function safetyDirAbs(workspaceRoot: string): string {
  return path.join(workspaceRoot, ...CHECKPOINT_SAFETY_DIR.split("/"));
}

const SAFETY_WORDS: readonly string[] = [
  "amber", "ash", "autumn", "azure", "birch", "bold", "brave", "bright", "brook", "cedar",
  "cherry", "clear", "clover", "comet", "coral", "crisp", "dawn", "delta", "eager", "ember",
  "fair", "fern", "field", "flint", "forest", "fresh", "frost", "garnet", "gentle", "glade",
  "grove", "harbor", "hazel", "honey", "indigo", "iron", "ivory", "jade", "juniper", "kind",
  "lark", "laurel", "light", "lively", "lotus", "lucky", "maple", "marble", "meadow", "merry",
  "misty", "moon", "moss", "noble", "north", "oak", "ocean", "olive", "onyx", "opal",
  "patient", "pearl", "pine", "plum", "proud", "quartz", "quick", "quiet", "raven", "river",
  "robin", "rocky", "sage", "sandy", "shady", "silent", "silver", "sleek", "solar", "spring",
  "stone", "storm", "sunny", "swift", "topaz", "umber", "vale", "vivid", "willow", "wise",
  "yonder", "zest",
];

/** Generate a unique 5-word safety-backup name (e.g. "sunny-brave-fox-river-stone"). */
export async function generateSafetyBackupName(workspaceRoot: string): Promise<string> {
  const dir = safetyDirAbs(workspaceRoot);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const words: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      words.push(SAFETY_WORDS[crypto.randomInt(SAFETY_WORDS.length)]!);
    }
    const candidate = attempt === 0 ? words.join("-") : `${words.join("-")}-${attempt + 1}`;
    try {
      await fs.access(path.join(dir, `${candidate}.zip`));
    } catch {
      return candidate; // does not exist yet — usable
    }
  }
  return `safety-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

/** Write the safety-backup sidecar next to its zip. Best-effort, never throws. */
export async function writeSafetySidecar(
  workspaceRoot: string,
  sidecar: SafetySidecar,
): Promise<void> {
  const abs = path.join(safetyDirAbs(workspaceRoot), `${sidecar.name}.meta.json`);
  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, JSON.stringify(sidecar, null, 2), "utf8");
  } catch {
    // best effort — the zip itself is the backup; the sidecar is only metadata
  }
}

/** List automatic safety backups (newest first). Never throws. */
export async function listSafetyBackups(
  workspaceRoot: string,
): Promise<Array<{ name: string; file: string; createdAt: number; sizeBytes: number; fileCount: number }>> {
  const dir = safetyDirAbs(workspaceRoot);
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ name: string; file: string; createdAt: number; sizeBytes: number; fileCount: number }> = [];
  for (const dirent of dirents) {
    if (!dirent.isFile() || !dirent.name.endsWith(".zip")) continue;
    const name = dirent.name.slice(0, -".zip".length);
    const file = `${CHECKPOINT_SAFETY_DIR}/${dirent.name}`;
    let createdAt = 0;
    let sizeBytes = 0;
    let fileCount = 0;
    try {
      const stat = await fs.stat(path.join(dir, dirent.name));
      sizeBytes = stat.size;
      createdAt = Math.floor(stat.mtimeMs);
    } catch {
      continue;
    }
    try {
      const sidecarRaw = await fs.readFile(path.join(dir, `${name}.meta.json`), "utf8");
      const sidecar = JSON.parse(sidecarRaw) as Partial<SafetySidecar>;
      if (typeof sidecar.createdAt === "number") createdAt = sidecar.createdAt;
      if (typeof sidecar.fileCount === "number") fileCount = sidecar.fileCount;
    } catch {
      // no sidecar — stat values stand
    }
    out.push({ name, file, createdAt, sizeBytes, fileCount });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}
