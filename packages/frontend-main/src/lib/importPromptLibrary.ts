import type { PromptLibraryItem } from "@/types";

export const IMPORT_CONFIG_FILE_NAME = "config.json";
/** Max single prompt-file size accepted on import (5 MB — prompts are markdown text). */
export const MAX_PROMPT_FILE_BYTES = 5 * 1024 * 1024;

/** One validated prompt ready to be added to the library. */
export interface ImportedLibraryPromptDraft {
  title: string;
  description: string;
  content: string;
  /** Resolved prompt file (for display), e.g. "prompts/code_review.md". */
  filePath: string;
}

/** One entry that could not be imported, with a human-readable reason. */
export interface PromptLibraryImportError {
  /** Index in the config array (0-based) when known, else -1. */
  index: number;
  name: string;
  message: string;
}

export interface ParsePromptLibraryImportResult {
  drafts: ImportedLibraryPromptDraft[];
  errors: PromptLibraryImportError[];
  /** Display path of the config file used, e.g. "my-prompts/config.json". */
  configPath: string;
}

function dirOf(posixPath: string): string {
  const idx = posixPath.lastIndexOf("/");
  return idx === -1 ? "" : posixPath.slice(0, idx);
}

/** Normalize a posix path, resolving "." and ".." segments (no leading slash). */
function normalizePosix(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Resolve a prompt file reference against the directory containing config.json.
 * Absolute-looking refs are treated as relative to the uploaded root so imports
 * stay sandboxed to the selected files. Returns null when the ref escapes the root.
 */
function resolveFileKey(configDir: string, rawRef: string): string | null {
  let ref = rawRef.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  ref = ref.replace(/^\/+/, "");
  ref = ref.replace(/^[A-Za-z]:\//, "");
  const joined = configDir ? `${configDir}/${ref}` : ref;
  const normalized = normalizePosix(joined);
  if (!normalized) return null;
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Parse + validate a prompt-library config.json payload against the uploaded files.
 *
 * Accepted shape (all spellings tolerated where noted):
 * - prompt list: "prompts" (or "custom_prompts" / "customPrompts" / "library" / "items")
 * - entry name: "name" (or "title") — required, unique; stored as the library title
 * - entry description: "description" (or "desc") — optional
 * - entry file: "prompt_path" (or "promptPath" / "path" / "file") — resolved
 *   against the config.json directory, sandboxed to the uploaded files
 */
export async function parsePromptLibraryImport(
  configText: string,
  configDisplayPath: string,
  filesByKey: Map<string, File>,
): Promise<ParsePromptLibraryImportResult> {
  const configDir = dirOf(configDisplayPath);
  const errors: PromptLibraryImportError[] = [];
  const drafts: ImportedLibraryPromptDraft[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(configText);
  } catch (e) {
    return {
      drafts,
      errors: [
        {
          index: -1,
          name: "",
          message: `config.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      configPath: configDisplayPath,
    };
  }

  const root: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  const rawList = Array.isArray(root.prompts)
    ? root.prompts
    : Array.isArray(root.custom_prompts)
      ? root.custom_prompts
      : Array.isArray(root.customPrompts)
        ? root.customPrompts
        : Array.isArray(root.library)
          ? root.library
          : Array.isArray(root.items)
            ? root.items
            : null;
  if (!rawList) {
    return {
      drafts,
      errors: [
        {
          index: -1,
          name: "",
          message: `No prompt list found. Add a "prompts" array to config.json.`,
        },
      ],
      configPath: configDisplayPath,
    };
  }
  if (rawList.length === 0) {
    return {
      drafts,
      errors: [{ index: -1, name: "", message: "config.json contains no prompts to import." }],
      configPath: configDisplayPath,
    };
  }

  const seenInFile = new Set<string>();

  for (let i = 0; i < rawList.length; i += 1) {
    const entry = rawList[i];
    if (!isRecord(entry)) {
      errors.push({ index: i, name: "", message: `Entry #${i + 1} is not an object and was skipped.` });
      continue;
    }
    const nameRaw = str(entry.name ?? entry.title);
    const descRaw = str(entry.description ?? entry.desc);
    const pathRefRaw = str(entry.prompt_path ?? entry.promptPath ?? entry.path ?? entry.file);

    const label = nameRaw.trim() || `Entry #${i + 1}`;

    const title = nameRaw.trim();
    if (!title) {
      errors.push({ index: i, name: label, message: "A prompt name is required." });
      continue;
    }
    if (seenInFile.has(title.toLowerCase())) {
      errors.push({ index: i, name: title, message: `Duplicate name "${title}" inside config.json — only the first was kept.` });
      continue;
    }

    if (!pathRefRaw.trim()) {
      errors.push({ index: i, name: title, message: "A prompt file path is required (prompt_path)." });
      continue;
    }
    const fileKey = resolveFileKey(configDir, pathRefRaw);
    if (!fileKey) {
      errors.push({ index: i, name: title, message: `Prompt path "${pathRefRaw.trim()}" escapes the uploaded folder.` });
      continue;
    }
    const file = filesByKey.get(fileKey.toLowerCase());
    if (!file) {
      errors.push({
        index: i,
        name: title,
        message: `Prompt file not found: "${pathRefRaw.trim()}" (looked for "${fileKey}"). Upload the whole folder so prompt files are included.`,
      });
      continue;
    }
    if (file.size > MAX_PROMPT_FILE_BYTES) {
      errors.push({ index: i, name: title, message: `Prompt file "${fileKey}" is too large (max 5 MB).` });
      continue;
    }
    let content = "";
    try {
      content = (await file.text()).trim();
    } catch {
      errors.push({ index: i, name: title, message: `Could not read prompt file "${fileKey}".` });
      continue;
    }
    if (!content) {
      errors.push({ index: i, name: title, message: `Prompt file "${fileKey}" is empty.` });
      continue;
    }

    seenInFile.add(title.toLowerCase());
    drafts.push({ title, description: descRaw.trim(), content, filePath: fileKey });
  }

  return { drafts, errors, configPath: configDisplayPath };
}

/** Build the lookup map + locate config.json within a FileList (files and/or folder). */
export function indexUploadedFiles(list: FileList | File[]): {
  filesByKey: Map<string, File>;
  configFile: File | null;
  configPath: string | null;
} {
  const files = Array.from(list as ArrayLike<File>) as Array<File & { webkitRelativePath?: string }>;
  const filesByKey = new Map<string, File>();
  for (const f of files) {
    const rel = (f.webkitRelativePath ?? "").trim();
    const key = normalizePosix((rel ? rel.replace(/\\/g, "/") : f.name)).toLowerCase();
    if (!key) continue;
    if (!filesByKey.has(key)) filesByKey.set(key, f);
  }
  const candidates: Array<{ key: string; file: File; depth: number }> = [];
  for (const [key, file] of filesByKey) {
    const base = key.split("/").pop() ?? "";
    if (base === IMPORT_CONFIG_FILE_NAME) {
      candidates.push({ key, file, depth: key.split("/").length });
    }
  }
  candidates.sort((a, b) => a.depth - b.depth);
  const best = candidates[0];
  if (!best) return { filesByKey, configFile: null, configPath: null };
  const raw = best.file as File & { webkitRelativePath?: string };
  const display = normalizePosix(((raw.webkitRelativePath ?? "").trim().replace(/\\/g, "/") || raw.name));
  return { filesByKey, configFile: best.file, configPath: display };
}

/** Split drafts into importable vs title-clashing with existing library items. */
export function partitionAgainstExisting(
  drafts: ImportedLibraryPromptDraft[],
  existing: PromptLibraryItem[],
): { fresh: ImportedLibraryPromptDraft[]; clashing: ImportedLibraryPromptDraft[] } {
  const taken = new Set(existing.map((p) => p.title.trim().toLowerCase()));
  const fresh: ImportedLibraryPromptDraft[] = [];
  const clashing: ImportedLibraryPromptDraft[] = [];
  for (const d of drafts) {
    if (taken.has(d.title.toLowerCase())) clashing.push(d);
    else {
      fresh.push(d);
      taken.add(d.title.toLowerCase());
    }
  }
  return { fresh, clashing };
}
