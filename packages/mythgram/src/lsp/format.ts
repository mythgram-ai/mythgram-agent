import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  LspCall,
  LspExecution,
  LspHierarchyItem,
  LspLocation,
  LspSymbol,
} from "./types.js";

/** Upper bounds keep tool results inside a reasonable context budget. */
export const MAX_LSP_LOCATIONS = 100;
export const MAX_LSP_SYMBOLS = 200;
export const MAX_LSP_CALLS = 100;

const MAX_PREVIEW_CHARS = 240;
const MAX_HOVER_CHARS = 6_000;

interface NormalizedRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

const SYMBOL_KINDS: Readonly<Record<number, string>> = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParameter",
};

/** Convert a `file://` URI to a filesystem path (null for other schemes). */
export function uriToPath(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri.startsWith("file:")) return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

/** Workspace-relative display path with POSIX separators. */
export function displayPath(workspaceRoot: string, absolutePath: string): string {
  const rel = path.relative(path.resolve(workspaceRoot), absolutePath);
  if (!rel || rel === "") return ".";
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return absolutePath.split(path.sep).join("/");
  }
  return rel.split(path.sep).join("/");
}

/** Format the raw result of the given operation into model/UI friendly data. */
export async function formatLspExecution(
  execution: LspExecution,
): Promise<Record<string, unknown>> {
  const cache = new SourceCache();
  const base: Record<string, unknown> = {
    operation: execution.operation,
    file_path: execution.relativePath,
    line: execution.line,
    character: execution.character,
    language_id: execution.languageId,
    server: execution.server,
    ...(execution.query ? { query: execution.query } : {}),
  };
  const header =
    `LSP ${execution.operation} — ${execution.relativePath}:` +
    `${execution.line}:${execution.character} (${execution.server.name})`;

  switch (execution.operation) {
    case "goToDefinition":
    case "findReferences":
    case "goToImplementation": {
      const { locations, truncated } = await normalizeLocations(
        execution.raw,
        execution.workspaceRoot,
        cache,
      );
      return {
        ...base,
        count: locations.length,
        truncated,
        locations,
        formatted: joinFormatted(header, locations.map(formatLocation)),
      };
    }

    case "hover": {
      const raw = asRecord(execution.raw);
      const contents = hoverText(raw.contents);
      const range = normalizeRange(raw.range);
      return {
        ...base,
        count: contents ? 1 : 0,
        contents,
        ...(range ? { range } : {}),
        formatted: joinFormatted(
          header,
          [contents || "No hover information available."],
        ),
      };
    }

    case "documentSymbol": {
      const { symbols, truncated } = await normalizeSymbols(
        execution.raw,
        execution.workspaceRoot,
        execution.absolutePath,
      );
      return {
        ...base,
        count: symbols.length,
        truncated,
        symbols,
        formatted: joinFormatted(header, symbols.map(formatSymbol)),
      };
    }

    case "workspaceSymbol": {
      const { symbols, truncated } = await normalizeSymbols(
        execution.raw,
        execution.workspaceRoot,
        execution.absolutePath,
      );
      return {
        ...base,
        count: symbols.length,
        truncated,
        symbols,
        formatted: joinFormatted(header, symbols.map(formatSymbol)),
      };
    }

    case "prepareCallHierarchy": {
      const hierarchy = await normalizeHierarchy(execution.raw, execution.workspaceRoot);
      return {
        ...base,
        count: hierarchy.length,
        hierarchy,
        formatted: joinFormatted(header, hierarchy.map(formatHierarchy)),
      };
    }

    case "incomingCalls":
    case "outgoingCalls": {
      const raw = asRecord(execution.raw);
      const hierarchy = await normalizeHierarchy(raw.prepareItems, execution.workspaceRoot);
      const direction = execution.operation === "incomingCalls" ? "incoming" : "outgoing";
      const { calls, truncated } = await normalizeCalls(
        raw.calls,
        execution.workspaceRoot,
        direction,
      );
      return {
        ...base,
        count: calls.length,
        truncated,
        hierarchy,
        calls,
        formatted: joinFormatted(header, calls.map(formatCall)),
      };
    }

    default:
      return {
        ...base,
        formatted: `${header}\nNo results.`,
      };
  }
}

/* ------------------------------------------------------------------ locations */

async function normalizeLocations(
  raw: unknown,
  workspaceRoot: string,
  cache: SourceCache,
): Promise<{ locations: LspLocation[]; truncated: boolean }> {
  const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const locations: LspLocation[] = [];

  for (const item of items) {
    if (locations.length >= MAX_LSP_LOCATIONS) break;
    const location = await locationFromRaw(item, workspaceRoot, cache);
    if (location) locations.push(location);
  }

  return { locations, truncated: items.length > MAX_LSP_LOCATIONS };
}

async function locationFromRaw(
  raw: unknown,
  workspaceRoot: string,
  cache: SourceCache,
): Promise<LspLocation | null> {
  const record = asRecord(raw);
  const uri =
    typeof record.targetUri === "string"
      ? record.targetUri
      : typeof record.uri === "string"
        ? record.uri
        : null;
  if (!uri) return null;

  const absolutePath = uriToPath(uri);
  if (!absolutePath) return null;

  const range =
    normalizeRange(record.targetSelectionRange) ??
    normalizeRange(record.targetRange) ??
    normalizeRange(record.range);
  const start = range?.start ?? { line: 1, character: 1 };
  const end = range?.end ?? start;
  const preview = await cache.line(absolutePath, start.line);

  return {
    path: displayPath(workspaceRoot, absolutePath),
    line: start.line,
    character: start.character,
    end_line: end.line,
    end_character: end.character,
    ...(preview !== undefined ? { preview } : {}),
  };
}

/* ------------------------------------------------------------------ hover */

function hoverText(contents: unknown): string {
  const parts = Array.isArray(contents) ? contents : contents == null ? [] : [contents];
  const pieces: string[] = [];

  for (const part of parts) {
    if (typeof part === "string") {
      pieces.push(part);
      continue;
    }
    const record = asRecord(part);
    if (typeof record.value !== "string") continue;
    if (typeof record.language === "string" && record.language) {
      pieces.push(`\`\`\`${record.language}\n${record.value}\n\`\`\``);
    } else {
      pieces.push(record.value);
    }
  }

  let text = pieces.join("\n\n").trim();
  if (text.length > MAX_HOVER_CHARS) {
    text = `${text.slice(0, MAX_HOVER_CHARS)}\n… (truncated)`;
  }
  return text;
}

/* ------------------------------------------------------------------ symbols */

async function normalizeSymbols(
  raw: unknown,
  workspaceRoot: string,
  fallbackPath: string,
): Promise<{ symbols: LspSymbol[]; truncated: boolean }> {
  const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const symbols: LspSymbol[] = [];
  let truncated = false;

  const visit = (node: unknown, depth: number): void => {
    if (symbols.length >= MAX_LSP_SYMBOLS) {
      truncated = true;
      return;
    }
    const record = asRecord(node);
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) return;

    const kind = symbolKindName(record.kind);
    const detail =
      typeof record.detail === "string" && record.detail.trim()
        ? record.detail.trim()
        : undefined;

    let absolutePath = fallbackPath;
    let rangeSource: unknown = record.selectionRange ?? record.range;
    const location = record.location;

    if (typeof location === "string") {
      absolutePath = uriToPath(location) ?? absolutePath;
    } else if (location && typeof location === "object" && !Array.isArray(location)) {
      const loc = location as Record<string, unknown>;
      if (typeof loc.uri === "string") {
        absolutePath = uriToPath(loc.uri) ?? absolutePath;
      }
      if (loc.range) rangeSource = loc.range;
    } else if (typeof record.uri === "string") {
      absolutePath = uriToPath(record.uri) ?? absolutePath;
    }

    const start = normalizeRange(rangeSource)?.start ?? { line: 1, character: 1 };
    symbols.push({
      name,
      kind,
      ...(detail ? { detail } : {}),
      path: displayPath(workspaceRoot, absolutePath),
      line: start.line,
      character: start.character,
      ...(depth > 0 ? { depth } : {}),
    });

    const children = Array.isArray(record.children) ? record.children : [];
    for (const child of children) visit(child, depth + 1);
  };

  for (const item of items) visit(item, 0);
  return { symbols, truncated };
}

/** Map an LSP SymbolKind number to a readable label. */
export function symbolKindName(kind: unknown): string {
  if (typeof kind === "string" && kind.trim()) return kind.trim();
  const numeric = typeof kind === "number" ? kind : Number(kind);
  if (!Number.isFinite(numeric)) return "Symbol";
  return SYMBOL_KINDS[numeric] ?? "Symbol";
}

/* ------------------------------------------------------------------ calls */

async function normalizeHierarchy(
  raw: unknown,
  workspaceRoot: string,
): Promise<LspHierarchyItem[]> {
  const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const hierarchy: LspHierarchyItem[] = [];
  for (const item of items) {
    if (hierarchy.length >= MAX_LSP_SYMBOLS) break;
    const normalized = hierarchyItemFromRaw(item, workspaceRoot);
    if (normalized) hierarchy.push(normalized);
  }
  return hierarchy;
}

function hierarchyItemFromRaw(
  raw: unknown,
  workspaceRoot: string,
): LspHierarchyItem | null {
  const record = asRecord(raw);
  if (typeof record.uri !== "string") return null;
  const absolutePath = uriToPath(record.uri);
  if (!absolutePath) return null;

  const start =
    normalizeRange(record.selectionRange)?.start ??
    normalizeRange(record.range)?.start ??
    { line: 1, character: 1 };
  const name =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : "(anonymous)";
  const detail =
    typeof record.detail === "string" && record.detail.trim()
      ? record.detail.trim()
      : undefined;

  return {
    name,
    kind: symbolKindName(record.kind),
    ...(detail ? { detail } : {}),
    path: displayPath(workspaceRoot, absolutePath),
    line: start.line,
    character: start.character,
  };
}

async function normalizeCalls(
  raw: unknown,
  workspaceRoot: string,
  direction: "incoming" | "outgoing",
): Promise<{ calls: LspCall[]; truncated: boolean }> {
  const items = Array.isArray(raw) ? raw : [];
  const calls: LspCall[] = [];

  for (const item of items) {
    if (calls.length >= MAX_LSP_CALLS) break;
    const record = asRecord(item);
    const target = direction === "incoming" ? record.from : record.to;
    const hierarchy = hierarchyItemFromRaw(target, workspaceRoot);
    if (!hierarchy) continue;
    calls.push({ ...hierarchy, direction });
  }

  return { calls, truncated: items.length > MAX_LSP_CALLS };
}

/* ------------------------------------------------------------------ helpers */

function normalizeRange(raw: unknown): NormalizedRange | undefined {
  const record = asRecord(raw);
  const start = asRecord(record.start);
  if (!record.start || typeof record.start !== "object") return undefined;
  const endSource = record.end && typeof record.end === "object" ? record.end : record.start;
  const end = asRecord(endSource);

  return {
    start: { line: toOneBased(start.line), character: toOneBased(start.character) },
    end: { line: toOneBased(end.line), character: toOneBased(end.character) },
  };
}

function toOneBased(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 1;
  return Math.floor(numeric) + 1;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatLocation(location: LspLocation): string {
  const head = `${location.path}:${location.line}:${location.character}`;
  return location.preview ? `${head}\n  ${location.preview}` : head;
}

function formatSymbol(symbol: LspSymbol): string {
  const indent = "  ".repeat(symbol.depth ?? 0);
  const detail = symbol.detail ? ` — ${symbol.detail}` : "";
  const location = symbol.path
    ? ` (${symbol.path}:${symbol.line}:${symbol.character})`
    : ` (${symbol.line}:${symbol.character})`;
  return `${indent}${symbol.kind} ${symbol.name}${detail}${location}`;
}

function formatHierarchy(item: LspHierarchyItem): string {
  const detail = item.detail ? ` — ${item.detail}` : "";
  return `${item.kind} ${item.name}${detail} — ${item.path}:${item.line}:${item.character}`;
}

function formatCall(call: LspCall): string {
  const detail = call.detail ? ` — ${call.detail}` : "";
  return (
    `${call.direction} · ${call.kind} ${call.name}${detail} — ` +
    `${call.path}:${call.line}:${call.character}`
  );
}

function joinFormatted(header: string, lines: string[]): string {
  return [header, ...(lines.length > 0 ? lines : ["No results."])].join("\n");
}

/** Lazily-read source lines for result previews (one file read per operation). */
class SourceCache {
  private readonly files = new Map<string, Promise<string[] | null>>();

  async line(filePath: string, line: number): Promise<string | undefined> {
    let pending = this.files.get(filePath);
    if (!pending) {
      pending = readFile(filePath, "utf8")
        .then((text) => text.split(/\r\n|\r|\n/))
        .catch(() => null);
      this.files.set(filePath, pending);
    }

    const lines = await pending;
    if (!lines || line < 1 || line > lines.length) return undefined;
    const text = lines[line - 1] ?? "";
    return text.length > MAX_PREVIEW_CHARS
      ? `${text.slice(0, MAX_PREVIEW_CHARS)}…`
      : text;
  }
}