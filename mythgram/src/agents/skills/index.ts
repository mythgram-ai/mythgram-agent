import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillDefinition, SkillFileDefinition } from "../tools/types.js";

/**
 * Root directory holding the built-in default skill folders. Each subfolder is one skill: the
 * folder name is the skill's identifier, and every file inside (including the entry SKILL.md)
 * becomes a file of that skill when it is loaded.
 */
export const DEFAULT_SKILLS_ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Entry file name each skill folder is expected to contain. */
const DEFAULT_SKILL_ENTRY_FILE = "SKILL.md";

/** Fields we read from the YAML frontmatter block at the top of SKILL.md. */
interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/**
 * Load the built-in, pre-installed default skills shipped with the agent. The read is fast and
 * the result is process-stable, so callers should cache the returned promise rather than call
 * this repeatedly.
 */
export async function loadDefaultSkills(): Promise<SkillDefinition[]> {
  const entries = await fs.readdir(DEFAULT_SKILLS_ROOT, { withFileTypes: true });
  const folderNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const skills: SkillDefinition[] = [];
  for (const folder of folderNames) {
    const files = await collectFolderFiles(path.join(DEFAULT_SKILLS_ROOT, folder));
    if (files.length === 0) continue;

    const entry = files.find((f) => f.path.toLowerCase() === DEFAULT_SKILL_ENTRY_FILE.toLowerCase());
    const entryFile = entry?.path ?? files[0]!.path;
    const meta = entry ? parseFrontmatter(entry.content) : {};

    skills.push({
      name: normalizeName(meta.name ?? folder, folder),
      description: (meta.description ?? "").trim(),
      skillFile: entryFile,
      files,
      enabled: true,
    });
  }

  return skills;
}

let cachedDefaults: Promise<SkillDefinition[]> | undefined;

/**
 * Memoized accessor for the built-in default skills. The source folder is static for the life of
 * the process, so we load it once and reuse the result for every turn.
 */
export function resolveDefaultSkills(): Promise<SkillDefinition[]> {
  if (!cachedDefaults) {
    cachedDefaults = loadDefaultSkills().catch((error) => {
      // Do not cache a failed load — a transient read error should not shadow the defaults
      // for the rest of the process. Fall back to an empty default set and retry next time.
      cachedDefaults = undefined;
      console.error(`[skills] failed to load default skills: ${error instanceof Error ? error.message : String(error)}`);
      return [] as SkillDefinition[];
    });
  }
  return cachedDefaults;
}

/**
 * Merge the pre-installed default skills with the user's own skills so the defaults are always
 * available unless the user replaces one (matched by case-insensitive name) with their own
 * version — which may disable it by setting enabled:false.
 */
export function mergeDefaultSkills(
  defaults: SkillDefinition[],
  userSkills: SkillDefinition[],
): SkillDefinition[] {
  const merged = new Map<string, SkillDefinition>();
  for (const skill of defaults) {
    merged.set(skill.name.trim().toLowerCase(), skill);
  }
  for (const skill of userSkills) {
    merged.set(skill.name.trim().toLowerCase(), skill);
  }
  return Array.from(merged.values());
}

/** Recursively collect all files under `rootAbs` as skill-relative paths plus utf8 content. */
async function collectFolderFiles(rootAbs: string): Promise<SkillFileDefinition[]> {
  const files: SkillFileDefinition[] = [];
  const walk = async (dirAbs: string, relDir: string): Promise<void> => {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const entryAbs = path.join(dirAbs, entry.name);
      const rel = relDir.length > 0 ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(entryAbs, rel);
      } else if (entry.isFile()) {
        const content = await fs.readFile(entryAbs, "utf8");
        files.push({ path: rel.replace(/\\/g, "/"), content });
      }
    }
  };
  await walk(rootAbs, "");
  return files;
}

/**
 * Parse the YAML frontmatter block delimited by `---` at the top of a file, extracting only the
 * `name` and `description` keys. Unknown keys are ignored so skill content can carry extras.
 */
function parseFrontmatter(content: string): SkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
  if (!match) return {};

  const meta: SkillFrontmatter = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
    if (key === "name") meta.name = value;
    else if (key === "description") meta.description = value;
  }
  return meta;
}

/**
 * The skill name must be a valid folder/storage identifier. Prefer the frontmatter `name` but
 * fall back to the folder name; guard against anything that would break the storage contract.
 */
function normalizeName(raw: string, fallback: string): string {
  const candidate = raw.trim();
  if (candidate.length > 0 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)) {
    return candidate;
  }
  return fallback;
}