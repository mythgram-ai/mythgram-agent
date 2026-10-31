import type {
  KnowledgeFile,
  KnowledgeRuntime,
  ToolContext,
  ToolResult,
} from "./tools/types.js";

/**
 * Virtual root every knowledge path lives under (used only for display/labels). The knowledge base
 * is a file-tree of durable reference material the user (or the agent) curates. Unlike memory it
 * has NO pre-added files and NO character limits — it starts empty and only exists once the user
 * adds files (manually, by uploading files/folders, or by fetching a URL) in the Knowledge popup.
 */
export const KNOWLEDGE_ROOT = "knowledge/";

/**
 * Build the KnowledgeRuntime bound to a single main-agent turn. Injected into the ToolContext so
 * the knowledge_* tools can list/read/create/edit/delete knowledge files. Knowledge lives in the
 * SQLite database (and browser runtime state) and travels with each turn; the runtime keeps a per-turn mutable
 * snapshot so reads/writes within the same turn stay consistent, and emits `knowledge_updated` on
 * every mutation so the frontend persists the change back to the browser.
 */
export function createKnowledgeRuntime(initial: KnowledgeFile[]): KnowledgeRuntime {
  const runner = new KnowledgeRunner(initial);
  return {
    get files(): KnowledgeFile[] {
      return runner.list();
    },
    firstMessageContext: () => runner.firstMessageContext(),
    list: () => runner.opList(),
    search: (query) => runner.opSearch(query),
    read: (path, options) => runner.opRead(path, options),
    create: (path, content, ctx) => runner.opCreate(path, content, ctx),
    edit: (path, oldStr, newStr, ctx) => runner.opEdit(path, oldStr, newStr, ctx),
    remove: (path, ctx) => runner.opDelete(path, ctx),
  };
}

/** Options accepted by knowledge_read for incremental / annotated reads. */
export interface KnowledgeReadOptions {
  limit?: number;
  offset?: number;
  returnLineNumber?: boolean;
}

class KnowledgeRunner {
  private current: KnowledgeFile[];

  constructor(initial: KnowledgeFile[]) {
    this.current = normalizeKnowledgeFiles(initial);
  }

  /** Immutable copy of the current knowledge files. */
  list(): KnowledgeFile[] {
    return this.current.map((file) => ({ ...file }));
  }

  /**
   * The context block appended to the user's FIRST message of the conversation — but ONLY when the
   * user actually has knowledge files. It does NOT dump the contents; it tells the agent a curated
   * knowledge base exists and to discover/read it with the knowledge tools. Returns "" when empty.
   */
  firstMessageContext(): string {
    if (this.current.length === 0) return "";
    const count = this.current.length;
    const preview = this.current
      .slice(0, 20)
      .map((f) => `- ${KNOWLEDGE_ROOT}${f.path}`)
      .join("\n");
    const more = count > 20 ? `\n- …and ${count - 20} more` : "";
    return [
      "<knowledge_base>",
      `The user has a persistent knowledge base containing ${count} file${count === 1 ? "" : "s"} of`,
      "durable reference material (docs, notes, specs, data) they curated for you. Treat it as an",
      "authoritative source for this user's context. Before answering anything that could depend on",
      "it, call `knowledge_list` to see the available files, then `knowledge_read` to load the ones",
      "relevant to the task. You can also `knowledge_create`, `knowledge_edit`, and `knowledge_delete`",
      "to keep it accurate. This notice appears only once, here at the start of the conversation.",
      "",
      "Available knowledge files:",
      `${preview}${more}`,
      "</knowledge_base>",
    ].join("\n");
  }

  // ---- Operations ---------------------------------------------------------

  opList(): ToolResult {
    const files = this.current.map((file) => ({
      path: file.path,
      chars: file.content.length,
      lines: countLines(file.content),
    }));
    return {
      ok: true,
      data: {
        count: files.length,
        files,
        tree: buildTree(this.current.map((f) => f.path)),
        message:
          files.length === 0
            ? "The knowledge base is empty. Use knowledge_create to add a new knowledge file."
            : "Use knowledge_read with an exact path to load a file's contents.",
      },
    };
  }

  /**
   * knowledge_search — scan every knowledge file for the natural-language query and return the
   * matching file paths together with each matching 1-based line number AND that line's content.
   * Every result carries a `matches` array of `{ line, content }` plus a ready-to-read `preview` that
   * renders the hits as `LINE <n>: <content>` so the agent immediately sees the matched text;
   * knowledge_read is then only needed to load surrounding context.
   */
  opSearch(rawQuery: unknown): ToolResult {
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (query.length === 0) {
      return {
        ok: false,
        error: {
          code: "knowledge_search_query_required",
          message: "knowledge_search requires a non-empty natural-language `query` string.",
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
          path: `${KNOWLEDGE_ROOT}${file.path}`,
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
            ? "No knowledge files matched the query. Try knowledge_list to browse, or a broader query."
            : "Each result lists the file path and its matching lines as `LINE <n>: <content>` (see the " +
              "`matches` array and the `preview` string). Use knowledge_read with a path (and " +
              "offset/limit around those lines) to load surrounding context.",
      },
    };
  }

  opRead(rawPath: string, options?: KnowledgeReadOptions): ToolResult {
    const norm = normalizeKnowledgePath(rawPath);
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
        line_count: slice.length,
        total_lines: totalLines,
        first_line: slice.length > 0 ? startIndex + 1 : null,
        last_line: slice.length > 0 ? startIndex + slice.length : null,
        truncated: endIndex < totalLines || startIndex > 0,
      },
    };
  }

  opCreate(rawPath: string, content: unknown, ctx: ToolContext): ToolResult {
    const norm = normalizeKnowledgePath(rawPath);
    if (norm.error) return invalidPath(norm.error);
    if (typeof content !== "string") {
      return {
        ok: false,
        error: {
          code: "knowledge_content_required",
          message:
            "knowledge_create requires a string `content` field containing the complete file contents.",
        },
      };
    }

    if (this.findIndex(norm.path) !== -1) {
      return {
        ok: false,
        error: {
          code: "knowledge_already_exists",
          message:
            `A knowledge file already exists at "${KNOWLEDGE_ROOT}${norm.path}". Use knowledge_edit to ` +
            "modify it, or knowledge_create with a different path. Do not overwrite existing knowledge " +
            "blindly — read it first with knowledge_read.",
          path: norm.path,
        },
      };
    }

    this.current.push({ path: norm.path, content });
    this.emit(ctx);
    return {
      ok: true,
      data: {
        path: norm.path,
        created: true,
        chars: content.length,
        line_count: countLines(content),
        message: `Knowledge file "${KNOWLEDGE_ROOT}${norm.path}" created (${content.length} chars).`,
      },
    };
  }

  opEdit(rawPath: string, oldStr: unknown, newStr: unknown, ctx: ToolContext): ToolResult {
    const norm = normalizeKnowledgePath(rawPath);
    if (norm.error) return invalidPath(norm.error);
    if (typeof oldStr !== "string" || oldStr.length === 0) {
      return {
        ok: false,
        error: {
          code: "knowledge_old_str_required",
          message:
            "knowledge_edit requires a non-empty `old_str` that matches text in the file exactly.",
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
          code: "knowledge_old_str_not_found",
          message:
            `The provided old_str was not found in "${KNOWLEDGE_ROOT}${file.path}". It must match the ` +
            "existing text exactly, including whitespace and line breaks. Read the file again with " +
            "knowledge_read and retry with an exact snippet.",
        },
      };
    }
    if (occurrences > 1) {
      return {
        ok: false,
        error: {
          code: "knowledge_old_str_not_unique",
          message:
            `The provided old_str appears ${occurrences} times in "${KNOWLEDGE_ROOT}${file.path}". Provide ` +
            "a larger, unique snippet so exactly one location is replaced.",
          occurrences,
        },
      };
    }

    const nextContent = file.content.replace(oldStr, replacement);
    this.upsert(file.path, nextContent);
    this.emit(ctx);
    return {
      ok: true,
      data: {
        path: file.path,
        chars: nextContent.length,
        line_count: countLines(nextContent),
        message: `Knowledge file "${KNOWLEDGE_ROOT}${file.path}" edited (${nextContent.length} chars).`,
      },
    };
  }

  opDelete(rawPath: string, ctx: ToolContext): ToolResult {
    const norm = normalizeKnowledgePath(rawPath);
    if (norm.error) return invalidPath(norm.error);

    const index = this.findIndex(norm.path);
    if (index === -1) return notFound(norm.path, this.current);

    const [removed] = this.current.splice(index, 1);
    this.emit(ctx);
    return {
      ok: true,
      data: {
        path: removed?.path ?? norm.path,
        deleted: true,
        message: `Knowledge file "${KNOWLEDGE_ROOT}${removed?.path ?? norm.path}" deleted.`,
      },
    };
  }

  // ---- Internal helpers ---------------------------------------------------

  private emit(ctx: ToolContext): void {
    ctx.emit?.("knowledge_updated", { knowledgeFiles: this.list() });
  }

  private find(path: string): KnowledgeFile | undefined {
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

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split("\n").length;
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
 * line's content. Blank lines are skipped. Exported so both the knowledge_search runtime and its
 * tests share one matcher.
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
 * Validate and normalize a client/LLM-supplied knowledge path to a clean relative path under the
 * knowledge root. Accepts "docs.md", "/knowledge/docs.md", "knowledge/api/docs.md", etc. Rejects
 * empty paths, "." / ".." segments (traversal), and absolute escapes.
 */
export function normalizeKnowledgePath(
  raw: unknown,
): { path: string; error?: undefined } | { path: ""; error: string } {
  let p = String(raw ?? "").trim().replace(/\\/g, "/");
  if (!p) {
    return {
      path: "",
      error: 'A knowledge `knowledge_path` is required (e.g. "docs.md" or "api/reference.md").',
    };
  }
  p = p.replace(/^\.\//, "").replace(/^\/+/, "");
  if (/^knowledge\//i.test(p)) p = p.slice("knowledge/".length);
  p = p.replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/+$/, "");
  if (!p) {
    return { path: "", error: "The knowledge `knowledge_path` cannot be empty or the knowledge root itself." };
  }

  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      return {
        path: "",
        error:
          'Invalid knowledge path. Use a simple relative path under /knowledge/ such as "docs.md" or ' +
          '"api/reference.md" — no "..", ".", or absolute segments are allowed.',
      };
    }
  }
  return { path: p };
}

/**
 * Defensively coerce arbitrary client input into a well-typed knowledge file list. Non-arrays become
 * an empty list; invalid/duplicate/traversing paths are dropped. There are NO pre-added files, so an
 * empty input stays empty. Never throws.
 */
export function normalizeKnowledgeFiles(raw: unknown): KnowledgeFile[] {
  const out: KnowledgeFile[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const norm = normalizeKnowledgePath(record.path);
      if (norm.error) continue;
      const key = norm.path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        path: norm.path,
        content: typeof record.content === "string" ? record.content : "",
      });
    }
  }

  return out;
}

/** A structured error for a path that failed validation. */
function invalidPath(message: string): ToolResult {
  return { ok: false, error: { code: "knowledge_invalid_path", message } };
}

/** A structured "file not found" error listing what IS available so the model can self-correct. */
function notFound(path: string, files: KnowledgeFile[]): ToolResult {
  return {
    ok: false,
    error: {
      code: "knowledge_not_found",
      message:
        `No knowledge file exists at "${KNOWLEDGE_ROOT}${path}". Call knowledge_list to see the exact ` +
        "available paths, then retry with one of them (or use knowledge_create to add it).",
      available_paths: files.map((f) => f.path),
    },
  };
}

/** Build a compact ASCII tree of the knowledge folder from a flat list of relative paths. */
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

  const lines: string[] = ["knowledge/"];
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
