import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";
import {
  executableExists,
  findUnsafeEntry,
  listArchiveEntries,
  pickExecutable,
  runCommand,
  stripArchiveExtension,
  summarizeDirectory,
} from "./archiveSupport.js";

const schema = z
  .object({
    archive_path: z
      .string()
      .trim()
      .min(1, "archive_path must be a non-empty string")
      .describe(
        "Absolute filesystem path to the archive file. Example: /home/user/downloads/archive.zip",
      ),
    password: z
      .string()
      .nullable()
      .describe(
        "Password for an encrypted archive. Use null if the archive is not password-protected.",
      ),
  })
  .strict();

type ExtractArchiveArgs = z.infer<typeof schema>;

function failure(code: string, message: string, extra: Record<string, unknown> = {}): ToolResult {
  return { ok: false, error: { code, message, ...extra } };
}

/** Map an aborted/timed-out program run into a structured failure, or null when it completed. */
function interruption(ctx: ToolContext, timedOut: boolean, archiveRel: string): ToolResult | null {
  if (ctx.signal?.aborted) {
    return failure("aborted", "The extraction was aborted before it finished.", { archive_path: archiveRel });
  }
  if (timedOut) {
    return failure("timeout", "The extraction timed out before it finished.", { archive_path: archiveRel });
  }
  return null;
}

/** Default timeout (ms) applied to an extractor program when the context has none. */
const DEFAULT_TIMEOUT_MS = 180_000;

/** Kind of archive detected from the file name. */
type ArchiveKind =
  | { kind: "zip" }
  | { kind: "7z" }
  | { kind: "rar" }
  | { kind: "tar"; compression: "none" | "gz" | "bz2" | "xz" | "lz4" | "zst" }
  | { kind: "single"; compression: "gz" | "bz2" | "xz" | "zst" | "lz4" };

/** Detect the archive kind + compression from the (lowercased) file name. */
function detectKind(fileName: string): ArchiveKind | null {
  const lower = fileName.toLowerCase();
  const has = (suffix: string): boolean => lower.endsWith(suffix);
  if (has(".tar.gz") || has(".tgz")) return { kind: "tar", compression: "gz" };
  if (has(".tar.bz2") || has(".tbz2") || has(".tbz")) return { kind: "tar", compression: "bz2" };
  if (has(".tar.xz") || has(".txz")) return { kind: "tar", compression: "xz" };
  if (has(".tar.lz4")) return { kind: "tar", compression: "lz4" };
  if (has(".tar.zst") || has(".tzst")) return { kind: "tar", compression: "zst" };
  if (has(".tar")) return { kind: "tar", compression: "none" };
  if (has(".zip")) return { kind: "zip" };
  if (has(".7z")) return { kind: "7z" };
  if (has(".rar")) return { kind: "rar" };
  if (has(".gz")) return { kind: "single", compression: "gz" };
  if (has(".bz2")) return { kind: "single", compression: "bz2" };
  if (has(".xz")) return { kind: "single", compression: "xz" };
  if (has(".zst")) return { kind: "single", compression: "zst" };
  if (has(".lz4")) return { kind: "single", compression: "lz4" };
  return null;
}

/** Map a failed encrypted-extraction into a precise password error, else null. */
function passwordError(text: string, code: number | null, provided: boolean): ToolResult | null {
  const lower = text.toLowerCase();
  const looksLikePasswordIssue =
    lower.includes("password") ||
    lower.includes("encrypted") ||
    lower.includes("wrong password") ||
    code === 5 ||
    code === 82 ||
    lower.includes("unable to get password");
  if (!looksLikePasswordIssue) return null;
  if (provided) {
    return failure(
      "incorrect_password",
      "The archive is password-protected and the supplied password is incorrect.",
    );
  }
  return failure(
    "password_required",
    "The archive is password-protected. Provide the password to extract it.",
  );
}

export const extractArchiveTool = defineTool({
  name: "extract_archive",
  description:
    "Extract files from an archive file. Provide the absolute path to the archive file and an " +
    "optional password if it is encrypted. Files are extracted into a new folder named after the " +
    "archive (without its extension) in the same directory as the archive; the path of that folder " +
    "is returned. Supports any archive of a supported format, not only those created by archive_files.",
  schema,
  label: (args: ExtractArchiveArgs) => `Extract: ${args.archive_path}`,
  async execute(args: ExtractArchiveArgs, ctx: ToolContext): Promise<ToolResult> {
    let archiveAbs: string;
    try {
      archiveAbs = safeResolve(ctx.workspaceRoot, args.archive_path);
    } catch (error) {
      return failure(
        "invalid_archive_path",
        `Invalid archive path "${args.archive_path}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let stat;
    try {
      stat = await fsp.stat(archiveAbs);
    } catch {
      return failure(
        "archive_not_found",
        `Archive file does not exist: ${toWorkspaceRelative(ctx.workspaceRoot, archiveAbs)}.`,
        { archive_path: toWorkspaceRelative(ctx.workspaceRoot, archiveAbs) },
      );
    }
    if (!stat.isFile()) {
      return failure("not_a_file", `archive_path is not a regular file: ${toWorkspaceRelative(ctx.workspaceRoot, archiveAbs)}.`);
    }

    const fileName = path.basename(archiveAbs);
    const detected = detectKind(fileName);
    if (!detected) {
      return failure(
        "unsupported_archive_format",
        `Unsupported archive format for "${fileName}". Supported: .zip, .7z, .rar, .tar, ` +
          `.tar.gz/.tgz, .tar.bz2/.tbz2, .tar.xz/.txz, .tar.lz4, .tar.zst, and single-file ` +
          `.gz/.bz2/.xz/.zst/.lz4.`,
      );
    }

    const password =
      typeof args.password === "string" && args.password.length > 0 ? args.password : undefined;

    const stem = stripArchiveExtension(fileName) || "extracted";
    const timeoutMs =
      Number.isFinite(ctx.shellTimeoutMs) && ctx.shellTimeoutMs > 0 ? ctx.shellTimeoutMs : DEFAULT_TIMEOUT_MS;
    const archiveRel = toWorkspaceRelative(ctx.workspaceRoot, archiveAbs);

    // A single compressed file (.gz/.bz2/.xz/.zst/.lz4) decompresses beside the archive; there is no
    // enclosing folder to create.
    if (detected.kind === "single") {
      return extractSingle(detected.compression, archiveAbs, stem, timeoutMs, ctx);
    }

    // Destination: a folder named after the archive stem, next to the archive.
    const destAbs = path.join(path.dirname(archiveAbs), stem);
    const destRel = toWorkspaceRelative(ctx.workspaceRoot, destAbs);

    try {
      const destStat = await fsp.stat(destAbs).catch(() => null);
      if (destStat && !destStat.isDirectory()) {
        return failure("invalid_output_directory", `The extraction target "${destRel}" exists and is not a directory.`);
      }
      await fsp.mkdir(destAbs, { recursive: true });
    } catch (error) {
      return failure(
        "invalid_output_directory",
        `Could not create the extraction directory "${destRel}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const success = async (): Promise<ToolResult> => {
      const summary = await summarizeDirectory(destAbs, ctx.signal);
      return {
        ok: true,
        data: {
          archive_path: archiveRel,
          output_directory: destRel,
          file_count: summary.files,
          total_bytes: summary.bytes,
          password_used: password !== undefined,
          message:
            `Extracted "${archiveRel}" into "${destRel}" ` +
            `(${summary.files} file(s), ${summary.bytes} bytes).`,
        },
      };
    };

    // Pre-flight zip-slip guard: reject archives whose members would escape the extraction folder.
    const listingKind = detected.kind;
    const names = await listArchiveEntries(listingKind, archiveAbs, timeoutMs, ctx.signal);
    if (names) {
      const unsafe = findUnsafeEntry(names);
      if (unsafe) {
        return failure(
          "unsafe_archive_entry",
          `Refusing to extract: the archive contains an entry that escapes the extraction folder ("${unsafe}").`,
          { archive_path: archiveRel, entry: unsafe },
        );
      }
    }

    if (detected.kind === "tar") {
      if (!executableExists("tar")) {
        return failure("tool_not_installed", "Extracting tar archives requires the 'tar' program, but it is not installed.");
      }
      const args = ["-x", "-f", archiveAbs];
      if (detected.compression === "gz") args.push("-z");
      else if (detected.compression === "bz2") args.push("-j");
      else if (detected.compression === "xz") args.push("-J");
      else if (detected.compression === "lz4") args.push("-I", "lz4");
      else if (detected.compression === "zst") args.push("-I", "zstd");
      args.push("-C", destAbs);
      const result = await runCommand("tar", args, { timeoutMs, signal: ctx.signal });
      const interrupted = interruption(ctx, result.timedOut, archiveRel);
      if (interrupted) return interrupted;
      if (result.spawnError) {
        return failure("tool_not_installed", `Could not run "tar": ${result.spawnError}`);
      }
      if (result.code !== 0) {
        const detail = result.stderr.trim();
        if (detected.compression === "lz4" || detected.compression === "zst") {
          const prog = detected.compression;
          if (!executableExists(prog)) {
            return failure("tool_not_installed", `Extracting .tar.${prog} archives requires the '${prog}' program, but it is not installed.`);
          }
        }
        return failure("extraction_failed", `Failed to extract the archive: ${detail || `tar exited with code ${result.code}`}.`);
      }
      return success();
    }

    if (detected.kind === "zip") {
      if (executableExists("unzip")) {
        const args = ["-o", archiveAbs, "-d", destAbs];
        if (password !== undefined) args.splice(1, 0, "-P", password);
        const result = await runCommand("unzip", args, { timeoutMs, signal: ctx.signal });
        const interrupted = interruption(ctx, result.timedOut, archiveRel);
        if (interrupted) return interrupted;
        if (result.spawnError) {
          return failure("tool_not_installed", `Could not run "unzip": ${result.spawnError}`);
        }
        if (result.code !== 0) {
          const pwError = passwordError(result.stderr + result.stdout.toString("utf8"), result.code, password !== undefined);
          if (pwError) return pwError;
          return failure("extraction_failed", `Failed to extract the archive: ${result.stderr.trim() || `unzip exited with code ${result.code}`}.`);
        }
        return success();
      }
      const sevenZip = pickExecutable(["7z", "7za", "7zr"]);
      if (!sevenZip) {
        return failure("tool_not_installed", "Extracting .zip archives requires the 'unzip' or '7z' program, but neither is installed.");
      }
      return extractWith7z(sevenZip, archiveAbs, destAbs, password, timeoutMs, ctx, archiveRel, success);
    }

    // 7z and rar both go through the 7-Zip program.
    const sevenZip = pickExecutable(["7z", "7za", "7zr"]);
    if (!sevenZip) {
      const formatLabel = detected.kind === "rar" ? ".rar" : ".7z";
      return failure("tool_not_installed", `Extracting ${formatLabel} archives requires the '7z' program, but it is not installed.`);
    }
    return extractWith7z(sevenZip, archiveAbs, destAbs, password, timeoutMs, ctx, archiveRel, success);
  },
});

/** Extract a .7z/.rar archive with the 7-Zip program, mapping password failures to clear errors. */
async function extractWith7z(
  sevenZip: string,
  archiveAbs: string,
  destAbs: string,
  password: string | undefined,
  timeoutMs: number,
  ctx: ToolContext,
  archiveRel: string,
  success: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const args = ["x", "-y", `-o${destAbs}`];
  if (password !== undefined) args.push(`-p${password}`);
  args.push(archiveAbs);
  const result = await runCommand(sevenZip, args, { timeoutMs, signal: ctx.signal });
  const interrupted = interruption(ctx, result.timedOut, archiveRel);
  if (interrupted) return interrupted;
  if (result.spawnError) {
    return failure("tool_not_installed", `Could not run "${sevenZip}": ${result.spawnError}`);
  }
  if (result.code !== 0) {
    const pwError = passwordError(result.stderr + result.stdout.toString("utf8"), result.code, password !== undefined);
    if (pwError) return pwError;
    return failure("extraction_failed", `Failed to extract the archive: ${result.stderr.trim() || `${sevenZip} exited with code ${result.code}`}.`);
  }
  return success();
}

/**
 * Decompress a single compressed file (.gz/.bz2/.xz/.zst/.lz4). gzip is handled with Node's built-in
 * zlib; the other compressors use their system programs. The output is written next to the archive
 * as `<stem>` (the archive name with its compression extension removed).
 */
async function extractSingle(
  compression: "gz" | "bz2" | "xz" | "zst" | "lz4",
  archiveAbs: string,
  stem: string,
  timeoutMs: number,
  ctx: ToolContext,
): Promise<ToolResult> {
  const archiveRel = toWorkspaceRelative(ctx.workspaceRoot, archiveAbs);
  const outDirAbs = path.dirname(archiveAbs);
  const outAbs = path.join(outDirAbs, stem);
  const outRel = toWorkspaceRelative(ctx.workspaceRoot, outAbs);

  const done = async (): Promise<ToolResult> => {
    let bytes = 0;
    try {
      bytes = (await fsp.stat(outAbs)).size;
    } catch {
      bytes = 0;
    }
    return {
      ok: true,
      data: {
        archive_path: archiveRel,
        output_directory: toWorkspaceRelative(ctx.workspaceRoot, outDirAbs),
        file_path: outRel,
        file_count: 1,
        total_bytes: bytes,
        password_used: false,
        message: `Extracted "${archiveRel}" into "${outRel}" (${bytes} bytes).`,
      },
    };
  };

  if (compression === "gz") {
    try {
      await pipeline(fs.createReadStream(archiveAbs), createGunzip(), fs.createWriteStream(outAbs));
      return done();
    } catch (error) {
      return failure("extraction_failed", `Failed to decompress the file: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }

  const program = compression === "bz2" ? "bzip2" : compression === "xz" ? "xz" : compression === "zst" ? "zstd" : "lz4";
  if (!executableExists(program)) {
    return failure("tool_not_installed", `Decompressing .${compression} files requires the '${program}' program, but it is not installed.`);
  }
  const result = await runCommand(program, ["-dc", archiveAbs], { timeoutMs, signal: ctx.signal });
  const interrupted = interruption(ctx, result.timedOut, archiveRel);
  if (interrupted) return interrupted;
  if (result.spawnError) {
    return failure("tool_not_installed", `Could not run "${program}": ${result.spawnError}`);
  }
  if (result.code !== 0) {
    return failure("extraction_failed", `Failed to decompress the file: ${result.stderr.trim() || `${program} exited with code ${result.code}`}.`);
  }
  try {
    await fsp.writeFile(outAbs, result.stdout);
    return done();
  } catch (error) {
    return failure("extraction_failed", `Could not write the decompressed file: ${error instanceof Error ? error.message : String(error)}.`);
  }
}
