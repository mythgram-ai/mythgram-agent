import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";
import { includeToRegExp } from "./grep.js";

/** Maximum matches returned to the model (prevents context blowup). */
export const MAX_GLOB_MATCHES = 100;

/**
 * Directories never searched (build artifacts, VCS data, agent state, caches).
 * Mirrors the grep tool exclusions so glob never spelunks generated output.
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

const schema = z
  .object({
    pattern: z
      .string()
      .trim()
      .min(1, "pattern must be a non-empty string")
      .describe(
        "The glob pattern to match files against, such as '**/*.ts', '*.json', or 'src/**'.",
      ),
    path: z
      .string()
      .trim()
      .optional()
      .describe(
        "Optional directory to search in. If omitted, the current working directory is used. Must be a valid directory path.",
      ),
  })
  .strict();

type GlobArgs = z.infer<typeof schema>;

function isExcludedRel(relPosix: string): boolean {
  for (const segment of relPosix.split("/")) {
    if (!segment) continue;
    if (EXCLUDED_DIR_NAMES.has(segment)) return true;
  }
  return false;
}

function matchesGlob(relPosix: string, re: RegExp): boolean {
  if (re.test(relPosix)) return true;
  // Also test the basename so "*.json" style patterns match regardless of depth,
  // mirroring the grep include semantics (rg --glob behavior).
  const base = relPosix.split("/").pop() ?? relPosix;
  return re.test(base);
}

interface ResolvedSearch {
  absolute: string;
  relative: string;
}

async function resolveSearchRoot(
  workspaceRoot: string,
  rawPath: string | undefined,
): Promise<ResolvedSearch> {
  const requested = rawPath && rawPath.trim() ? rawPath.trim() : ".";
  const absolute = safeResolve(workspaceRoot, requested);
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absolute);
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException)?.code;
    if (errno === "ENOENT" || errno === "ENOTDIR") {
      throw Object.assign(new Error(`Path does not exist: ${requested}`), { code: "path_not_found" });
    }
    throw Object.assign(
      new Error(`Could not stat "${requested}": ${error instanceof Error ? error.message : String(error)}`),
      { code: "path_stat_failed" },
    );
  }
  if (stat.isDirectory()) {
    return { absolute, relative: toWorkspaceRelative(workspaceRoot, absolute) };
  }
  throw Object.assign(new Error(`Path is not a directory: ${requested}`), {
    code: "unsupported_path_type",
  });
}

export const globTool = defineTool({
  name: "glob",
  description:
    "Find files and directories matching a glob pattern. Searches recursively within the specified directory or the current working directory when no path is provided. Returns matching file paths, up to 100 results.",
  schema,
  label: (args: GlobArgs) => {
    const pattern = typeof args.pattern === "string" ? args.pattern.trim().slice(0, 60) : "";
    return pattern ? `Glob: ${pattern}` : "Glob files";
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const pattern = args.pattern?.trim() ?? "";
    if (!pattern) {
      return { ok: false, error: { code: "missing_pattern", message: "A non-empty glob `pattern` is required." } };
    }

    let search: ResolvedSearch;
    try {
      search = await resolveSearchRoot(ctx.workspaceRoot, args.path);
    } catch (error) {
      const code = (error as { code?: string }).code ?? "invalid_path";
      return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error), path: args.path } };
    }

    let regex: RegExp;
    try {
      const compiled = includeToRegExp(pattern);
      if (!compiled) {
        return { ok: false, error: { code: "missing_pattern", message: "A non-empty glob `pattern` is required.", pattern } };
      }
      regex = compiled;
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "invalid_pattern",
          message: `Invalid glob pattern: ${error instanceof Error ? error.message : String(error)}`,
          pattern,
        },
      };
    }

    try {
      const { matches, truncated } = await collectMatches(search.absolute, ctx, regex);
      const sliced = matches.slice(0, MAX_GLOB_MATCHES);
      return {
        ok: true,
        data: {
          pattern,
          path: search.relative,
          matches: sliced,
          match_count: sliced.length,
          truncated,
          message:
            sliced.length === 0
              ? `No files matched "${pattern}" in ${search.relative}.`
              : `${sliced.length} match(es) for "${pattern}" in ${search.relative}.`,
        },
      };
    } catch (error) {
      const code = (error as { code?: string }).code ?? "glob_failed";
      if (code === "aborted") {
        return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error), pattern } };
      }
      return {
        ok: false,
        error: {
          code,
          message: error instanceof Error ? error.message : String(error),
          pattern,
        },
      };
    }
  },
});

async function collectMatches(
  searchAbs: string,
  ctx: ToolContext,
  regex: RegExp,
): Promise<{ matches: string[]; truncated: boolean }> {
  const matches: string[] = [];
  let truncated = false;

  const visitDir = async (dirAbs: string): Promise<boolean> => {
    if (matches.length >= MAX_GLOB_MATCHES) {
      truncated = true;
      return false;
    }
    if (ctx.signal?.aborted) throw Object.assign(new Error("The search was aborted"), { code: "aborted" });
    let dirents;
    try {
      dirents = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return true;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      if (matches.length >= MAX_GLOB_MATCHES) {
        truncated = true;
        return false;
      }
      if (ctx.signal?.aborted) throw Object.assign(new Error("The search was aborted"), { code: "aborted" });
      const abs = path.join(dirAbs, dirent.name);
      let rel: string;
      try {
        rel = toWorkspaceRelative(ctx.workspaceRoot, abs);
      } catch {
        continue;
      }
      const relPosix = rel.split(path.sep).join("/");
      if (isExcludedRel(relPosix)) continue;
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        if (matchesGlob(relPosix, regex)) {
          matches.push(rel);
          if (matches.length >= MAX_GLOB_MATCHES) {
            truncated = true;
            return false;
          }
        }
        const cont = await visitDir(abs);
        if (!cont) return false;
      } else if (dirent.isFile()) {
        if (matchesGlob(relPosix, regex)) {
          matches.push(rel);
          if (matches.length >= MAX_GLOB_MATCHES) {
            truncated = true;
            return false;
          }
        }
      }
    }
    return true;
  };

  await visitDir(searchAbs);
  return { matches, truncated };
}
