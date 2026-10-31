import type { Skill, SkillFile } from "@/types";

export const SKILL_NAME_MAX = 70;
export const SKILL_DESC_MAX = 300;
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const IMPORT_CONFIG_FILE_NAME = "config.json";
/** Max single file size accepted on import (5 MB — skills are text/markdown/scripts). */
export const MAX_SKILL_FILE_BYTES = 5 * 1024 * 1024;
/** Max supporting files collected per skill (bounds context + memory). */
export const MAX_FILES_PER_SKILL = 50;

/** One validated skill ready to be added to the store. */
export interface ImportedSkillDraft {
  name: string;
  description: string;
  skillFile: string;
  skillContent: string;
  files: SkillFile[];
  enabled: boolean;
  /** Resolved skill folder (for display), e.g. "skills/code-review". */
  folderPath: string;
}

/** One entry that could not be imported, with a human-readable reason. */
export interface SkillImportError {
  /** Index in the config array (0-based) when known, else -1. */
  index: number;
  name: string;
  message: string;
}

export interface ParseSkillsImportResult {
  drafts: ImportedSkillDraft[];
  errors: SkillImportError[];
  /** Display path of the config file used, e.g. "my-skills/config.json". */
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
 * Resolve a skill folder reference against the directory containing config.json.
 * Absolute-looking refs are treated as relative to the uploaded root so imports
 * stay sandboxed to the selected files. Returns null when the ref escapes the root.
 */
function resolveFolderKey(configDir: string, rawRef: string): string | null {
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

function parseActive(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "yes", "1", "on", "enabled", "active"].includes(t)) return true;
    if (["false", "no", "0", "off", "disabled", "inactive"].includes(t)) return false;
  }
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  return null;
}

function validateName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  if (!name) return "A name is required.";
  if (name.length > SKILL_NAME_MAX) return `Name must be ${SKILL_NAME_MAX} characters or fewer.`;
  if (!SKILL_NAME_PATTERN.test(name))
    return "Name must be lowercase letters/numbers with single hyphens, e.g. code-review (no spaces or underscores).";
  return null;
}

/**
 * Parse + validate a skills config.json payload against the uploaded files.
 *
 * Accepts both spellings:
 * - array key: "skills" (only)
 * - folder path: "skill_path" | "skillPath" | "path" | "folder" | "folder_path" | "folderPath"
 * - enabled: "active" | "enabled"
 */
export async function parseSkillsImport(
  configText: string,
  configDisplayPath: string,
  filesByKey: Map<string, File>,
): Promise<ParseSkillsImportResult> {
  const configDir = dirOf(configDisplayPath);
  const errors: SkillImportError[] = [];
  const drafts: ImportedSkillDraft[] = [];

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
  const rawList = Array.isArray(root.skills) ? root.skills : null;
  if (!rawList) {
    return {
      drafts,
      errors: [
        {
          index: -1,
          name: "",
          message: `No skill list found. Add a "skills" array to config.json.`,
        },
      ],
      configPath: configDisplayPath,
    };
  }
  if (rawList.length === 0) {
    return {
      drafts,
      errors: [{ index: -1, name: "", message: "config.json contains no skills to import." }],
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
    const folderRefRaw = str(
      entry.skill_path ??
        entry.skillPath ??
        entry.folder_path ??
        entry.folderPath ??
        entry.folder ??
        entry.path,
    );
    const activeRaw = entry.active ?? entry.enabled;

    const label = nameRaw.trim() || `Entry #${i + 1}`;

    const nameErr = validateName(nameRaw);
    if (nameErr) {
      errors.push({ index: i, name: label, message: nameErr });
      continue;
    }
    const name = nameRaw.trim().toLowerCase();
    if (seenInFile.has(name)) {
      errors.push({ index: i, name, message: `Duplicate name "${name}" inside config.json — only the first was kept.` });
      continue;
    }

    if (!descRaw.trim()) {
      errors.push({ index: i, name, message: "A description is required." });
      continue;
    }
    if (descRaw.trim().length > SKILL_DESC_MAX) {
      errors.push({ index: i, name, message: `Description must be ${SKILL_DESC_MAX} characters or fewer.` });
      continue;
    }

    if (!folderRefRaw.trim()) {
      errors.push({ index: i, name, message: "A skill folder path is required (skill_path)." });
      continue;
    }
    const active = parseActive(activeRaw);
    if (active === null) {
      errors.push({ index: i, name, message: `Field "active" must be a boolean (true/false).` });
      continue;
    }

    const folderKey = resolveFolderKey(configDir, folderRefRaw);
    if (!folderKey) {
      errors.push({ index: i, name, message: `Skill path "${folderRefRaw.trim()}" escapes the uploaded folder.` });
      continue;
    }
    const prefix = `${folderKey.toLowerCase()}/`;
    const matches: Array<{ key: string; file: File }> = [];
    for (const [key, file] of filesByKey) {
      if (key === folderKey.toLowerCase() || key.startsWith(prefix)) {
        matches.push({ key, file });
      }
    }
    if (matches.length === 0) {
      errors.push({
        index: i,
        name,
        message: `Skill folder not found: "${folderRefRaw.trim()}" (looked for "${folderKey}/"). Upload the whole folder so skill files are included.`,
      });
      continue;
    }

    // Locate SKILL.md directly under the skill folder (case-insensitive basename).
    const direct = matches.find(({ key }) => {
      const base = key.split("/").pop() ?? "";
      if (base.toLowerCase() !== "skill.md") return false;
      const parent = key.slice(0, key.length - base.length - 1);
      return parent === folderKey.toLowerCase();
    });
    // Fallback: any SKILL.md nested deeper in the folder (community zips vary).
    const nested = direct ?? matches.find(({ key }) => (key.split("/").pop() ?? "").toLowerCase() === "skill.md");
    if (!nested) {
      errors.push({ index: i, name, message: `SKILL.md not found in "${folderKey}/". Each skill folder must contain a SKILL.md file.` });
      continue;
    }

    if (nested.file.size > MAX_SKILL_FILE_BYTES) {
      errors.push({ index: i, name, message: `SKILL.md in "${folderKey}/" is too large (max 5 MB).` });
      continue;
    }
    let skillContent = "";
    try {
      skillContent = (await nested.file.text()).trim();
    } catch {
      errors.push({ index: i, name, message: `Could not read SKILL.md in "${folderKey}/".` });
      continue;
    }
    if (!skillContent) {
      errors.push({ index: i, name, message: `SKILL.md in "${folderKey}/" is empty.` });
      continue;
    }

    // Collect supporting files: everything else under the folder.
    const nestedKey = nested.key;
    const seenPaths = new Set<string>([relativeSkillPath(nestedKey, folderKey).toLowerCase()]);
    const files: SkillFile[] = [];
    let skipped = 0;
    const sorted = matches
      .filter(({ key }) => key !== nestedKey)
      .sort((a, b) => a.key.localeCompare(b.key));
    for (const { key, file } of sorted) {
      if (files.length >= MAX_FILES_PER_SKILL) {
        skipped += 1;
        continue;
      }
      const rel = relativeSkillPath(key, folderKey);
      if (!rel || rel.toLowerCase() === "config.json") continue;
      if (seenPaths.has(rel.toLowerCase())) {
        errors.push({ index: i, name, message: `Duplicate file path "${rel}" in "${folderKey}/".` });
        continue;
      }
      if (file.size > MAX_SKILL_FILE_BYTES) {
        skipped += 1;
        continue;
      }
      try {
        const content = await file.text();
        seenPaths.add(rel.toLowerCase());
        files.push({ path: rel, content });
      } catch {
        skipped += 1;
      }
    }

    seenInFile.add(name);
    drafts.push({
      name,
      description: descRaw.trim(),
      skillFile: displayBasename(nestedKey),
      skillContent,
      files,
      enabled: active,
      folderPath: folderKey,
    });
    void skipped;
  }

  return { drafts, errors, configPath: configDisplayPath };
}

/** Path of an uploaded file relative to its skill folder (original case preserved). */
function relativeSkillPath(lowerKey: string, folderKey: string): string {
  const prefix = `${folderKey.toLowerCase()}/`;
  if (lowerKey === folderKey.toLowerCase()) return lowerKey.split("/").pop() ?? "";
  if (lowerKey.startsWith(prefix)) {
    // Reconstruct from the lowercased key; casing differences are negligible for display.
    return lowerKey.slice(prefix.length);
  }
  return "";
}

function displayBasename(key: string): string {
  const base = key.split("/").pop() ?? "SKILL.md";
  return base || "SKILL.md";
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

/** Split drafts into importable vs name-clashing with existing skills. */
export function partitionAgainstExisting(
  drafts: ImportedSkillDraft[],
  existing: Skill[],
): { fresh: ImportedSkillDraft[]; clashing: ImportedSkillDraft[] } {
  const taken = new Set(existing.map((s) => s.name.trim().toLowerCase()));
  const fresh: ImportedSkillDraft[] = [];
  const clashing: ImportedSkillDraft[] = [];
  for (const d of drafts) {
    if (taken.has(d.name.toLowerCase())) clashing.push(d);
    else {
      fresh.push(d);
      taken.add(d.name.toLowerCase());
    }
  }
  return { fresh, clashing };
}
