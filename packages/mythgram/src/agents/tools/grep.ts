import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

/** Maximum matches returned to the model (prevents context blowup). */
export const MAX_GREP_MATCHES = 50;
/** Maximum characters of a single matched line returned (mirrors memory_search). */
export const MAX_GREP_LINE_CHARS = 500;
/** Files larger than this are skipped by the Node fallback (rg handles its own limits). */
const MAX_FALLBACK_FILE_BYTES = 1_000_000;
/** Timeout for the ripgrep subprocess (falls back to the shell timeout when set). */
const DEFAULT_RG_TIMEOUT_MS = 30_000;

/**
 * Directories never searched (build artifacts, VCS data, agent state, caches).
 * Mirrors the checkpoint snapshot exclusions so grep never spelunks generated output.
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
        "The regular expression (regex) pattern to search for within file contents (e.g. 'function\\s+myFunction', 'import\\s+\\{.*\\}\\s+from\\s+.*')",
      ),
    path: z
      .string()
      .trim()
      .optional()
      .describe(
        "The absolute path to the directory to search within. If omitted, searches the current working directory (the workspace root)",
      ),
    include: z
      .string()
      .trim()
      .optional()
      .describe(
        "A glob pattern to filter which files are searched (e.g. '*.js', '*.{ts,tsx}', 'src/**'). If omitted, searches all files",
      ),
  })
  .strict();

type GrepArgs = z.infer<typeof schema>;

export interface GrepMatch {
  /** Workspace-relative file path. */
  path: string;
  /** 1-based line number of the match. */
  line_number: number;
  /** The matched line content (truncated to MAX_GREP_LINE_CHARS). */
  content: string;
}

function truncateLine(line: string): string {
  const trimmed = line.replace(/\s+$/, "");
  return trimmed.length <= MAX_GREP_LINE_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_GREP_LINE_CHARS)}… (truncated)`;
}

function isExcludedRel(relPosix: string): boolean {
  for (const segment of relPosix.split("/")) {
    if (!segment) continue;
    if (EXCLUDED_DIR_NAMES.has(segment)) return true;
  }
  return false;
}

/**
 * Convert a user-supplied `include` glob into a RegExp tested against
 * workspace-relative posix paths. Supports `*`, `**`, `?`, `{a,b}` alternation
 * and `[...]` classes — enough for "*.js", "*.{ts,tsx}", "src/**".
 * Returns null when no include filter was supplied.
 */
export function includeToRegExp(raw: string | undefined): RegExp | null {
  const glob = (raw ?? "").trim();
  if (!glob) return null;
  // Split alternation outside braces? Simplest: expand {a,b} first.
  const expanded = expandBraces(glob);
  const sources = expanded.map((g) => globSource(g));
  return new RegExp(`^(?:${sources.join("|")})$`);
}

function expandBraces(glob: string): string[] {
  const open = glob.indexOf("{");
  if (open === -1) return [glob];
  const close = findBraceClose(glob, open);
  if (close === -1) return [glob];
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  const body = glob.slice(open + 1, close);
  const parts = splitTopLevel(body, ",");
  if (parts.length <= 1) return [glob];
  const out: string[] = [];
  for (const part of parts) {
    for (const rest of expandBraces(head + part + tail)) out.push(rest);
  }
  return out;
}

function findBraceClose(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === "{") depth += 1;
    else if (s[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of s) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    if (ch === sep && depth === 0) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function globSource(glob: string): string {
  let out = "";
  let i = 0;
  const n = glob.length;
  while (i < n) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // "**" (optionally followed by "/") spans directories.
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      out += "[^/]";
      i += 1;
    } else if (ch === "[") {
      const close = glob.indexOf("]", i + 1);
      if (close === -1) {
        out += "\\[";
        i += 1;
      } else {
        out += glob.slice(i, close + 1);
        i = close + 1;
      }
    } else {
      out += escapeRegExp(ch);
      i += 1;
    }
  }
  // A bare "*.js" should also match nested paths ("src/a.js"), mirroring rg --glob semantics.
  if (!glob.includes("/")) out = `(?:.*/)?${out}`;
  return out;
}

function escapeRegExp(ch: string): string {
  return ch.replace(/[.+^${}()|\\]/g, "\\$&");
}

function matchesInclude(relPosix: string, re: RegExp | null): boolean {
  if (!re) return true;
  if (re.test(relPosix)) return true;
  // Also test the basename so "*.js" style globs match regardless of depth.
  const base = relPosix.split("/").pop() ?? relPosix;
  return re.test(base);
}

interface ResolvedSearch {
  absolute: string;
  relative: string;
  isFile: boolean;
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
    return { absolute, relative: toWorkspaceRelative(workspaceRoot, absolute), isFile: false };
  }
  if (stat.isFile()) {
    return { absolute, relative: toWorkspaceRelative(workspaceRoot, absolute), isFile: true };
  }
  throw Object.assign(new Error(`Path is not a file or directory: ${requested}`), {
    code: "unsupported_path_type",
  });
}

/** Run ripgrep and parse `path:line:content` output. Throws on spawn/timeout failures. */
function runRipgrep(
  searchAbs: string,
  pattern: string,
  include: string | undefined,
  ctx: ToolContext,
): Promise<{ matches: GrepMatch[]; truncated: boolean; usedRipgrep: boolean }> {
  return new Promise((resolve, reject) => {
    const args: string[] = [
      "--with-filename",
      "--line-number",
      "--no-heading",
      "--color=never",
      "--max-count",
      String(MAX_GREP_MATCHES),
      "-e",
      pattern,
    ];
    // Never spelunk build artifacts / VCS / agent state.
    for (const dir of EXCLUDED_DIR_NAMES) {
      args.push("--glob", `!**/${dir}/**`);
    }
    if (include && include.trim()) args.push("--glob", include.trim());
    args.push("--", searchAbs);

    let proc;
    try {
      proc = spawn("rg", args, { cwd: ctx.workspaceRoot });
    } catch (error) {
      reject(
        Object.assign(new Error(`Could not start ripgrep: ${error instanceof Error ? error.message : String(error)}`), {
          code: "rg_spawn_failed",
        }),
      );
      return;
    }
        let stdout = "";
        let stderr = "";
        let settled = false;

        const fallbackMs =
          Number.isFinite(ctx.shellTimeoutMs) && ctx.shellTimeoutMs > 0
            ? Math.min(ctx.shellTimeoutMs, 60_000)
            : DEFAULT_RG_TIMEOUT_MS;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            proc.kill("SIGKILL");
          } catch {
            // ignore
          }
          reject(Object.assign(new Error(`Search timed out after ${Math.round(fallbackMs / 1000)}s`), { code: "grep_timeout" }));
        }, fallbackMs);
        if (typeof timer.unref === "function") timer.unref();

        const onAbort = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            proc.kill("SIGKILL");
          } catch {
            // ignore
          }
          reject(Object.assign(new Error("The search was aborted"), { code: "aborted" }));
        };
        ctx.signal?.addEventListener("abort", onAbort, { once: true });

        proc.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
          // Bound memory: stop accumulating far past what we can return.
          if (stdout.length > 1_000_000) {
            try {
              proc.kill("SIGKILL");
            } catch {
              // ignore
            }
          }
        });
        proc.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        proc.on("error", (error: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ctx.signal?.removeEventListener("abort", onAbort);
          const err = error as NodeJS.ErrnoException;
          if (err.code === "ENOENT") {
            reject(Object.assign(new Error("ripgrep (rg) is not installed"), { code: "rg_missing" }));
          } else {
            reject(Object.assign(new Error(`Could not start ripgrep: ${error.message}`), { code: "rg_spawn_failed" }));
          }
        });
        proc.on("close", (code: number | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ctx.signal?.removeEventListener("abort", onAbort);
          // rg exit codes: 0 = matches, 1 = no matches, 2 = error.
          if (code === 0 || code === 1) {
            try {
              const parsed = parseRipgrepOutput(stdout, ctx.workspaceRoot);
              const truncated = parsed.length >= MAX_GREP_MATCHES;
              resolve({ matches: parsed.slice(0, MAX_GREP_MATCHES), truncated, usedRipgrep: true });
            } catch (error) {
              reject(error);
            }
            return;
          }
          reject(
            Object.assign(new Error(`ripgrep failed (exit ${code ?? "?"}): ${stderr.trim().slice(0, 500) || "unknown error"}`), {
              code: "rg_failed",
            }),
          );
        });
  });
}

function parseRipgrepOutput(stdout: string, workspaceRoot: string): GrepMatch[] {
  const matches: GrepMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    // Format: path:line:content (content may contain colons — split only the first two).
    const first = line.indexOf(":");
    if (first === -1) continue;
    const second = line.indexOf(":", first + 1);
    if (second === -1) continue;
    const filePart = line.slice(0, first);
    const linePart = line.slice(first + 1, second);
    const contentPart = line.slice(second + 1);
    const lineNumber = Number(linePart);
    if (!Number.isInteger(lineNumber) || lineNumber < 1) continue;
    let rel: string;
    try {
      const abs = path.isAbsolute(filePart) ? path.normalize(filePart) : path.resolve(workspaceRoot, filePart);
      rel = toWorkspaceRelative(workspaceRoot, abs);
    } catch {
      continue;
    }
    matches.push({ path: rel, line_number: lineNumber, content: truncateLine(contentPart) });
    if (matches.length >= MAX_GREP_MATCHES) break;
  }
  return matches;
}

/** Pure-Node fallback when `rg` is unavailable: walk + regex per line. */
async function fallbackSearch(
  search: ResolvedSearch,
  regex: RegExp,
  includeRe: RegExp | null,
  ctx: ToolContext,
): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const matches: GrepMatch[] = [];
  let truncated = false;

  const visitFile = async (abs: string): Promise<void> => {
    if (matches.length >= MAX_GREP_MATCHES) {
      truncated = true;
      return;
    }
    if (ctx.signal?.aborted) throw Object.assign(new Error("The search was aborted"), { code: "aborted" });
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      return;
    }
    if (!stat.isFile() || stat.size > MAX_FALLBACK_FILE_BYTES) return;
    const rel = toWorkspaceRelative(ctx.workspaceRoot, abs);
    const relPosix = rel.split(path.sep).join("/");
    if (isExcludedRel(relPosix)) return;
    if (!matchesInclude(relPosix, includeRe)) return;
    let content: string;
    try {
      const buf = await fs.readFile(abs);
      if (buf.includes(0)) return; // binary
      content = buf.toString("utf8");
    } catch {
      return;
    }
    const lines = content.split("\n");
    // Ensure a global regex starts from the beginning for every line.
    const perLine = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
    for (let i = 0; i < lines.length; i += 1) {
      perLine.lastIndex = 0;
      if (perLine.test(lines[i]!)) {
        matches.push({ path: rel, line_number: i + 1, content: truncateLine(lines[i]!) });
        if (matches.length >= MAX_GREP_MATCHES) {
          truncated = true;
          return;
        }
      }
    }
  };

  const walk = async (dirAbs: string): Promise<void> => {
    if (matches.length >= MAX_GREP_MATCHES) {
      truncated = true;
      return;
    }
    if (ctx.signal?.aborted) throw Object.assign(new Error("The search was aborted"), { code: "aborted" });
    let dirents;
    try {
      dirents = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      if (matches.length >= MAX_GREP_MATCHES) {
        truncated = true;
        return;
      }
      const abs = path.join(dirAbs, dirent.name);
      const rel = toWorkspaceRelative(ctx.workspaceRoot, abs);
      const relPosix = rel.split(path.sep).join("/");
      if (isExcludedRel(relPosix)) continue;
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        await walk(abs);
      } else if (dirent.isFile()) {
        await visitFile(abs);
      }
    }
  };

  if (search.isFile) {
    await visitFile(search.absolute);
  } else {
    await walk(search.absolute);
  }
  return { matches, truncated };
}

export const grepTool = defineTool({
  name: "grep",
  description:
    "Fast text-based regex search that finds exact pattern matches within files or directories, utilizing the ripgrep command for efficient searching.\n" +
    "Results will be formatted in the style of ripgrep and can be configured to include line numbers and content.\n" +
    "To avoid overwhelming output, the results are capped at 50 matches.\n" +
    "Use the include or exclude patterns to filter the search scope by file type or specific paths.\n\n" +
    "This is best for finding exact text matches or regex patterns.\n" +
    "More precise than semantic search for finding specific strings or patterns.\n" +
    "This is preferred over semantic search when we know the exact symbol/function name/etc. to search in some set of directories/file types.\n\n" +
    "Usage:\n" +
    '- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)\n' +
    '- Filter files by pattern with the `include` parameter (eg. "*.js", "*.{ts,tsx}")\n' +
    '- If you need to identify/count the number of matches within files, use the Bash tool with `rg` (ripgrep) directly. Do NOT use `grep`',
  schema,
  label: (args: GrepArgs) => {
    const pattern = typeof args.pattern === "string" ? args.pattern.trim().slice(0, 60) : "";
    return pattern ? `Search: ${pattern}` : "Search file contents";
  },
  async execute(args, ctx): Promise<ToolResult> {
    const pattern = args.pattern?.trim() ?? "";
    if (!pattern) {
      return { ok: false, error: { code: "missing_pattern", message: "A non-empty regex `pattern` is required." } };
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "invalid_pattern",
          message: `Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`,
          pattern,
        },
      };
    }

    let search: ResolvedSearch;
    try {
      search = await resolveSearchRoot(ctx.workspaceRoot, args.path);
    } catch (error) {
      const code = (error as { code?: string }).code ?? "invalid_path";
      return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error), path: args.path } };
    }

    const include = args.include?.trim() || undefined;
    const includeRe = includeToRegExp(include);

    // Prefer ripgrep; fall back to a pure-Node walk when `rg` is missing.
    try {
      const result = await runRipgrep(search.absolute, pattern, include, ctx);
      // Apply the include filter to rg output as well (defense in depth for exotic globs).
      const filtered = includeRe
        ? result.matches.filter((m) => matchesInclude(m.path.split(path.sep).join("/"), includeRe))
        : result.matches;
      const truncated = result.truncated || filtered.length >= MAX_GREP_MATCHES;
      return {
        ok: true,
        data: {
          pattern,
          path: search.relative,
          ...(include ? { include } : {}),
          matches: filtered.slice(0, MAX_GREP_MATCHES),
          match_count: Math.min(filtered.length, MAX_GREP_MATCHES),
          truncated,
          message:
            filtered.length === 0
              ? `No matches for "${pattern}" in ${search.relative}.`
              : `${Math.min(filtered.length, MAX_GREP_MATCHES)} match(es) for "${pattern}" in ${search.relative}.`,
        },
      };
    } catch (error) {
      const code = (error as { code?: string }).code ?? "grep_failed";
      if (code !== "rg_missing") {
        if (code === "aborted" || code === "grep_timeout") {
          return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error), pattern } };
        }
        // rg failed for another reason (e.g. invalid regex for rg) — surface it directly.
        if (code === "rg_failed" || code === "rg_spawn_failed") {
          return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error), pattern } };
        }
      }
      try {
        const fallback = await fallbackSearch(search, regex, includeRe, ctx);
        return {
          ok: true,
          data: {
            pattern,
            path: search.relative,
            ...(include ? { include } : {}),
            matches: fallback.matches,
            match_count: fallback.matches.length,
            truncated: fallback.truncated,
            message:
              fallback.matches.length === 0
                ? `No matches for "${pattern}" in ${search.relative}.`
                : `${fallback.matches.length} match(es) for "${pattern}" in ${search.relative}.`,
          },
        };
      } catch (fallbackError) {
        const fallbackCode = (fallbackError as { code?: string }).code ?? "grep_failed";
        return {
          ok: false,
          error: {
            code: fallbackCode,
            message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            pattern,
          },
        };
      }
    }
  },
});
