import type {
  MemoryFile,
  MemoryReadOptions,
  MemoryRuntime,
  ToolContext,
  ToolResult,
} from "./tools/types.js";

/**
 * The four memory files that are always pre-added for every user and can never be deleted. Their
 * contents are the agent's persistent self: MEMORY.md (long-term durable facts/knowledge), SOUL.md
 * (the agent's evolving persona/principles), USER.md (who the user is and how they like to work)
 * and session-memory.md (short-term memory of the current/most-recent working session, maintained
 * continuously by the background memory agent). These four — and only these four — are
 * auto-appended to the user's FIRST message of a chat so the agent starts every conversation
 * already knowing its accumulated context.
 */
export const PREADDED_MEMORY_FILES = [
  "MEMORY.md",
  "SOUL.md",
  "USER.md",
  "session-memory.md",
] as const;

/** Per-file character limits. Pre-added files are capped; custom files have no limit. */
export const MEMORY_CHAR_LIMITS: Readonly<Record<string, number>> = {
  "MEMORY.md": 8000,
  "SOUL.md": 2000,
  "USER.md": 2000,
  "session-memory.md": 5000,
};

/** Virtual root every memory path lives under (used only for display/labels). */
export const MEMORY_ROOT = "/memory/";

/**
 * Build the MemoryRuntime bound to a single main-agent turn. Injected into the ToolContext so the
 * `memory` tool can list/read/write/edit/delete memory files. Memory lives in the SQLite
 * database and travels with each turn; the runtime keeps a per-turn mutable snapshot so
 * reads/writes within the same turn stay consistent, and emits `memory_updated` on every mutation
 * so the frontend syncs the change back into the database.
 */
export function createMemoryRuntime(initial: MemoryFile[]): MemoryRuntime {
  const runner = new MemoryRunner(initial);
  return {
    get files(): MemoryFile[] {
      return runner.list();
    },
    firstMessageContext: () => runner.firstMessageContext(),
    list: () => runner.opList(),
    search: (query) => runner.opSearch(query),
    read: (path, options) => runner.opRead(path, options),
    write: (path, content, ctx) => runner.opWrite(path, content, ctx),
    edit: (path, oldStr, newStr, ctx) => runner.opEdit(path, oldStr, newStr, ctx),
    remove: (path, ctx) => runner.opDelete(path, ctx),
  };
}

class MemoryRunner {
  private current: MemoryFile[];

  constructor(initial: MemoryFile[]) {
    this.current = normalizeMemoryFiles(initial);
  }

  /** Immutable copy of the current memory files. */
  list(): MemoryFile[] {
    return this.current.map((file) => ({ ...file }));
  }

  /**
   * The context block appended to the user's FIRST message of the conversation. It contains two
   * parts, mirroring how the knowledge system surfaces itself on the first message:
   *  1. The four pre-added core files (MEMORY.md, SOUL.md, USER.md, session-memory.md) with their
   *     full contents, so the agent starts every chat already knowing its accumulated self/user
   *     context plus the short-term memory of the most recent working session.
   *  2. The COMPLETE memory file structure (the full tree of every memory file the user has),
   *     so the agent knows exactly which additional memory files exist and can memory_read them
   *     on demand. Only the core four are auto-loaded here; everything else is read explicitly.
   * Always returns a non-empty block (the four core files always exist).
   */
  firstMessageContext(): string {
    const sections: string[] = [];
    for (const name of PREADDED_MEMORY_FILES) {
      const file = this.find(name);
      const content = (file?.content ?? "").trim();
      sections.push(`## ${name}\n${content.length > 0 ? content : "(empty)"}`);
    }

    // The full memory file structure — every memory file the user has, as a tree. This is the
    // "the user has memory files" signal: the agent sees the whole layout up front (like the
    // knowledge base) and reads any non-core file with memory_read when it becomes relevant.
    const paths = this.current.map((f) => f.path);
    const total = paths.length;
    const tree = buildTree(paths);

    return [
      "<persistent_memory>",
      "The following is your persistent, self-maintained memory for this user, loaded automatically",
      "at the start of this conversation. Use it to personalize your help and stay consistent with",
      "what you have already learned. As the conversation progresses, keep it accurate and useful by",
      "calling the `memory` tool to write/edit these files (and create new ones) whenever you learn a",
      "durable fact, preference, decision, or context worth remembering. This block is shown only",
      "once, here at the start — later turns will not repeat it, so rely on the `memory` tool to",
      "read anything you need again.",
      "",
      "## Auto-loaded core files",
      "",
      sections.join("\n\n"),
      "",
      `## Memory file structure (${total} file${total === 1 ? "" : "s"})`,
      "The user has the following memory files. Only the four core files above are auto-loaded; all",
      "other files are NOT loaded here — call `memory_read` with an exact path to load any of them",
      "when it becomes relevant, and `memory_list` / `memory_search` to explore further.",
      "",
      "```",
      tree,
      "```",
      "</persistent_memory>",
    ].join("\n");
  }

  // ---- Operations ---------------------------------------------------------

  opList(): ToolResult {
    const files = this.current.map((file) => ({
      path: file.path,
      chars: file.content.length,
      char_limit: charLimitFor(file.path),
      preadded: isPreadded(file.path),
    }));
    return {
      ok: true,
      data: {
        count: files.length,
        files,
        tree: buildTree(this.current.map((f) => f.path)),
        message:
          "Use memory_read with an exact path to load a file's contents. MEMORY.md, SOUL.md, " +
          "USER.md and session-memory.md are auto-loaded on the first message of a chat; all " +
          "other files must be read explicitly.",
      },
    };
  }

  /**
   * memory_search — scan every memory file for the natural-language query and return the matching
   * file paths together with each matching 1-based line number AND that line's content. Every result
   * carries a `matches` array of `{ line, content }` plus a ready-to-read `preview` that renders the
   * hits as `LINE <n>: <content>` so the agent immediately sees the matched text; memory_read is then
   * only needed to load surrounding context.
   */
  opSearch(rawQuery: unknown): ToolResult {
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (query.length === 0) {
      return {
        ok: false,
        error: {
          code: "memory_search_query_required",
          message: "memory_search requires a non-empty natural-language `query` string.",
        },
      };
    }

    const { terms, phrase } = parseSearchQuery(query);
    const results: Array<{ path: string; lines: number[]; matches: SearchMatch[]; preview: string }> = [];
    let matchCount = 0;
    for (const file of this.current) {
      const matches = findMatchingLines(file.content, terms, phrase);
      if (matches.length > 0) {
        results.push({
          path: `memory/${file.path}`,
          lines: matches.map((m) => m.line),
          matches,
          preview: formatMatches(matches),
        });
        matchCount += matches.length;
      }
    }

    return {
      ok: true,
      data: {
        query,
        result_count: results.length,
        match_count: matchCount,
        results,
        message:
          results.length === 0
            ? "No memory files matched the query. Try memory_list to browse, or a broader query."
            : "Each result lists the file path and its matching lines as `LINE <n>: <content>` (see the " +
              "`matches` array and the `preview` string). Use memory_read with a path (and offset/limit " +
              "around those lines) to load surrounding context.",
      },
    };
  }

  opRead(rawPath: string, options?: MemoryReadOptions): ToolResult {
    const norm = normalizeMemoryPath(rawPath);
    if (norm.error) return invalidPath(norm.error);
    const file = this.find(norm.path);
    if (!file) return notFound(norm.path, this.current);

    const allLines = file.content.split("\n");
    const totalLines = allLines.length;

    // 1-based offset; default to the first line. Clamp defensively.
    const offset =
      typeof options?.offset === "number" && Number.isFinite(options.offset)
        ? Math.max(1, Math.floor(options.offset))
        : 1;
    const startIndex = Math.min(offset - 1, totalLines);

    const limit =
      typeof options?.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
        ? Math.floor(options.limit)
        : undefined;
    const endIndex = limit !== undefined ? Math.min(startIndex + limit, totalLines) : totalLines;

    const slice = allLines.slice(startIndex, endIndex);
    const returnLineNumber = options?.returnLineNumber === true;
    const content = returnLineNumber
      ? slice.map((line, i) => `${startIndex + i + 1}\t${line}`).join("\n")
      : slice.join("\n");

    return {
      ok: true,
      data: {
        path: file.path,
        content,
        chars: file.content.length,
        char_limit: charLimitFor(file.path),
        preadded: isPreadded(file.path),
        line_count: slice.length,
        total_lines: totalLines,
        first_line: slice.length > 0 ? startIndex + 1 : null,
        last_line: slice.length > 0 ? startIndex + slice.length : null,
        truncated: endIndex < totalLines || startIndex > 0,
      },
    };
  }

  opWrite(rawPath: string, content: unknown, ctx: ToolContext): ToolResult {
    const norm = normalizeMemoryPath(rawPath);
    if (norm.error) return invalidPath(norm.error);
    if (typeof content !== "string") {
      return {
        ok: false,
        error: {
          code: "memory_content_required",
          message:
            "memory_write requires a string `content` field containing the complete file contents.",
        },
      };
    }

    const canonical = canonicalPath(norm.path);
    const limit = charLimitFor(canonical);
    if (limit !== undefined && content.length > limit) {
      return charLimitError(canonical, content.length, limit, "write");
    }

    this.upsert(canonical, content);
    this.emit(ctx);
    const existed = this.findIndex(canonical) !== -1;
    return {
      ok: true,
      data: {
        path: canonical,
        chars: content.length,
        char_limit: limit,
        preadded: isPreadded(canonical),
        created: !existed ? false : true,
        message: `Memory file "${MEMORY_ROOT}${canonical}" saved (${content.length} chars${
          limit !== undefined ? ` / ${limit} limit` : ""
        }).`,
      },
    };
  }

  opEdit(rawPath: string, oldStr: unknown, newStr: unknown, ctx: ToolContext): ToolResult {
    const norm = normalizeMemoryPath(rawPath);
    if (norm.error) return invalidPath(norm.error);
    if (typeof oldStr !== "string" || oldStr.length === 0) {
      return {
        ok: false,
        error: {
          code: "memory_old_str_required",
          message: "memory_edit requires a non-empty `old_str` that matches text in the file exactly.",
        },
      };
    }
    const replacement = typeof newStr === "string" ? newStr : "";

    const file = this.find(norm.path);
    if (!file) return notFound(norm.path, this.current);

    const occurrences = countOccurrences(file.content, oldStr);
    if (occurrences === 0) {
      return {
        ok: false,
        error: {
          code: "memory_old_str_not_found",
          message:
            `The provided old_str was not found in "${MEMORY_ROOT}${file.path}". It must match the ` +
            "existing text exactly, including whitespace and line breaks. Read the file again with " +
            "memory_read and retry with an exact snippet.",
        },
      };
    }
    if (occurrences > 1) {
      return {
        ok: false,
        error: {
          code: "memory_old_str_not_unique",
          message:
            `The provided old_str appears ${occurrences} times in "${MEMORY_ROOT}${file.path}". Provide a ` +
            "larger, unique snippet so exactly one location is replaced.",
          occurrences,
        },
      };
    }

    const nextContent = file.content.replace(oldStr, replacement);
    const limit = charLimitFor(file.path);
    if (limit !== undefined && nextContent.length > limit) {
      return charLimitError(file.path, nextContent.length, limit, "edit");
    }

    this.upsert(file.path, nextContent);
    this.emit(ctx);
    return {
      ok: true,
      data: {
        path: file.path,
        chars: nextContent.length,
        char_limit: limit,
        preadded: isPreadded(file.path),
        message: `Memory file "${MEMORY_ROOT}${file.path}" edited (${nextContent.length} chars${
          limit !== undefined ? ` / ${limit} limit` : ""
        }).`,
      },
    };
  }

  opDelete(rawPath: string, ctx: ToolContext): ToolResult {
    const norm = normalizeMemoryPath(rawPath);
    if (norm.error) return invalidPath(norm.error);

    if (isPreadded(norm.path)) {
      return {
        ok: false,
        error: {
          code: "memory_delete_forbidden",
          message:
            `"${MEMORY_ROOT}${canonicalPath(norm.path)}" is a pre-added core memory file and cannot be ` +
            "deleted. These four files (MEMORY.md, SOUL.md, USER.md, session-memory.md) are permanent. " +
            "If you want to clear it, use memory_write with an empty or summarized content instead of " +
            "deleting it.",
          preadded_files: [...PREADDED_MEMORY_FILES],
        },
      };
    }

    const index = this.findIndex(norm.path);
    if (index === -1) return notFound(norm.path, this.current);

    const [removed] = this.current.splice(index, 1);
    this.emit(ctx);
    return {
      ok: true,
      data: {
        path: removed?.path ?? norm.path,
        deleted: true,
        message: `Memory file "${MEMORY_ROOT}${removed?.path ?? norm.path}" deleted.`,
      },
    };
  }

  // ---- Internal helpers ---------------------------------------------------

  private emit(ctx: ToolContext): void {
    // `memoryFiles` (not `files`) so the SSE payload never collides with attach_files' `files`.
    ctx.emit?.("memory_updated", { memoryFiles: this.list() });
  }

  private find(path: string): MemoryFile | undefined {
    const key = path.toLowerCase();
    return this.current.find((f) => f.path.toLowerCase() === key);
  }

  private findIndex(path: string): number {
    const key = path.toLowerCase();
    return this.current.findIndex((f) => f.path.toLowerCase() === key);
  }

  private upsert(path: string, content: string): void {
    const index = this.findIndex(path);
    if (index === -1) this.current.push({ path, content });
    else this.current[index] = { path, content };
  }
}

// ---- Pure helpers ---------------------------------------------------------

/** True when the (normalized) path is one of the four permanent pre-added files. */
export function isPreadded(path: string): boolean {
  const key = canonicalPath(path).toLowerCase();
  return PREADDED_MEMORY_FILES.some((name) => name.toLowerCase() === key);
}

/** Canonicalize the case of pre-added file names (e.g. "memory.md" -> "MEMORY.md"). */
export function canonicalPath(path: string): string {
  const match = PREADDED_MEMORY_FILES.find((name) => name.toLowerCase() === path.toLowerCase());
  return match ?? path;
}

/** The character limit for a path, or undefined when the file is uncapped (custom files). */
export function charLimitFor(path: string): number | undefined {
  return MEMORY_CHAR_LIMITS[canonicalPath(path)];
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Parse a natural-language search query into a case-insensitive full `phrase` plus its individual
 * `terms` (tokens of 2+ chars, deduped). A line matches if it contains the whole phrase OR any term,
 * which keeps single-word, multi-word, and partial-word queries all working. Exported for testing.
 */
export function parseSearchQuery(query: string): { terms: string[]; phrase: string } {
  const phrase = query.trim().toLowerCase();
  const terms = Array.from(
    new Set(phrase.split(/[^\p{L}\p{N}_]+/u).filter((t) => t.length >= 2)),
  );
  return { terms, phrase };
}

/** A single search hit: the 1-based line number and that line's (possibly truncated) content. */
export interface SearchMatch {
  line: number;
  content: string;
}

/**
 * Max characters of a single matching line returned in a search result. Keeps a pathologically long
 * or minified line from bloating the tool output while still giving the agent the matched text.
 */
export const MAX_MATCH_LINE_CHARS = 500;

/** Trim trailing whitespace and cap an over-long matching line so results stay compact. */
function truncateMatchLine(line: string): string {
  const trimmed = line.replace(/\s+$/, "");
  return trimmed.length <= MAX_MATCH_LINE_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_MATCH_LINE_CHARS)}… (truncated)`;
}

/**
 * Return, in order, every line in `content` that matches the query (either the full phrase or any
 * single term, case-insensitively) as a `{ line, content }` pair — the 1-based line number plus that
 * line's content. Blank lines are skipped. Exported so both the memory_search runtime and its tests
 * share one matcher.
 */
export function findMatchingLines(content: string, terms: string[], phrase: string): SearchMatch[] {
  const lines = content.split("\n");
  const out: SearchMatch[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    if (lower.length === 0) continue;
    let matched = false;
    if (phrase.length > 0 && lower.includes(phrase)) {
      matched = true;
    } else {
      for (const term of terms) {
        if (lower.includes(term)) {
          matched = true;
          break;
        }
      }
    }
    if (matched) out.push({ line: i + 1, content: truncateMatchLine(lines[i]) });
  }
  return out;
}

/** Render matches as one `LINE <n>: <content>` per line — the block handed to the agent. */
export function formatMatches(matches: SearchMatch[]): string {
  return matches.map((m) => `LINE ${m.line}: ${m.content}`).join("\n");
}

/**
 * Validate and normalize a client/LLM-supplied memory path to a clean relative path under the
 * memory root. Accepts "MEMORY.md", "/memory/MEMORY.md", "memory/projects/a.md", etc. Rejects
 * empty paths, "." / ".." segments (traversal), and absolute escapes.
 */
export function normalizeMemoryPath(raw: unknown): { path: string; error?: undefined } | { path: ""; error: string } {
  let p = String(raw ?? "").trim().replace(/\\/g, "/");
  if (!p) return { path: "", error: "A memory `path` is required (e.g. \"MEMORY.md\" or \"projects/app.md\")." };
  p = p.replace(/^\.\//, "").replace(/^\/+/, "");
  if (/^memory\//i.test(p)) p = p.slice("memory/".length);
  p = p.replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/+$/, "");
  if (!p) return { path: "", error: "The memory `path` cannot be empty or the memory root itself." };

  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      return {
        path: "",
        error:
          "Invalid memory path. Use a simple relative path under /memory/ such as \"USER.md\" or " +
          "\"projects/app.md\" — no \"..\", \".\", or absolute segments are allowed.",
      };
    }
  }
  return { path: p };
}

/**
 * Defensively coerce arbitrary client input into a well-typed memory file list. Non-arrays become
 * an empty list; invalid/duplicate/traversing paths are dropped; the four pre-added files are
 * guaranteed to be present (added empty if missing) so they always exist to read and to append to
 * the first message. Never throws.
 */
export function normalizeMemoryFiles(raw: unknown): MemoryFile[] {
  const out: MemoryFile[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const norm = normalizeMemoryPath(record.path);
      if (norm.error) continue;
      const canonical = canonicalPath(norm.path);
      const key = canonical.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        path: canonical,
        content: typeof record.content === "string" ? record.content : "",
      });
    }
  }

  // Guarantee the four permanent files always exist.
  for (const name of PREADDED_MEMORY_FILES) {
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push({ path: name, content: "" });
    }
  }

  return out;
}

/** A structured error for a path that failed validation. */
function invalidPath(message: string): ToolResult {
  return { ok: false, error: { code: "memory_invalid_path", message } };
}

/** A structured "file not found" error listing what IS available so the model can self-correct. */
function notFound(path: string, files: MemoryFile[]): ToolResult {
  return {
    ok: false,
    error: {
      code: "memory_not_found",
      message:
        `No memory file exists at "${MEMORY_ROOT}${path}". Call memory_list to see the exact ` +
        "available paths, then retry with one of them (or use memory_write to create it).",
      available_paths: files.map((f) => f.path),
    },
  };
}

/**
 * A structured char-limit error. Tells the model exactly how far over it is and that the correct
 * recovery is to summarize/condense the whole file (via memory_write) rather than appending more.
 */
function charLimitError(
  path: string,
  attempted: number,
  limit: number,
  op: "write" | "edit",
): ToolResult {
  return {
    ok: false,
    error: {
      code: "memory_char_limit_exceeded",
      message:
        `This ${op} would make "${MEMORY_ROOT}${path}" ${attempted} characters, which exceeds its ` +
        `${limit}-character limit by ${attempted - limit}. The write was NOT applied. To fix this, ` +
        "summarize and condense the ENTIRE file into a shorter version that includes the important " +
        "existing information plus your new content, then call memory_write with that full " +
        "rewritten content so the result stays within the limit. Do not simply retry the same content.",
      path,
      attempted_chars: attempted,
      char_limit: limit,
      over_by: attempted - limit,
    },
  };
}

/** Build a compact ASCII tree of the memory folder from a flat list of relative paths. */
export function buildTree(paths: string[]): string {
  interface Node {
    children: Map<string, Node>;
    isFile: boolean;
  }
  const root: Node = { children: new Map(), isFile: false };

  for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
    const segments = path.split("/");
    let node = root;
    segments.forEach((seg, i) => {
      let child = node.children.get(seg);
      if (!child) {
        child = { children: new Map(), isFile: false };
        node.children.set(seg, child);
      }
      if (i === segments.length - 1) child.isFile = true;
      node = child;
    });
  }

  const lines: string[] = ["memory/"];
  const walk = (node: Node, prefix: string): void => {
    const entries = [...node.children.entries()].sort((a, b) => {
      const aDir = a[1].children.size > 0 || !a[1].isFile;
      const bDir = b[1].children.size > 0 || !b[1].isFile;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a[0].localeCompare(b[0]);
    });
    entries.forEach(([name, child], i) => {
      const last = i === entries.length - 1;
      const isDir = child.children.size > 0;
      lines.push(`${prefix}${last ? "└── " : "├── "}${name}${isDir ? "/" : ""}`);
      if (isDir) walk(child, `${prefix}${last ? "    " : "│   "}`);
    });
  };
  walk(root, "");
  return lines.join("\n");
}
