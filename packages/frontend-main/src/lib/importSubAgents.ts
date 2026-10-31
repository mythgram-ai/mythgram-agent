import type { SubAgent } from "@/types";
import { DEFAULT_SUB_AGENT_TOOLS } from "@/lib/defaultSubAgents";

export const SUB_AGENT_NAME_MAX = 70;
export const SUB_AGENT_DESC_MAX = 300;
export const SUB_AGENT_NAME_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
export const IMPORT_CONFIG_FILE_NAME = "config.json";
/** Max system-prompt file size accepted on import (5 MB — prompts are text). */
export const MAX_PROMPT_FILE_BYTES = 5 * 1024 * 1024;

/** One validated sub-agent ready to be added to the store. */
export interface ImportedSubAgentDraft {
  name: string;
  description: string;
  systemPrompt: string;
  enabled: boolean;
  /** Resolved prompt source path (for display), e.g. "prompts/code-reviewer.md". */
  promptPath: string;
}

/** One entry that could not be imported, with a human-readable reason. */
export interface SubAgentImportError {
  /** Index in the config array (0-based) when known, else -1. */
  index: number;
  name: string;
  message: string;
}

export interface ParseImportResult {
  drafts: ImportedSubAgentDraft[];
  errors: SubAgentImportError[];
  /** Display path of the config file used, e.g. "my-sub-agents/config.json". */
  configPath: string;
}

type FileWithPath = File & { webkitRelativePath?: string };

function displayPathOf(file: FileWithPath): string {
  const rel = (file.webkitRelativePath ?? "").trim();
  if (rel) return rel.replace(/\\/g, "/");
  return file.name;
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
 * Resolve a system-prompt reference against the directory containing config.json.
 * Absolute-looking refs ("/x/y.md" or "C:\\...") are treated as relative to the
 * uploaded root so imports stay sandboxed to the selected files. Returns null
 * when the ref escapes the uploaded root via "..".
 */
function resolvePromptKey(configDir: string, rawRef: string): string | null {
  let ref = rawRef.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  ref = ref.replace(/^\/+/, "");
  // Windows absolute ("C:/...") -> strip drive, treat as relative.
  ref = ref.replace(/^[A-Za-z]:\//, "");
  const joined = configDir ? `${configDir}/${ref}` : ref;
  const normalized = normalizePosix(joined);
  // Escaped the uploaded root (normalized walked past it).
  if (configDir) {
    if (normalized !== configDir && !normalized.startsWith(`${configDir}/`)) {
      // Allow sibling files at root when config sits in a subfolder? No — the
      // ref must stay inside the uploaded tree; root-anchored is fine.
      if (normalized.includes("..")) return null;
    }
  } else if (normalized.startsWith("..")) {
    return null;
  }
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
    if (["true", "yes", "1", "on", "enabled"].includes(t)) return true;
    if (["false", "no", "0", "off", "disabled"].includes(t)) return false;
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
  if (name.length > SUB_AGENT_NAME_MAX) return `Name must be ${SUB_AGENT_NAME_MAX} characters or fewer.`;
  if (!SUB_AGENT_NAME_PATTERN.test(name))
    return "Name must be lowercase with no spaces — use letters, digits and single -/_ (e.g. code_reviewer).";
  return null;
}

/**
 * Parse + validate a config.json payload against the uploaded files.
 *
 * Accepts both spellings from the spec:
 * - array key: "sub_agents" | "subAgents"
 * - prompt path: "system_prompt_path" | "systemPromptPath" | "system_prompt" | "systemPrompt"
 * - enabled: "active" | "enabled"
 *
 * `filesByKey` maps normalized posix paths (lowercased) to File objects.
 */
export async function parseSubAgentImport(
  configText: string,
  configDisplayPath: string,
  filesByKey: Map<string, File>,
): Promise<ParseImportResult> {
  const configDir = dirOf(configDisplayPath);
  const errors: SubAgentImportError[] = [];
  const drafts: ImportedSubAgentDraft[] = [];

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
  const rawList = Array.isArray(root.sub_agents)
    ? root.sub_agents
    : Array.isArray(root.subAgents)
      ? root.subAgents
      : null;
  if (!rawList) {
    return {
      drafts,
      errors: [
        {
          index: -1,
          name: "",
          message: `No sub-agent list found. Add a "sub_agents" array to config.json.`,
        },
      ],
      configPath: configDisplayPath,
    };
  }
  if (rawList.length === 0) {
    return {
      drafts,
      errors: [{ index: -1, name: "", message: "config.json contains no sub-agents to import." }],
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
    const promptRefRaw =
      str(entry.system_prompt_path ?? entry.systemPromptPath ?? entry.system_prompt ?? entry.systemPrompt);
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
    if (descRaw.trim().length > SUB_AGENT_DESC_MAX) {
      errors.push({ index: i, name, message: `Description must be ${SUB_AGENT_DESC_MAX} characters or fewer.` });
      continue;
    }

    if (!promptRefRaw.trim()) {
      errors.push({ index: i, name, message: "A system prompt file path is required (system_prompt_path)." });
      continue;
    }
    const active = parseActive(activeRaw);
    if (active === null) {
      errors.push({ index: i, name, message: `Field "active" must be a boolean (true/false).` });
      continue;
    }

    const key = resolvePromptKey(configDir, promptRefRaw);
    if (!key) {
      errors.push({ index: i, name, message: `Prompt path "${promptRefRaw.trim()}" escapes the uploaded folder.` });
      continue;
    }
    const file = filesByKey.get(key.toLowerCase());
    if (!file) {
      errors.push({
        index: i,
        name,
        message: `Prompt file not found: "${promptRefRaw.trim()}" (looked for "${key}"). Upload the whole folder so prompt files are included.`,
      });
      continue;
    }
    if (file.size > MAX_PROMPT_FILE_BYTES) {
      errors.push({ index: i, name, message: `Prompt file "${key}" is too large (max 5 MB).` });
      continue;
    }
    let promptText = "";
    try {
      promptText = (await file.text()).trim();
    } catch {
      errors.push({ index: i, name, message: `Could not read prompt file "${key}".` });
      continue;
    }
    if (!promptText) {
      errors.push({ index: i, name, message: `Prompt file "${key}" is empty.` });
      continue;
    }

    seenInFile.add(name);
    drafts.push({
      name,
      description: descRaw.trim(),
      systemPrompt: promptText,
      enabled: active,
      promptPath: key,
    });
  }

  return { drafts, errors, configPath: configDisplayPath };
}

/** Build the lookup map + locate config.json within a FileList (files and/or folder). */
export function indexUploadedFiles(list: FileList | File[]): {
  filesByKey: Map<string, File>;
  configFile: File | null;
  configPath: string | null;
} {
  const files = Array.from(list as ArrayLike<File>) as FileWithPath[];
  const filesByKey = new Map<string, File>();
  for (const f of files) {
    const key = normalizePosix(displayPathOf(f)).toLowerCase();
    if (!key) continue;
    if (!filesByKey.has(key)) filesByKey.set(key, f);
  }
  // Prefer an exact "config.json" basename match; shallowest path wins.
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
  // Return the display (original-case) path for messages.
  const display = normalizePosix(displayPathOf(best.file as FileWithPath));
  return { filesByKey, configFile: best.file, configPath: display };
}

/** Split drafts into importable vs name-clashing with existing sub-agents. */
export function partitionAgainstExisting(
  drafts: ImportedSubAgentDraft[],
  existing: SubAgent[],
): { fresh: ImportedSubAgentDraft[]; clashing: ImportedSubAgentDraft[] } {
  const taken = new Set(existing.map((a) => a.name.trim().toLowerCase()));
  const fresh: ImportedSubAgentDraft[] = [];
  const clashing: ImportedSubAgentDraft[] = [];
  for (const d of drafts) {
    if (taken.has(d.name.toLowerCase())) clashing.push(d);
    else {
      fresh.push(d);
      taken.add(d.name.toLowerCase());
    }
  }
  return { fresh, clashing };
}

/** Default tool grant for imported sub-agents (same as in-app created ones). */
export function defaultToolsForImport(): string[] {
  return [...DEFAULT_SUB_AGENT_TOOLS];
}
