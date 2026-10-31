import type { CustomAgent } from "@/types";

export const CUSTOM_AGENT_NAME_MAX = 70;
export const CUSTOM_AGENT_DESC_MAX = 300;
export const IMPORT_CONFIG_FILE_NAME = "config.json";
/** Max system-prompt file size accepted on import (5 MB — prompts are text). */
export const MAX_PROMPT_FILE_BYTES = 5 * 1024 * 1024;

/** One validated custom agent ready to be added to the store. */
export interface ImportedCustomAgentDraft {
  name: string;
  description: string;
  systemPrompt: string;
  /** Resolved prompt source path (for display), e.g. "custom_agents/data_analyst/system_prompt.md". */
  promptPath: string;
}

/** One entry that could not be imported, with a human-readable reason. */
export interface CustomAgentImportError {
  /** Index in the config array (0-based) when known, else -1. */
  index: number;
  name: string;
  message: string;
}

export interface ParseCustomAgentImportResult {
  drafts: ImportedCustomAgentDraft[];
  errors: CustomAgentImportError[];
  /** Display path of the config file used, e.g. "my-agents/config.json". */
  configPath: string;
  /**
   * The requested agent to activate after import, as written in config
   * (`active_agent` / `activeAgent`). Null when absent. Validation of
   * whether it matches an imported agent happens in the modal so the UI
   * can surface a clear warning instead of silently ignoring it.
   */
  activeAgent: string | null;
  /** Raw active_agent value was present but empty/whitespace. */
  activeAgentEmpty: boolean;
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
  if (!ref) return null;
  const joined = configDir ? `${configDir}/${ref}` : ref;
  const normalized = normalizePosix(joined);
  if (!normalized) return null;
  if (normalized === ".." || normalized.startsWith("../")) return null;
  // When config sits in a subfolder, a ref that walks above the config dir but
  // stays inside the uploaded root is still acceptable (e.g. sibling folder).
  // Only reject refs that escape the uploaded root entirely (contain ".." after
  // normalization, which normalizePosix would have already resolved — so check
  // for leading ".." only).
  return normalized;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function validateName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "A name is required.";
  if (name.length > CUSTOM_AGENT_NAME_MAX)
    return `Name must be ${CUSTOM_AGENT_NAME_MAX} characters or fewer.`;
  return null;
}

/**
 * Parse + validate a custom-agent config.json payload against the uploaded files.
 *
 * Accepted shape (mirrors the documented workflow):
 * ```json
 * {
 *   "active_agent": "data_analyst",
 *   "custom_agents": [
 *     { "name": "...", "description": "...", "system_prompt_path": "./custom_agents/x/system_prompt.md" }
 *   ]
 * }
 * ```
 *
 * Accepts both spellings for robustness (same convention as sub-agent/skill imports):
 * - array key: "custom_agents" | "customAgents" | "agents"
 * - prompt path: "system_prompt_path" | "systemPromptPath" | "system_prompt" | "systemPrompt"
 * - description: "description" | "desc"
 * - active agent: "active_agent" | "activeAgent" | "active_agent_name" | "activeAgentName"
 *
 * `filesByKey` maps normalized posix paths (lowercased) to File objects.
 */
export async function parseCustomAgentImport(
  configText: string,
  configDisplayPath: string,
  filesByKey: Map<string, File>,
): Promise<ParseCustomAgentImportResult> {
  const configDir = dirOf(configDisplayPath);
  const errors: CustomAgentImportError[] = [];
  const drafts: ImportedCustomAgentDraft[] = [];

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
      activeAgent: null,
      activeAgentEmpty: false,
    };
  }

  const root: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  const rawList = Array.isArray(root.custom_agents)
    ? root.custom_agents
    : Array.isArray(root.customAgents)
      ? root.customAgents
      : Array.isArray(root.agents)
        ? root.agents
        : null;
  if (!rawList) {
    return {
      drafts,
      errors: [
        {
          index: -1,
          name: "",
          message: `No custom-agent list found. Add a "custom_agents" array to config.json.`,
        },
      ],
      configPath: configDisplayPath,
      activeAgent: null,
      activeAgentEmpty: false,
    };
  }
  if (rawList.length === 0) {
    return {
      drafts,
      errors: [{ index: -1, name: "", message: "config.json contains no custom agents to import." }],
      configPath: configDisplayPath,
      activeAgent: null,
      activeAgentEmpty: false,
    };
  }

  // Active agent is optional. When present it must be a non-empty string; an
  // empty value is reported so the UI can warn instead of silently skipping
  // activation.
  const activeRaw =
    root.active_agent ?? root.activeAgent ?? root.active_agent_name ?? root.activeAgentName ?? null;
  let activeAgent: string | null = null;
  let activeAgentEmpty = false;
  if (activeRaw !== null && activeRaw !== undefined) {
    if (typeof activeRaw !== "string" || !activeRaw.trim()) {
      activeAgentEmpty = true;
    } else {
      activeAgent = activeRaw.trim();
    }
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
    const promptRefRaw = str(
      entry.system_prompt_path ??
        entry.systemPromptPath ??
        entry.system_prompt ??
        entry.systemPrompt ??
        entry.prompt_path ??
        entry.promptPath ??
        entry.path,
    );

    const label = nameRaw.trim() || `Entry #${i + 1}`;

    const nameErr = validateName(nameRaw);
    if (nameErr) {
      errors.push({ index: i, name: label, message: nameErr });
      continue;
    }
    const name = nameRaw.trim();
    const nameKey = name.toLowerCase();
    if (seenInFile.has(nameKey)) {
      errors.push({
        index: i,
        name,
        message: `Duplicate name "${name}" inside config.json — only the first was kept.`,
      });
      continue;
    }

    if (!descRaw.trim()) {
      errors.push({ index: i, name, message: "A description is required." });
      continue;
    }
    if (descRaw.trim().length > CUSTOM_AGENT_DESC_MAX) {
      errors.push({
        index: i,
        name,
        message: `Description must be ${CUSTOM_AGENT_DESC_MAX} characters or fewer.`,
      });
      continue;
    }

    if (!promptRefRaw.trim()) {
      errors.push({
        index: i,
        name,
        message: "A system prompt file path is required (system_prompt_path).",
      });
      continue;
    }

    const key = resolvePromptKey(configDir, promptRefRaw);
    if (!key) {
      errors.push({
        index: i,
        name,
        message: `Prompt path "${promptRefRaw.trim()}" escapes the uploaded folder.`,
      });
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

    seenInFile.add(nameKey);
    drafts.push({
      name,
      description: descRaw.trim(),
      systemPrompt: promptText,
      promptPath: key,
    });
  }

  return { drafts, errors, configPath: configDisplayPath, activeAgent, activeAgentEmpty };
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

/** Split drafts into importable vs name-clashing with existing custom agents. */
export function partitionAgainstExisting(
  drafts: ImportedCustomAgentDraft[],
  existing: CustomAgent[],
): { fresh: ImportedCustomAgentDraft[]; clashing: ImportedCustomAgentDraft[] } {
  const taken = new Set(existing.map((a) => a.name.trim().toLowerCase()));
  const fresh: ImportedCustomAgentDraft[] = [];
  const clashing: ImportedCustomAgentDraft[] = [];
  for (const d of drafts) {
    if (taken.has(d.name.toLowerCase())) clashing.push(d);
    else {
      fresh.push(d);
      taken.add(d.name.toLowerCase());
    }
  }
  return { fresh, clashing };
}
