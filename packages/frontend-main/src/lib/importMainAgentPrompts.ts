import type { MainAgentPrompt } from "@/types";

export const PROMPT_NAME_MAX = 70;
export const PROMPT_DESC_MAX = 300;
export const IMPORT_CONFIG_FILE_NAME = "config.json";
/** Max single prompt-file size accepted on import (5 MB — prompts are markdown text). */
export const MAX_PROMPT_FILE_BYTES = 5 * 1024 * 1024;

/** One validated prompt ready to be added to the store. */
export interface ImportedPromptDraft {
  name: string;
  description: string;
  content: string;
  /** Resolved prompt file (for display), e.g. "custom_system_prompts/my_custom_prompt/system_prompt.md". */
  filePath: string;
}

/** One entry that could not be imported, with a human-readable reason. */
export interface PromptImportError {
  /** Index in the config array (0-based) when known, else -1. */
  index: number;
  name: string;
  message: string;
}

export interface ParsePromptsImportResult {
  drafts: ImportedPromptDraft[];
  errors: PromptImportError[];
  /** The requested active prompt name from config.json (trimmed), or null when absent. */
  activeName: string | null;
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
 * Parse + validate a custom-system-prompts config.json payload against the uploaded files.
 *
 * Accepted shape (all spellings tolerated where noted):
 * - prompt list: "custom_system_prompts" (or "customSystemPrompts" / "prompts" / "system_prompts" / "systemPrompts")
 * - entry name: "name" (required, unique, 70 chars max)
 * - entry description: "description" (or "desc"; optional, 300 chars max)
 * - entry file: "system_prompt_path" (or "systemPromptPath" / "path" / "file") — resolved
 *   against the config.json directory, sandboxed to the uploaded files
 * - prompt to activate: "active_system_prompt" (or "activeSystemPrompt" / "active") — must
 *   name one of the defined prompts
 */
export async function parseMainAgentPromptsImport(
  configText: string,
  configDisplayPath: string,
  filesByKey: Map<string, File>,
): Promise<ParsePromptsImportResult> {
  const configDir = dirOf(configDisplayPath);
  const errors: PromptImportError[] = [];
  const drafts: ImportedPromptDraft[] = [];

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
      activeName: null,
      configPath: configDisplayPath,
    };
  }

  const root: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  const rawList = Array.isArray(root.custom_system_prompts)
    ? root.custom_system_prompts
    : Array.isArray(root.customSystemPrompts)
      ? root.customSystemPrompts
      : Array.isArray(root.system_prompts)
        ? root.system_prompts
        : Array.isArray(root.systemPrompts)
          ? root.systemPrompts
          : Array.isArray(root.prompts)
            ? root.prompts
            : null;
  if (!rawList) {
    return {
      drafts,
      errors: [
        {
          index: -1,
          name: "",
          message: `No prompt list found. Add a "custom_system_prompts" array to config.json.`,
        },
      ],
      activeName: null,
      configPath: configDisplayPath,
    };
  }
  if (rawList.length === 0) {
    return {
      drafts,
      errors: [{ index: -1, name: "", message: "config.json contains no prompts to import." }],
      activeName: null,
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
    const nameRaw = str(entry.name);
    const descRaw = str(entry.description ?? entry.desc);
    const pathRefRaw = str(
      entry.system_prompt_path ?? entry.systemPromptPath ?? entry.path ?? entry.file,
    );

    const label = nameRaw.trim() || `Entry #${i + 1}`;

    const name = nameRaw.trim();
    if (!name) {
      errors.push({ index: i, name: label, message: "A prompt name is required." });
      continue;
    }
    if (name.length > PROMPT_NAME_MAX) {
      errors.push({ index: i, name, message: `Name must be ${PROMPT_NAME_MAX} characters or fewer.` });
      continue;
    }
    if (seenInFile.has(name.toLowerCase())) {
      errors.push({ index: i, name, message: `Duplicate name "${name}" inside config.json — only the first was kept.` });
      continue;
    }

    if (descRaw.trim().length > PROMPT_DESC_MAX) {
      errors.push({ index: i, name, message: `Description must be ${PROMPT_DESC_MAX} characters or fewer.` });
      continue;
    }

    if (!pathRefRaw.trim()) {
      errors.push({ index: i, name, message: "A prompt file path is required (system_prompt_path)." });
      continue;
    }
    const fileKey = resolveFileKey(configDir, pathRefRaw);
    if (!fileKey) {
      errors.push({ index: i, name, message: `Prompt path "${pathRefRaw.trim()}" escapes the uploaded folder.` });
      continue;
    }
    const file = filesByKey.get(fileKey.toLowerCase());
    if (!file) {
      errors.push({
        index: i,
        name,
        message: `Prompt file not found: "${pathRefRaw.trim()}" (looked for "${fileKey}"). Upload the whole folder so prompt files are included.`,
      });
      continue;
    }
    if (file.size > MAX_PROMPT_FILE_BYTES) {
      errors.push({ index: i, name, message: `Prompt file "${fileKey}" is too large (max 5 MB).` });
      continue;
    }
    let content = "";
    try {
      content = (await file.text()).trim();
    } catch {
      errors.push({ index: i, name, message: `Could not read prompt file "${fileKey}".` });
      continue;
    }
    if (!content) {
      errors.push({ index: i, name, message: `Prompt file "${fileKey}" is empty.` });
      continue;
    }

    seenInFile.add(name.toLowerCase());
    drafts.push({
      name,
      description: descRaw.trim(),
      content,
      filePath: fileKey,
    });
  }

  // The prompt to activate must name one of the defined prompts.
  const activeRaw = str(root.active_system_prompt ?? root.activeSystemPrompt ?? root.active);
  const activeName = activeRaw.trim() ? activeRaw.trim() : null;
  if (activeName && !seenInFile.has(activeName.toLowerCase())) {
    errors.push({
      index: -1,
      name: activeName,
      message: `Unknown prompt name "${activeName}" in "active_system_prompt" — no prompt with that name is defined in config.json.`,
    });
  }

  return { drafts, errors, activeName, configPath: configDisplayPath };
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

/** Split drafts into importable vs name-clashing with existing prompts. */
export function partitionAgainstExisting(
  drafts: ImportedPromptDraft[],
  existing: MainAgentPrompt[],
): { fresh: ImportedPromptDraft[]; clashing: ImportedPromptDraft[] } {
  const taken = new Set(existing.map((p) => p.name.trim().toLowerCase()));
  const fresh: ImportedPromptDraft[] = [];
  const clashing: ImportedPromptDraft[] = [];
  for (const d of drafts) {
    if (taken.has(d.name.toLowerCase())) clashing.push(d);
    else {
      fresh.push(d);
      taken.add(d.name.toLowerCase());
    }
  }
  return { fresh, clashing };
}
