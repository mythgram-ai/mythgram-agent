import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";
import { includeToRegExp } from "./grep.js";

/** Maximum matches returned to the model (prevents context blowup, mirrors grep). */
export const MAX_ASTGREP_MATCHES = 50;
/** Maximum characters of a single matched snippet returned (mirrors grep/memory_search). */
export const MAX_ASTGREP_LINE_CHARS = 500;
/** Maximum characters kept per captured wildcard value. */
export const MAX_CAPTURE_CHARS = 500;
/** Files larger than this are skipped (ast-grep handles its own limits; we stay bounded). */
const MAX_FILE_BYTES = 1_000_000;

/**
 * Directories never searched (build artifacts, VCS data, agent state, caches).
 * Mirrors the grep tool exclusions so AST search never spelunks generated output.
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
        "AST pattern to search for (e.g. 'function $NAME($ARGS) { $BODY }', 'class $CLASS extends $PARENT', 'import $MODULE from \"$PATH\"'). Use $UPPERCASE wildcards to capture variable parts.",
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
    language: z
      .string()
      .trim()
      .optional()
      .describe(
        "Programming language for AST parsing (e.g. 'javascript', 'python', 'typescript'). If omitted, auto-detects from file extensions",
      ),
  })
  .strict();

type AstGrepArgs = z.infer<typeof schema>;

export interface AstGrepMatch {
  /** Workspace-relative file path. */
  path: string;
  /** 1-based line number where the match starts. */
  line_number: number;
  /** The matched code snippet (truncated to MAX_ASTGREP_LINE_CHARS). */
  content: string;
  /** Detected (or requested) language for this file. */
  language: string;
  /** Captured wildcard values ($NAME -> matched text). */
  captures: Record<string, string>;
}

/** Extension (lowercase, without dot) -> canonical language name. */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  pyi: "python",
  java: "java",
  go: "go",
  rs: "rust",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  cs: "csharp",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  sh: "bash",
  bash: "bash",
  lua: "lua",
  r: "r",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  vue: "vue",
  svelte: "svelte",
};

/** All canonical languages supported (keys of the extension map, deduped). */
export const ASTGREP_LANGUAGES: readonly string[] = Array.from(
  new Set(Object.values(EXTENSION_TO_LANGUAGE)),
).sort();

/** Aliases users commonly type -> canonical language name. */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  csharp: "csharp",
  "c#": "csharp",
  "c++": "cpp",
  yml: "yaml",
};

/**
 * Normalize a user-supplied language to its canonical name.
 * Returns null when the language is unknown.
 */
export function normalizeLanguage(raw: string | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (LANGUAGE_ALIASES[value]) return LANGUAGE_ALIASES[value]!;
  if ((ASTGREP_LANGUAGES as readonly string[]).includes(value)) return value;
  return null;
}

/** Detect a file's language from its extension. Returns null when unknown. */
export function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!ext) return null;
  return EXTENSION_TO_LANGUAGE[ext] ?? null;
}

/** True when a file belongs to the requested language (by extension). */
function matchesLanguage(filePath: string, language: string): boolean {
  const detected = detectLanguage(filePath);
  if (!detected) return false;
  if (detected === language) return true;
  // tsx files also satisfy typescript queries and vice versa for convenience.
  if (
    (language === "typescript" && detected === "tsx") ||
    (language === "tsx" && detected === "typescript")
  ) {
    return true;
  }
  return false;
}

function truncateSnippet(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  return trimmed.length <= MAX_ASTGREP_LINE_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_ASTGREP_LINE_CHARS)}… (truncated)`;
}

function truncateCapture(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_CAPTURE_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_CAPTURE_CHARS)}… (truncated)`;
}

function isExcludedRel(relPosix: string): boolean {
  for (const segment of relPosix.split("/")) {
    if (!segment) continue;
    if (EXCLUDED_DIR_NAMES.has(segment)) return true;
  }
  return false;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A $UPPERCASE wildcard placeholder (e.g. $NAME, $ARGS, $BODY, $_). */
const WILDCARD_PATTERN = /\$[A-Z_][A-Z0-9_]*/g;

export interface CompiledAstPattern {
  regex: RegExp;
  /** Unique wildcard names in first-seen order (without the $ prefix). */
  varNames: string[];
}

/**
 * Compile an AST pattern with $UPPERCASE wildcards into a structural regex.
 *
 * Each wildcard becomes a non-greedy capture ([\\s\\S]+?) so `function
 * $NAME($ARGS) { $BODY }` matches functions regardless of identifier,
 * arguments, or body. Literal code between wildcards is matched with flexible
 * whitespace (any run of whitespace in the pattern matches any run of
 * whitespace in the file, including newlines), so formatting differences never
 * block a structural match.
 */
export function compileAstPattern(pattern: string): CompiledAstPattern {
  const varNames: string[] = [];
  const seen = new Set<string>();
  const tokens: Array<{ kind: "literal"; text: string } | { kind: "wildcard"; name: string }> = [];

  let lastIndex = 0;
  for (const match of pattern.matchAll(WILDCARD_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ kind: "literal", text: pattern.slice(lastIndex, index) });
    }
    const name = match[0].slice(1);
    tokens.push({ kind: "wildcard", name });
    if (!seen.has(name)) {
      seen.add(name);
      varNames.push(name);
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < pattern.length) {
    tokens.push({ kind: "literal", text: pattern.slice(lastIndex) });
  }

  const emitted = new Set<string>();
  let source = "";
  for (const token of tokens) {
    if (token.kind === "literal") {
      // Escape, then relax every whitespace run to flexible whitespace.
      const escaped = escapeRegExp(token.text).replace(/\s+/g, "\\s+");
      source += escaped;
    } else if (!emitted.has(token.name)) {
      emitted.add(token.name);
      source += `(?<${token.name}>[\\s\\S]+?)`;
    } else {
      // Repeated wildcard: match structurally without a second named group
      // (duplicate group names are a SyntaxError).
      source += "(?:[\\s\\S]+?)";
    }
  }

  return { regex: new RegExp(source, "g"), varNames };
}

/** 1-based line number of `index` inside `content`. */
function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
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

function matchesInclude(relPosix: string, re: RegExp | null): boolean {
  if (!re) return true;
  if (re.test(relPosix)) return true;
  const base = relPosix.split("/").pop() ?? relPosix;
  return re.test(base);
}

export const astgrepTool = defineTool({
  name: "astgrep",
  description:
    "Searches for AST patterns within code files using structural matching. Supports multiple programming languages and returns matches with file paths, line numbers, and code context. " +
    "YOU MUST USE THIS TOOL WHENEVER YOU WANT TO SEARCH FOR CODE. " +
    "Usage: AST patterns use code-like patterns with wildcards (e.g. 'function $NAME($ARGS) { $BODY }', 'import $MODULE from \"$PATH\"'). " +
    "Wildcards use $UPPERCASE for capturing parts (e.g. $NAME, $ARGS, $BODY). " +
    "Language auto-detection detects the programming language from file extensions. " +
    "Filter files by pattern with the `include` parameter (e.g. '*.js', '*.{ts,tsx}'). " +
    "Supports 20+ programming languages including JavaScript, TypeScript, Python, Java, Go, Rust, etc.",
  schema,
  label: (args: AstGrepArgs) => {
    const pattern = typeof args.pattern === "string" ? args.pattern.trim().slice(0, 60) : "";
    return pattern ? `AST: ${pattern}` : "AST code search";
  },
  async execute(args, ctx): Promise<ToolResult> {
    const pattern = args.pattern?.trim() ?? "";
    if (!pattern) {
      return { ok: false, error: { code: "missing_pattern", message: "A non-empty AST `pattern` is required." } };
    }
    if (!pattern.includes("$")) {
      return {
        ok: false,
        error: {
          code: "invalid_pattern",
          message:
            "The AST pattern must contain at least one $UPPERCASE wildcard (e.g. $NAME, $ARGS, $BODY) so it matches structurally instead of as plain text.",
          pattern,
        },
      };
    }

    let language: string | null = null;
    if (args.language !== undefined && args.language.trim().length > 0) {
      const normalized = normalizeLanguage(args.language);
      if (!normalized) {
        return {
          ok: false,
          error: {
            code: "invalid_language",
            message: `Unknown language "${args.language.trim()}". Supported languages: ${ASTGREP_LANGUAGES.join(", ")}. Omit language to auto-detect from file extensions.`,
            language: args.language,
          },
        };
      }
      language = normalized;
    }

    let search: ResolvedSearch;
    try {
      search = await resolveSearchRoot(ctx.workspaceRoot, args.path);
    } catch (error) {
      const code = (error as { code?: string }).code ?? "invalid_path";
      return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error), path: args.path } };
    }

    const include = args.include?.trim() || undefined;
    let includeRe: RegExp | null = null;
    try {
      includeRe = includeToRegExp(include);
    } catch {
      includeRe = null;
    }

    let compiled: CompiledAstPattern;
    try {
      compiled = compileAstPattern(pattern);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "invalid_pattern",
          message: `Invalid AST pattern: ${error instanceof Error ? error.message : String(error)}`,
          pattern,
        },
      };
    }

    const matches: AstGrepMatch[] = [];
    let truncated = false;

    const visitFile = async (abs: string): Promise<void> => {
      if (matches.length >= MAX_ASTGREP_MATCHES) {
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
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return;
      const rel = toWorkspaceRelative(ctx.workspaceRoot, abs);
      const relPosix = rel.split(path.sep).join("/");
      if (isExcludedRel(relPosix)) return;
      if (!matchesInclude(relPosix, includeRe)) return;
      if (language && !matchesLanguage(abs, language)) return;
      const fileLanguage = detectLanguage(abs) ?? language ?? "unknown";
      let content: string;
      try {
        const buf = await fs.readFile(abs);
        if (buf.includes(0)) return; // binary
        content = buf.toString("utf8");
      } catch {
        return;
      }

      const regex = new RegExp(compiled.regex.source, "g");
      let m: RegExpExecArray | null;
      while ((m = regex.exec(content)) !== null) {
        if (m[0].length === 0) {
          regex.lastIndex += 1;
          continue;
        }
        const captures: Record<string, string> = {};
        const groups = m.groups ?? {};
        for (const name of compiled.varNames) {
          const value = groups[name];
          if (typeof value === "string" && value.trim().length > 0) {
            captures[name] = truncateCapture(value);
          }
        }
        matches.push({
          path: rel,
          line_number: lineNumberAt(content, m.index),
          content: truncateSnippet(m[0]),
          language: fileLanguage,
          captures,
        });
        if (matches.length >= MAX_ASTGREP_MATCHES) {
          truncated = true;
          return;
        }
        // Guard against zero-length loops on huge files.
        if (m.index === regex.lastIndex) regex.lastIndex += 1;
      }
    };

    const walk = async (dirAbs: string): Promise<void> => {
      if (matches.length >= MAX_ASTGREP_MATCHES) {
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
        if (matches.length >= MAX_ASTGREP_MATCHES) {
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

    try {
      if (search.isFile) {
        await visitFile(search.absolute);
      } else {
        await walk(search.absolute);
      }
    } catch (error) {
      const code = (error as { code?: string }).code ?? "astgrep_failed";
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

    const sliced = matches.slice(0, MAX_ASTGREP_MATCHES);
    return {
      ok: true,
      data: {
        pattern,
        path: search.relative,
        ...(include ? { include } : {}),
        ...(language ? { language } : {}),
        matches: sliced,
        match_count: sliced.length,
        truncated,
        message:
          sliced.length === 0
            ? `No structural matches for "${pattern}" in ${search.relative}.`
            : `${sliced.length} structural match(es) for "${pattern}" in ${search.relative}.`,
      },
    };
  },
});
