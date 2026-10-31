import type { CustomTaskMode } from "@/types";

export const TASK_MODE_NAME_MAX = 70;
export const IMPORT_CONFIG_FILE_NAME = "config.json";
/** Max single prompt-file size accepted on import (5 MB — prompts are markdown text). */
export const MAX_TASK_MODE_FILE_BYTES = 5 * 1024 * 1024;

/** Names reserved for the built-in modes — never importable as custom modes. */
export const RESERVED_TASK_MODE_NAMES: readonly string[] = ["plan", "default"];

/** One validated task mode ready to be added to the store. */
export interface ImportedTaskModeDraft {
  name: string;
  prompt: string;
  /** Resolved prompt file (for display), e.g. "task_modes/research_mode/system_prompt.md". */
  filePath: string;
}

/** One entry that could not be imported, with a human-readable reason. */
export interface TaskModeImportError {
  /** Index in the config array (0-based) when known, else -1. */
  index: number;
  name: string;
  message: string;
}

export interface ParseTaskModesImportResult {
  drafts: ImportedTaskModeDraft[];
  errors: TaskModeImportError[];
  /** The requested active mode name from config.json (trimmed), or null when absent. */
  activeName: string | null;
  /** Display path of the config file used, e.g. "my-modes/config.json". */
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
 * Parse + validate a task-modes config.json payload against the uploaded files.
 *
 * Accepted shape (all spellings tolerated where noted):
 * - mode list: "task_modes" (or "taskModes" / "modes")
 * - entry name: "name" (required, unique, 70 chars max, must not be "plan"/"default")
 * - entry file: "system_prompt_path" (or "systemPromptPath" / "path" / "file") — resolved
 *   against the config.json directory, sandboxed to the uploaded files
 * - mode to activate: "active_task_mode" (or "activeTaskMode" / "active") — optional,
 *   must name one of the defined modes
 */
export async function parseTaskModesImport(
  configText: string,
  configDisplayPath: string,
  filesByKey: Map<string, File>,
): Promise<ParseTaskModesImportResult> {
  const configDir = dirOf(configDisplayPath);
  const errors: TaskModeImportError[] = [];
  const drafts: ImportedTaskModeDraft[] = [];

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
  const rawList = Array.isArray(root.task_modes)
    ? root.task_modes
    : Array.isArray(root.taskModes)
      ? root.taskModes
      : Array.isArray(root.modes)
        ? root.modes
        : null;
  if (!rawList) {
    return {
      drafts,
      errors: [
        {
          index: -1,
          name: "",
          message: `No mode list found. Add a "task_modes" array to config.json.`,
        },
      ],
      activeName: null,
      configPath: configDisplayPath,
    };
  }
  if (rawList.length === 0) {
    return {
      drafts,
      errors: [{ index: -1, name: "", message: "config.json contains no task modes to import." }],
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
    const pathRefRaw = str(
      entry.system_prompt_path ?? entry.systemPromptPath ?? entry.path ?? entry.file,
    );

    const label = nameRaw.trim() || `Entry #${i + 1}`;

    const name = nameRaw.trim();
    if (!name) {
      errors.push({ index: i, name: label, message: "A mode name is required." });
      continue;
    }
    if (name.length > TASK_MODE_NAME_MAX) {
      errors.push({ index: i, name, message: `Name must be ${TASK_MODE_NAME_MAX} characters or fewer.` });
      continue;
    }
    if (RESERVED_TASK_MODE_NAMES.includes(name.toLowerCase())) {
      errors.push({
        index: i,
        name,
        message: `"${name}" is reserved for the built-in modes — pick another name.`,
      });
      continue;
    }
    if (seenInFile.has(name.toLowerCase())) {
      errors.push({ index: i, name, message: `Duplicate name "${name}" inside config.json — only the first was kept.` });
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
    if (file.size > MAX_TASK_MODE_FILE_BYTES) {
      errors.push({ index: i, name, message: `Prompt file "${fileKey}" is too large (max 5 MB).` });
      continue;
    }
    let prompt = "";
    try {
      prompt = (await file.text()).trim();
    } catch {
      errors.push({ index: i, name, message: `Could not read prompt file "${fileKey}".` });
      continue;
    }
    if (!prompt) {
      errors.push({ index: i, name, message: `Prompt file "${fileKey}" is empty.` });
      continue;
    }

    seenInFile.add(name.toLowerCase());
    drafts.push({ name, prompt, filePath: fileKey });
  }

  // The mode to activate must name one of the defined modes.
  const activeRaw = str(root.active_task_mode ?? root.activeTaskMode ?? root.active);
  const activeName = activeRaw.trim() ? activeRaw.trim() : null;
  if (activeName && !seenInFile.has(activeName.toLowerCase())) {
    errors.push({
      index: -1,
      name: activeName,
      message: `Unknown mode name "${activeName}" in "active_task_mode" — no mode with that name is defined in config.json.`,
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

/** Split drafts into importable vs name-clashing with existing modes (incl. reserved names). */
export function partitionAgainstExisting(
  drafts: ImportedTaskModeDraft[],
  existing: CustomTaskMode[],
): { fresh: ImportedTaskModeDraft[]; clashing: ImportedTaskModeDraft[] } {
  const taken = new Set([
    ...existing.map((m) => m.name.trim().toLowerCase()),
    ...RESERVED_TASK_MODE_NAMES,
  ]);
  const fresh: ImportedTaskModeDraft[] = [];
  const clashing: ImportedTaskModeDraft[] = [];
  for (const d of drafts) {
    if (taken.has(d.name.toLowerCase())) clashing.push(d);
    else {
      fresh.push(d);
      taken.add(d.name.toLowerCase());
    }
  }
  return { fresh, clashing };
}
