import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

/**
 * Fallback context-window size (tokens) assumed when the serving model's limit is unknown. Kept
 * conservative so an oversized directory is reported rather than silently flooding the context.
 */
export const DEFAULT_CONTEXT_TOKEN_LIMIT = 128_000;

/**
 * Rough characters-per-token ratio for English/code. Exact tokenization is provider-specific, so a
 * conservative estimate is used only to decide whether the combined content fits the budget.
 */
export const READ_DIRECTORY_CHARS_PER_TOKEN = 4;

/**
 * Fraction of the context window the tool is willing to fill with a single directory read. Half the
 * window leaves room for the conversation, the tool result framing, and the model's response.
 */
export const READ_DIRECTORY_CONTEXT_FRACTION = 0.5;

/**
 * Directories never traversed (VCS data, dependencies, build artifacts, agent state, caches).
 * Mirrors the grep/glob exclusions so read_directory never spelunks generated output.
 */
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

/**
 * File extensions treated as binary/non-text and skipped. Byte-level NUL detection (below) is the
 * final backstop; this list avoids reading obviously-binary files in the first place.
 */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".heic",
  ".heif",
  ".tiff",
  ".tif",
  ".svgz",
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".flac",
  ".aac",
  ".m4a",
  ".mp4",
  ".m4v",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".zip",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".tar",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".o",
  ".a",
  ".class",
  ".jar",
  ".pyc",
  ".pyo",
  ".sqlite",
  ".sqlite3",
  ".db",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
]);

/** Lenient boolean accepted by the schema (models sometimes emit "true"/"false" strings). */
const readOnlyFilesSchema = z
  .preprocess(
    (value) => (value === "true" ? true : value === "false" ? false : value),
    z.boolean(),
  )
  .optional()
  .describe(
    "If true, read only the files directly inside the given directory and ignore subdirectories. " +
      "If false or omitted, recursively read files in all subdirectories. Default: false",
  );

const schema = z
  .object({
    directory_path: z
      .string()
      .trim()
      .min(1, "directory_path must be a non-empty string")
      .describe("Absolute or relative path of the directory to read."),
    read_only_files: readOnlyFilesSchema,
  })
  .strict();

type ReadDirectoryArgs = z.infer<typeof schema>;

interface DiscoveredFile {
  /** Absolute path on disk. */
  absolute: string;
  /** Workspace-relative display path. */
  relative: string;
  /** File size in bytes. */
  size: number;
}

interface ReadFileEntry {
  path: string;
  content: string;
  bytes: number;
}

/** True when any path segment is an excluded directory name. */
function isExcludedRel(relPosix: string): boolean {
  for (const segment of relPosix.split("/")) {
    if (!segment) continue;
    if (EXCLUDED_DIR_NAMES.has(segment)) return true;
  }
  return false;
}

/** True when the file extension is a known binary format. */
function hasBinaryExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return ext.length > 0 && BINARY_EXTENSIONS.has(ext);
}

/**
 * Walk the directory tree (or just one level when `onlyFiles` is true), collecting every candidate
 * text file with its size. Directory entries are skipped in `onlyFiles` mode; symlinks, excluded
 * directories, and obvious binary files are always skipped. Honours the tool's abort signal.
 */
async function discoverFiles(
  rootAbs: string,
  workspaceRoot: string,
  onlyFiles: boolean,
  signal?: AbortSignal,
): Promise<DiscoveredFile[]> {
  const found: DiscoveredFile[] = [];

  const visit = async (dirAbs: string, top: boolean): Promise<void> => {
    if (signal?.aborted) throw new Error("The directory read was aborted.");
    let dirents;
    try {
      dirents = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      if (signal?.aborted) throw new Error("The directory read was aborted.");
      const abs = path.join(dirAbs, dirent.name);
      let rel: string;
      try {
        rel = toWorkspaceRelative(workspaceRoot, abs);
      } catch {
        continue;
      }
      const relPosix = rel.split(path.sep).join("/");
      if (isExcludedRel(relPosix)) continue;
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        if (!onlyFiles || !top) await visit(abs, false);
        continue;
      }
      if (!dirent.isFile()) continue;
      if (hasBinaryExtension(dirent.name)) continue;
      let size = 0;
      try {
        const stat = await fs.stat(abs);
        if (!stat.isFile()) continue;
        size = stat.size;
      } catch {
        continue;
      }
      found.push({ absolute: abs, relative: rel, size });
    }
  };

  await visit(rootAbs, true);
  // Deterministic ordering by workspace-relative path so output is stable across runs.
  found.sort((a, b) => a.relative.localeCompare(b.relative));
  return found;
}

/** Resolve the requested directory inside the workspace and verify it is a directory. */
function resolveDirectory(workspaceRoot: string, input: string): string {
  const absolute = safeResolve(workspaceRoot, input);
  return absolute;
}

export const readDirectoryTool = defineTool({
  name: "read_directory",
  description:
    "Read all supported text files in a directory in a single tool call and return their complete " +
    "contents with their paths. Use this to load a whole folder quickly instead of calling file_read " +
    "for every file. Set read_only_files=true to read only the files directly inside the directory " +
    "(ignoring subdirectories); otherwise files in all subdirectories are read recursively. " +
    "VCS data, dependencies, build artifacts, and binary files are skipped. If the combined content " +
    "would exceed the available context budget, the tool returns a structured error listing the files " +
    "and their sizes instead of partial or truncated content — in that case read the files you need " +
    "individually with file_read.",
  schema,
  label: (args: ReadDirectoryArgs) => `Read directory: ${args.directory_path}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const requested = args.directory_path.trim();
    if (requested.length === 0) {
      return {
        ok: false,
        error: {
          code: "invalid_directory_path",
          message: "directory_path must be a non-empty string.",
          directory_path: args.directory_path,
        },
      };
    }

    const onlyFiles = args.read_only_files === true;

    let absolute: string;
    try {
      absolute = resolveDirectory(ctx.workspaceRoot, requested);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "invalid_directory_path",
          message: error instanceof Error ? error.message : String(error),
          directory_path: requested,
        },
      };
    }

    const relative = toWorkspaceRelative(ctx.workspaceRoot, absolute);

    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException)?.code;
      if (errno === "ENOENT" || errno === "ENOTDIR") {
        return {
          ok: false,
          error: {
            code: "directory_not_found",
            message: `Directory does not exist: ${relative}`,
            directory_path: relative,
          },
        };
      }
      if (errno === "EACCES" || errno === "EPERM") {
        return {
          ok: false,
          error: {
            code: "permission_denied",
            message: `Permission denied while reading directory: ${relative}`,
            directory_path: relative,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "directory_read_failed",
          message: `Could not stat "${relative}": ${error instanceof Error ? error.message : String(error)}`,
          directory_path: relative,
        },
      };
    }
    if (!stat.isDirectory()) {
      return {
        ok: false,
        error: {
          code: "not_a_directory",
          message: `Path is not a directory: ${relative}`,
          directory_path: relative,
        },
      };
    }

    let discovered: DiscoveredFile[];
    try {
      discovered = await discoverFiles(absolute, ctx.workspaceRoot, onlyFiles, ctx.signal);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: (error as { code?: string }).code ?? "directory_read_failed",
          message: error instanceof Error ? error.message : String(error),
          directory_path: relative,
        },
      };
    }

    // Budget check BEFORE reading any content: the combined size must fit the context budget.
    const totalBytes = discovered.reduce((sum, file) => sum + file.size, 0);
    const contextLimit =
      typeof ctx.contextLimit === "number" && Number.isFinite(ctx.contextLimit) && ctx.contextLimit > 0
        ? ctx.contextLimit
        : DEFAULT_CONTEXT_TOKEN_LIMIT;
    const budgetChars = Math.floor(
      contextLimit * READ_DIRECTORY_CHARS_PER_TOKEN * READ_DIRECTORY_CONTEXT_FRACTION,
    );

    if (totalBytes > budgetChars) {
      return {
        ok: false,
        error: {
          code: "content_exceeds_context_budget",
          message:
            `The directory "${relative}" contains ${discovered.length} file(s) totalling ${totalBytes} ` +
            `characters, which exceeds the available context budget of ${budgetChars} characters ` +
            `(estimated from a ${contextLimit}-token context window). To avoid returning partial or ` +
            `truncated content, no files were read. Read only the files you need individually with ` +
            `file_read, or narrow the request to a smaller subdirectory.`,
          directory_path: relative,
          file_count: discovered.length,
          total_chars: totalBytes,
          budget_chars: budgetChars,
          context_limit: contextLimit,
          files: discovered.map((file) => ({ path: file.relative, bytes: file.size })),
        },
      };
    }

    const files: ReadFileEntry[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    let totalChars = 0;

    for (const file of discovered) {
      if (ctx.signal?.aborted) {
        return {
          ok: false,
          error: {
            code: "aborted",
            message: "The directory read was aborted.",
            directory_path: relative,
          },
        };
      }
      let content: string;
      try {
        const buf = await fs.readFile(file.absolute);
        if (buf.includes(0)) {
          skipped.push({ path: file.relative, reason: "binary" });
          continue;
        }
        content = buf.toString("utf8");
      } catch (error) {
        skipped.push({
          path: file.relative,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      files.push({ path: file.relative, content, bytes: Buffer.byteLength(content, "utf8") });
      totalChars += content.length;
    }

    return {
      ok: true,
      data: {
        directory_path: relative,
        read_only_files: onlyFiles,
        recursive: !onlyFiles,
        files,
        file_count: files.length,
        total_chars: totalChars,
        skipped,
        message:
          files.length === 0
            ? `No supported text files found in "${relative}"${
                onlyFiles ? " (subdirectories were ignored)" : ""
              }.`
            : `Read ${files.length} file(s) from "${relative}"${
                onlyFiles ? " (files only; subdirectories ignored)" : " (recursively)"
              }.`,
      },
    };
  },
});
