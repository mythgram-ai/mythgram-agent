import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * Shared infrastructure for the archive_files / extract_archive tools.
 *
 * Archiving supports a broad set of formats (zip, the tar family, 7z) and optional password
 * encryption. Rather than pulling in a heavyweight native dependency, the tools drive the archive
 * programs that ship with virtually every Unix-like system (zip/unzip, tar, 7z, and the lz4/zstd
 * compressors when a format needs them). Every external program is invoked WITHOUT a shell — the
 * argument vector is passed straight to `spawn`, so model-supplied paths can never be interpreted as
 * shell syntax. When a program a format needs is missing, the tools return a clear, actionable error
 * instead of a cryptic failure.
 */

/** Every archive format the archive_files tool can create. */
export const ARCHIVE_FORMATS = [
  "zip",
  "tar",
  "tar.gz",
  "tar.bz2",
  "tar.xz",
  "tar.lz4",
  "tar.zst",
  "7z",
] as const;

export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

/** File extension appended for each creatable archive format. */
export const FORMAT_EXTENSION: Record<ArchiveFormat, string> = {
  zip: ".zip",
  tar: ".tar",
  "tar.gz": ".tar.gz",
  "tar.bz2": ".tar.bz2",
  "tar.xz": ".tar.xz",
  "tar.lz4": ".tar.lz4",
  "tar.zst": ".tar.zst",
  "7z": ".7z",
};

/** Formats whose archive program can encrypt with a password. */
export const PASSWORD_FORMATS: ReadonlySet<ArchiveFormat> = new Set<ArchiveFormat>(["zip", "7z"]);

/**
 * Known archive extensions, longest first, used to reject a name that already carries an extension
 * and to derive an extraction directory name from an archive path.
 */
const KNOWN_ARCHIVE_EXTENSIONS: readonly string[] = [
  ".tar.gz",
  ".tar.bz2",
  ".tar.xz",
  ".tar.lz4",
  ".tar.zst",
  ".tgz",
  ".tbz2",
  ".tbz",
  ".txz",
  ".tzst",
  ".zip",
  ".tar",
  ".7z",
  ".rar",
  ".gz",
  ".bz2",
  ".xz",
  ".zst",
  ".lz4",
];

/** True when `name` already ends with a recognised archive extension. */
export function hasArchiveExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return KNOWN_ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Strip a trailing archive extension (e.g. "backup.tar.gz" -> "backup"), or return the name. */
export function stripArchiveExtension(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of KNOWN_ARCHIVE_EXTENSIONS) {
    if (lower.endsWith(ext)) return name.slice(0, name.length - ext.length);
  }
  return name;
}

/** Result of running an external archive program. */
export interface RunResult {
  /** Process exit code, or null when the process could not be spawned. */
  code: number | null;
  /** Signal that terminated the process, if any. */
  signal: NodeJS.Signals | null;
  /** Raw stdout bytes (bounded). Empty when stdout was streamed via `stdoutFd`. */
  stdout: Buffer;
  /** Decoded, bounded stderr text. */
  stderr: string;
  /** Set when the process could not be spawned at all (e.g. ENOENT — program not installed). */
  spawnError?: string;
  /** True when the process was killed because it exceeded the timeout or the turn was aborted. */
  timedOut: boolean;
}

/** Maximum bytes of combined program output retained (defence against a runaway program). */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Run an external program without a shell, capturing bounded stdout/stderr. Resolves for both
 * success and failure; only a synchronous spawn failure or a `spawn` error event populates
 * `spawnError`. The process is killed on timeout or when the turn is aborted.
 *
 * `stdout` is normally buffered and capped at MAX_OUTPUT_BYTES because it is a short tool message.
 * When a caller needs the *data* the program produces (e.g. the decompressed output of a single
 * .bz2/.xz/.zst/.lz4 file), it must pass `stdoutFd` so stdout is written straight to that open file
 * descriptor instead of being buffered — otherwise output larger than the cap is silently dropped.
 */
export function runCommand(
  bin: string,
  args: string[],
  opts: {
    cwd?: string;
    timeoutMs: number;
    signal?: AbortSignal;
    /**
     * Open file descriptor that receives the program's stdout directly. When set, `RunResult.stdout`
     * stays empty and the caller owns the descriptor (open before the call, close after it resolves).
     */
    stdoutFd?: number;
  },
): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, {
        cwd: opts.cwd,
        stdio: ["ignore", opts.stdoutFd ?? "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        code: null,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: "",
        spawnError: error instanceof Error ? error.message : String(error),
        timedOut: false,
      });
      return;
    }

    const outChunks: Buffer[] = [];
    let outLen = 0;
    let err = "";
    let settled = false;
    let timedOut = false;

    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code, signal, stdout: Buffer.concat(outChunks), stderr: err, spawnError, timedOut });
    };

    const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 180_000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = (): void => {
      child.kill("SIGKILL");
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (outLen >= MAX_OUTPUT_BYTES) return;
      const room = MAX_OUTPUT_BYTES - outLen;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      outChunks.push(slice);
      outLen += slice.length;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (err.length >= MAX_OUTPUT_BYTES) return;
      err += chunk.toString("utf8");
    });
    child.on("error", (error) => finish(null, null, error.message));
    child.on("close", (code, signal) => finish(code, signal));
  });
}

/** Cache of executable lookups so PATH is not re-scanned on every call within a process. */
const execCache = new Map<string, boolean>();

/** True when an executable named `name` is found on PATH (cached). */
export function executableExists(name: string): boolean {
  const cached = execCache.get(name);
  if (cached !== undefined) return cached;
  let found = false;
  const pathEnv = process.env.PATH ?? "";
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      try {
        if (fs.existsSync(path.join(dir, name + extension))) {
          found = true;
          break;
        }
      } catch {
        // unreadable PATH entry — ignore
      }
    }
    if (found) break;
  }
  execCache.set(name, found);
  return found;
}

/** Return the first program name that exists on PATH, or null when none do. */
export function pickExecutable(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (executableExists(candidate)) return candidate;
  }
  return null;
}

/** Recursively count regular files under `rootAbs` (never throws; symlinks are skipped). */
export async function countFiles(rootAbs: string, signal?: AbortSignal): Promise<number> {
  let count = 0;
  const walk = async (dirAbs: string): Promise<void> => {
    if (signal?.aborted) return;
    let dirents;
    try {
      dirents = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (signal?.aborted) return;
      if (dirent.isSymbolicLink()) continue;
      const abs = path.join(dirAbs, dirent.name);
      if (dirent.isDirectory()) {
        await walk(abs);
      } else if (dirent.isFile()) {
        count += 1;
      }
    }
  };
  await walk(rootAbs);
  return count;
}

/** Recursively total the number of regular files and their combined byte size under `rootAbs`. */
export async function summarizeDirectory(
  rootAbs: string,
  signal?: AbortSignal,
): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const walk = async (dirAbs: string): Promise<void> => {
    if (signal?.aborted) return;
    let dirents;
    try {
      dirents = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (signal?.aborted) return;
      if (dirent.isSymbolicLink()) continue;
      const abs = path.join(dirAbs, dirent.name);
      if (dirent.isDirectory()) {
        await walk(abs);
      } else if (dirent.isFile()) {
        try {
          const stat = await fsp.stat(abs);
          files += 1;
          bytes += stat.size;
        } catch {
          // unreadable file — skip
        }
      }
    }
  };
  await walk(rootAbs);
  return { files, bytes };
}

/**
 * Reject (return the offending entry) any archive member whose name is absolute or escapes the
 * extraction root via `..`. Returns null when every entry is safe. Guards against zip-slip on
 * archives produced anywhere, not just by our own tool.
 */
export function findUnsafeEntry(names: readonly string[]): string | null {
  for (const raw of names) {
    const name = raw.replace(/\\/g, "/").trim();
    if (!name) continue;
    if (name.startsWith("/")) return raw;
    if (/^[A-Za-z]:\//.test(name)) return raw;
    for (const segment of name.split("/")) {
      if (segment === "..") return raw;
    }
  }
  return null;
}

/**
 * List the member names of an archive using the best available program, or null when the listing
 * could not be produced (in which case the caller simply skips the pre-extraction safety scan).
 */
export async function listArchiveEntries(
  kind: "zip" | "7z" | "rar" | "tar",
  archiveAbs: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string[] | null> {
  if (kind === "tar") {
    if (!executableExists("tar")) return null;
    const result = await runCommand("tar", ["-tf", archiveAbs], { timeoutMs, signal });
    if (result.code !== 0) return null;
    return result.stdout
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  // Prefer the native lister for each kind; 7z is the universal fallback.
  if (kind === "zip" && executableExists("unzip")) {
    const result = await runCommand("unzip", ["-Z1", archiveAbs], { timeoutMs, signal });
    if (result.code === 0) {
      return result.stdout
        .toString("utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }
  }

  const sevenZip = pickExecutable(["7z", "7za", "7zr"]);
  if (!sevenZip) return null;
  const result = await runCommand(sevenZip, ["l", "-slt", archiveAbs], { timeoutMs, signal });
  if (result.code !== 0 && result.code !== 1) return null;
  const names: string[] = [];
  for (const line of result.stdout.toString("utf8").split("\n")) {
    const match = /^Path = (.*)$/.exec(line.trim());
    if (match?.[1]) names.push(match[1]);
  }
  // The archive's own path is the first Path entry; drop it.
  return names.slice(1);
}
