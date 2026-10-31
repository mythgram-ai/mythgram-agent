import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";
import {
  ARCHIVE_FORMATS,
  FORMAT_EXTENSION,
  PASSWORD_FORMATS,
  countFiles,
  executableExists,
  hasArchiveExtension,
  pickExecutable,
  runCommand,
  type ArchiveFormat,
} from "./archiveSupport.js";

const schema = z
  .object({
    archive_name: z
      .string()
      .trim()
      .min(1, "archive_name must be a non-empty string")
      .describe(
        "Name of the output archive file, without the extension. Example: backup_2026",
      ),
    archive_format: z
      .enum(ARCHIVE_FORMATS)
      .describe("Format of the archive to create."),
    output_directory: z
      .string()
      .trim()
      .min(1, "output_directory must be a non-empty string")
      .describe(
        "Absolute directory path where the resulting archive will be saved. Example: /home/user/archives",
      ),
    source_directory: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Absolute path of a directory whose contents should be archived recursively. " +
          "Use this or file_paths, but not both. Example: /home/user/documents",
      ),
    file_paths: z
      .array(z.string().trim().min(1))
      .min(1, "file_paths must contain at least one path")
      .optional()
      .describe(
        "List of absolute paths to files to include in the archive. Use this or " +
          "source_directory, but not both. Example: [\"/home/user/report.pdf\", \"/home/user/notes.txt\"]",
      ),
    password: z
      .string()
      .min(1, "password must be a non-empty string")
      .optional()
      .describe(
        "Optional password for archive encryption, if supported by the selected format.",
      ),
    overwrite: z
      .boolean()
      .default(false)
      .describe(
        "Whether to overwrite an existing archive with the same output path and filename. " +
          "Defaults to false.",
      ),
  })
  .strict();

type ArchiveFilesArgs = z.infer<typeof schema>;

function failure(code: string, message: string, extra: Record<string, unknown> = {}): ToolResult {
  return { ok: false, error: { code, message, ...extra } };
}

/** Default timeout (ms) applied to an archive program when the context has none. */
const DEFAULT_TIMEOUT_MS = 180_000;

/** Resolved description of what will be archived: a base directory plus entries relative to it. */
interface ResolvedSource {
  /** Absolute directory the archive program runs in / anchors relative entry paths to. */
  baseDir: string;
  /** Entry paths relative to `baseDir` (top-level names for a directory source). */
  entries: string[];
  /** Human readable workspace-relative description of the source. */
  label: string;
  /** Number of files that will be included. */
  fileCount: number;
}

/** Validate a model-supplied archive name: a single path segment without an archive extension. */
function validateArchiveName(raw: string): { name: string } | { error: string } {
  const name = raw.trim();
  if (!name) return { error: "archive_name must be a non-empty string." };
  if (name === "." || name === "..") return { error: `"${name}" is not a valid archive name.` };
  if (name.includes("/") || name.includes("\\")) {
    return {
      error:
        `archive_name must be a plain file name without directory separators. ` +
        `Received "${name}". Put the destination folder in output_directory instead.`,
    };
  }
  if (hasArchiveExtension(name)) {
    return {
      error:
        `archive_name must be provided WITHOUT an extension, e.g. "${name.replace(/\.[^.]+$/, "")}" ` +
        `instead of "${name}". The correct extension is added automatically from archive_format.`,
    };
  }
  return { name };
}

/** Resolve and validate the single requested source (directory or file list). */
async function resolveSource(
  args: ArchiveFilesArgs,
  ctx: ToolContext,
): Promise<ResolvedSource | { error: string; code: string }> {
  const hasDir = typeof args.source_directory === "string" && args.source_directory.trim().length > 0;
  const hasFiles = Array.isArray(args.file_paths) && args.file_paths.length > 0;
  if (hasDir && hasFiles) {
    return {
      code: "invalid_source",
      error: "Provide exactly one source: source_directory or file_paths, not both.",
    };
  }
  if (!hasDir && !hasFiles) {
    return {
      code: "invalid_source",
      error: "Provide exactly one source: source_directory or file_paths.",
    };
  }

  if (hasDir) {
    let dirAbs: string;
    try {
      dirAbs = safeResolve(ctx.workspaceRoot, args.source_directory!);
    } catch (error) {
      return { code: "invalid_source_directory", error: error instanceof Error ? error.message : String(error) };
    }
    let stat;
    try {
      stat = await fsp.stat(dirAbs);
    } catch {
      return {
        code: "source_directory_not_found",
        error: `Source directory does not exist: ${toWorkspaceRelative(ctx.workspaceRoot, dirAbs)}.`,
      };
    }
    if (!stat.isDirectory()) {
      return {
        code: "not_a_directory",
        error: `source_directory is not a directory: ${toWorkspaceRelative(ctx.workspaceRoot, dirAbs)}.`,
      };
    }
    let names: string[];
    try {
      names = (await fsp.readdir(dirAbs)).sort((a, b) => a.localeCompare(b));
    } catch (error) {
      return {
        code: "source_directory_unreadable",
        error: `Could not read the source directory: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const fileCount = await countFiles(dirAbs, ctx.signal);
    return {
      baseDir: dirAbs,
      // An empty directory still produces a (valid, empty) archive via ".".
      entries: names.length > 0 ? names : ["."],
      label: toWorkspaceRelative(ctx.workspaceRoot, dirAbs),
      fileCount,
    };
  }

  const seen = new Set<string>();
  const entries: string[] = [];
  for (const raw of args.file_paths!) {
    let abs: string;
    try {
      abs = safeResolve(ctx.workspaceRoot, raw);
    } catch (error) {
      return { code: "invalid_file_path", error: `Invalid file path "${raw}": ${error instanceof Error ? error.message : String(error)}` };
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    let stat;
    try {
      stat = await fsp.stat(abs);
    } catch {
      return { code: "file_not_found", error: `File does not exist: ${toWorkspaceRelative(ctx.workspaceRoot, abs)}.` };
    }
    if (!stat.isFile()) {
      return { code: "not_a_file", error: `file_paths entries must be regular files: ${toWorkspaceRelative(ctx.workspaceRoot, abs)}.` };
    }
    entries.push(path.relative(ctx.workspaceRoot, abs));
  }
  return {
    baseDir: ctx.workspaceRoot,
    entries,
    label: `${entries.length} file(s)`,
    fileCount: entries.length,
  };
}

/** Build the command vector for the chosen format, or an error when the required program is absent. */
function buildCommand(
  format: ArchiveFormat,
  targetAbs: string,
  source: ResolvedSource,
  password: string | undefined,
): { bin: string; args: string[]; cwd: string } | { error: string } {
  // Exclude the output archive itself from its own input when it lives inside the source tree.
  const excludeRel = (() => {
    const rel = path.relative(source.baseDir, targetAbs);
    if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
    return rel;
  })();

  if (format === "zip") {
    if (executableExists("zip")) {
      const args = ["-r", "-q"];
      if (password) args.push("-P", password);
      args.push(targetAbs, ...source.entries);
      if (excludeRel) args.push("-x", excludeRel);
      return { bin: "zip", args, cwd: source.baseDir };
    }
    const sevenZip = pickExecutable(["7z", "7za", "7zr"]);
    if (!sevenZip) {
      return { error: "Creating .zip archives requires the 'zip' or '7z' program, but neither is installed." };
    }
    const args = ["a", "-tzip", "-y"];
    if (password) args.push(`-p${password}`, "-mhe=on");
    if (excludeRel) args.push(`-xr!${excludeRel}`);
    args.push(targetAbs, ...source.entries);
    return { bin: sevenZip, args, cwd: source.baseDir };
  }

  if (format === "7z") {
    const sevenZip = pickExecutable(["7z", "7za", "7zr"]);
    if (!sevenZip) {
      return { error: "Creating .7z archives requires the '7z' program, but it is not installed." };
    }
    const args = ["a", "-y"];
    if (password) args.push(`-p${password}`, "-mhe=on");
    if (excludeRel) args.push(`-xr!${excludeRel}`);
    args.push(targetAbs, ...source.entries);
    return { bin: sevenZip, args, cwd: source.baseDir };
  }

  // tar and its compressed variants all use the system tar.
  if (!executableExists("tar")) {
    return { error: `Creating ${format} archives requires the 'tar' program, but it is not installed.` };
  }
  if (format === "tar.lz4" && !executableExists("lz4")) {
    return { error: "Creating tar.lz4 archives requires the 'lz4' program, but it is not installed." };
  }
  if (format === "tar.zst" && !executableExists("zstd")) {
    return { error: "Creating tar.zst archives requires the 'zstd' program, but it is not installed." };
  }
  const args = ["-c"];
  if (format === "tar.gz") args.push("-z");
  else if (format === "tar.bz2") args.push("-j");
  else if (format === "tar.xz") args.push("-J");
  else if (format === "tar.lz4") args.push("-I", "lz4");
  else if (format === "tar.zst") args.push("-I", "zstd");
  args.push("-f", targetAbs);
  if (excludeRel) args.push(`--exclude=${excludeRel}`);
  args.push("-C", source.baseDir, ...source.entries);
  return { bin: "tar", args, cwd: source.baseDir };
}

export const archiveFilesTool = defineTool({
  name: "archive_files",
  description:
    "Create an archive from a directory or a list of absolute file paths. Select the archive name " +
    "and format, specify the output directory, and optionally set a password if supported. Provide " +
    "exactly one source: source_directory or file_paths.",
  schema,
  label: (args: ArchiveFilesArgs) =>
    `Archive: ${args.archive_name}${FORMAT_EXTENSION[args.archive_format] ?? ""}`,
  async execute(args: ArchiveFilesArgs, ctx: ToolContext): Promise<ToolResult> {
    const nameCheck = validateArchiveName(args.archive_name);
    if ("error" in nameCheck) {
      return failure("invalid_archive_name", nameCheck.error, { archive_name: args.archive_name });
    }
    const { name } = nameCheck;

    if (args.password !== undefined && !PASSWORD_FORMATS.has(args.archive_format)) {
      return failure(
        "password_not_supported",
        `The "${args.archive_format}" format does not support password encryption. ` +
          `Use "zip" or "7z" for an encrypted archive, or omit the password.`,
        { archive_format: args.archive_format },
      );
    }

    let outAbs: string;
    try {
      outAbs = safeResolve(ctx.workspaceRoot, args.output_directory);
    } catch (error) {
      return failure(
        "invalid_output_directory",
        `Invalid output directory "${args.output_directory}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      await fsp.mkdir(outAbs, { recursive: true });
      const stat = await fsp.stat(outAbs);
      if (!stat.isDirectory()) {
        return failure("invalid_output_directory", `The output path "${args.output_directory}" is not a directory.`);
      }
    } catch (error) {
      return failure(
        "invalid_output_directory",
        `Could not use the output directory "${args.output_directory}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const sourceResult = await resolveSource(args, ctx);
    if ("error" in sourceResult) {
      return failure(sourceResult.code, sourceResult.error, { archive_name: name });
    }
    const source = sourceResult;

    const extension = FORMAT_EXTENSION[args.archive_format];
    const targetAbs = path.join(outAbs, `${name}${extension}`);
    const targetRel = toWorkspaceRelative(ctx.workspaceRoot, targetAbs);

    let existed = false;
    try {
      await fsp.access(targetAbs);
      existed = true;
    } catch {
      existed = false;
    }
    if (existed && !args.overwrite) {
      return failure(
        "archive_exists",
        `An archive already exists at "${targetRel}". Set overwrite to true to replace it.`,
        { archive_path: targetRel },
      );
    }

    const command = buildCommand(args.archive_format, targetAbs, source, args.password);
    if ("error" in command) {
      return failure("tool_not_installed", command.error, { archive_format: args.archive_format });
    }

    const timeoutMs =
      Number.isFinite(ctx.shellTimeoutMs) && ctx.shellTimeoutMs > 0 ? ctx.shellTimeoutMs : DEFAULT_TIMEOUT_MS;

    // Overwrite means replace, not merge: remove any existing archive so no stale entries survive.
    if (existed) {
      await fsp.rm(targetAbs, { force: true }).catch(() => undefined);
    }

    const result = await runCommand(command.bin, command.args, {
      cwd: command.cwd,
      timeoutMs,
      signal: ctx.signal,
    });

    const cleanup = async (): Promise<void> => {
      await fsp.rm(targetAbs, { force: true }).catch(() => undefined);
    };

    if (ctx.signal?.aborted) {
      await cleanup();
      return failure("aborted", "The archive operation was aborted before it finished.", { archive_path: targetRel });
    }
    if (result.timedOut) {
      await cleanup();
      return failure("timeout", "The archive operation timed out before it finished.", { archive_path: targetRel });
    }
    if (result.spawnError) {
      await cleanup();
      return failure("tool_not_installed", `Could not run "${command.bin}": ${result.spawnError}`, {
        archive_format: args.archive_format,
      });
    }
    if (result.code !== 0) {
      await cleanup();
      const detail = result.stderr.trim();
      return failure(
        "archive_create_failed",
        `Failed to create the archive: ${detail || `${command.bin} exited with code ${result.code}`}`,
        { archive_path: targetRel, archive_format: args.archive_format, exit_code: result.code },
      );
    }

    let sizeBytes = 0;
    try {
      const stat = await fsp.stat(targetAbs);
      sizeBytes = stat.size;
    } catch {
      await cleanup();
      return failure("archive_create_failed", `The archive program reported success but no file was written at "${targetRel}".`);
    }

    return {
      ok: true,
      data: {
        archive_path: targetRel,
        archive_name: name,
        archive_format: args.archive_format,
        output_directory: toWorkspaceRelative(ctx.workspaceRoot, outAbs),
        source: source.label,
        file_count: source.fileCount,
        size_bytes: sizeBytes,
        encrypted: args.password !== undefined,
        overwritten: existed,
        message:
          `Created ${args.archive_format} archive "${targetRel}" from ${source.label} ` +
          `(${source.fileCount} file(s), ${sizeBytes} bytes)` +
          `${args.password !== undefined ? " with password encryption" : ""}.`,
      },
    };
  },
});
