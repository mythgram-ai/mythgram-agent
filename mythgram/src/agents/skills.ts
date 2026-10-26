import fs from "node:fs/promises";
import path from "node:path";
import { safeResolve, toWorkspaceRelative } from "../utils/paths.js";
import type {
  FailedSkill,
  InitializedSkill,
  SkillDefinition,
  SkillFileDefinition,
  SkillInitializeResult,
  SkillListEntry,
  SkillRuntime,
  ToolContext,
} from "./tools/types.js";

/** Name of the directory skills are materialized into, created under the caller-provided path. */
export const SKILLS_DIR = ".mythgram/skills";

/** Default entry file name when a skill does not specify one. */
export const DEFAULT_SKILL_FILE = "SKILL.md";

/**
 * Build the SkillRuntime bound to a single main-agent turn. The returned object is injected into
 * the ToolContext so list_skills / skill_initialize can enumerate the user's skills and write
 * them onto disk inside the workspace's ".mythgram/skills" directory.
 */
export function createSkillRuntime(definitions: SkillDefinition[]): SkillRuntime {
  const runner = new SkillRunner(definitions);
  return {
    definitions,
    list: () => runner.list(),
    register: (skill) => runner.register(skill),
    initialize: (params, ctx) => runner.initialize(params, ctx),
  };
}

class SkillRunner {
  constructor(private readonly definitions: SkillDefinition[]) {}

  /**
   * Add a skill definition to the live turn (or replace an existing one matched case-insensitively
   * by name). Mutates the shared `definitions` array in place so the SkillRuntime's exposed
   * `definitions`, `list()`, and `initialize()` all see the new skill immediately.
   */
  register(skill: SkillDefinition): void {
    const target = skill.name.trim().toLowerCase();
    const index = this.definitions.findIndex((def) => def.name.trim().toLowerCase() === target);
    if (index >= 0) {
      this.definitions[index] = skill;
    } else {
      this.definitions.push(skill);
    }
  }

  /** Enabled skills with a normalized, de-duplicated file list and a rendered tree. */
  list(): SkillListEntry[] {
    return this.definitions
      .filter((def) => def.enabled !== false && def.name.trim().length > 0)
      .map((def) => {
        const skillFile = normalizeSkillFile(def.skillFile);
        const files = normalizedFilePaths(def, skillFile);
        return {
          name: def.name.trim(),
          description: def.description ?? "",
          skill_file: skillFile,
          files,
          tree: renderTree(def.name.trim(), files, skillFile),
        };
      });
  }

  private find(name: string): SkillDefinition | undefined {
    const target = name.trim().toLowerCase();
    return this.definitions.find(
      (def) => def.enabled !== false && def.name.trim().toLowerCase() === target,
    );
  }

  /**
   * Ensure the ".mythgram/skills" directory exists under `filePath`, then write each requested skill's
   * files. Skills that are unknown/disabled or already present on disk are collected into
   * `failed` so the agent can continue its loop instead of hard-failing the tool call.
   */
  async initialize(
    params: { filePath: string; skillNames: string[] },
    ctx: ToolContext,
  ): Promise<SkillInitializeResult> {
    // Base directory the model asked to initialize skills under. safeResolve keeps it inside the
    // workspace even when the model passes an absolute-looking path (e.g. "/workspace/project").
    const baseAbs = safeResolve(ctx.workspaceRoot, params.filePath || ".");
    const skillsRootAbs = path.join(baseAbs, SKILLS_DIR);
    await fs.mkdir(skillsRootAbs, { recursive: true });

    const initialized: InitializedSkill[] = [];
    const failed: FailedSkill[] = [];

    // De-duplicate while preserving order; the schema already enforces uniqueness, but be safe.
    const requested = Array.from(new Set(params.skillNames.map((n) => n.trim()).filter(Boolean)));

    for (const name of requested) {
      const definition = this.find(name);
      if (!definition) {
        const available = this.list().map((s) => s.name);
        failed.push({
          skill_name: name,
          error:
            `Unknown or disabled skill "${name}". ` +
            (available.length > 0
              ? `Available skills: ${available.join(", ")}. Call list_skills to see them.`
              : "No skills are currently available. The user can create one from Settings."),
        });
        continue;
      }

      const skillDirAbs = path.join(skillsRootAbs, definition.name.trim());

      // Guard: refuse to re-initialize a skill that already exists on disk.
      if (await pathExists(skillDirAbs)) {
        failed.push({
          skill_name: definition.name.trim(),
          error: `Skill "${definition.name.trim()}" is already initialized at ${relativeToBase(
            baseAbs,
            skillDirAbs,
          )}. Read its files with file_read instead of re-initializing.`,
        });
        continue;
      }

      try {
        const skillFile = normalizeSkillFile(definition.skillFile);
        const files = collectFiles(definition, skillFile);
        const written: string[] = [];

        for (const file of files) {
          // Each file path is resolved under the skill folder and validated to stay inside the
          // workspace (defense in depth against "../" traversal in a file name).
          const targetAbs = safeResolve(ctx.workspaceRoot, path.join(skillDirAbs, file.path));
          if (!isInside(skillDirAbs, targetAbs)) {
            throw new Error(`File path "${file.path}" escapes the skill folder.`);
          }
          await fs.mkdir(path.dirname(targetAbs), { recursive: true });
          await fs.writeFile(targetAbs, file.content, "utf8");
          written.push(relativeToBase(baseAbs, targetAbs));
        }

        initialized.push({
          skill_name: definition.name.trim(),
          path: relativeToBase(baseAbs, skillDirAbs),
          skill_file: relativeToBase(baseAbs, path.join(skillDirAbs, skillFile)),
          files: written,
        });
      } catch (error) {
        failed.push({
          skill_name: definition.name.trim(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { success: failed.length === 0, initialized, failed };
  }
}

/** Normalize the entry file name, falling back to SKILL.md. */
function normalizeSkillFile(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/^[\\/]+/, "");
  return trimmed.length > 0 ? trimmed : DEFAULT_SKILL_FILE;
}

/**
 * All files that make up a skill on disk: every declared file plus a synthesized empty entry file
 * if the definition somehow omitted it. Paths are cleaned (leading slashes stripped) and later
 * duplicates win so an explicit entry file overrides the synthesized one.
 */
function collectFiles(def: SkillDefinition, skillFile: string): SkillFileDefinition[] {
  const byPath = new Map<string, SkillFileDefinition>();
  // Ensure the entry file always exists, even if the caller forgot to include it.
  byPath.set(skillFile, { path: skillFile, content: "" });
  for (const file of def.files ?? []) {
    const cleaned = cleanFilePath(file.path);
    if (!cleaned) continue;
    byPath.set(cleaned, { path: cleaned, content: file.content ?? "" });
  }
  return Array.from(byPath.values());
}

/**
 * De-duplicated relative file paths of a skill (for list_skills), with the entry file first and
 * the remaining files sorted alphabetically.
 */
function normalizedFilePaths(def: SkillDefinition, skillFile: string): string[] {
  const all = collectFiles(def, skillFile).map((f) => f.path);
  const rest = all.filter((p) => p !== skillFile).sort((a, b) => a.localeCompare(b));
  return [skillFile, ...rest];
}

/** Strip leading slashes and normalize a skill-relative file path. */
function cleanFilePath(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  return path.normalize(trimmed.replace(/^[\\/]+/, "")).replace(/\\/g, "/");
}

/** Path of `target` relative to `base`, using forward slashes for stable, portable output. */
function relativeToBase(base: string, target: string): string {
  const rel = path.relative(base, target);
  return rel.split(path.sep).join("/");
}

/** Whether `target` is `parent` itself or nested inside it. */
function isInside(parent: string, target: string): boolean {
  const rel = path.relative(parent, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Render a folder tree from a flat list of relative file paths, e.g.
 *   git-workflow/
 *       ├── SKILL.md
 *       └── references/
 *           └── branching.md
 */
function renderTree(root: string, files: string[], entryFile?: string): string {
  interface Node {
    dirs: Map<string, Node>;
    files: Set<string>;
  }
  const rootNode: Node = { dirs: new Map(), files: new Set() };

  for (const file of files) {
    const parts = file.split("/").filter(Boolean);
    let node = rootNode;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const dir = parts[i]!;
      let next = node.dirs.get(dir);
      if (!next) {
        next = { dirs: new Map(), files: new Set() };
        node.dirs.set(dir, next);
      }
      node = next;
    }
    const leaf = parts[parts.length - 1];
    if (leaf) node.files.add(leaf);
  }

  const lines: string[] = [`${root}/`];

  const walk = (node: Node, prefix: string, isRoot: boolean): void => {
    const dirNames = Array.from(node.dirs.keys()).sort((a, b) => a.localeCompare(b));
    let fileNames = Array.from(node.files).sort((a, b) => a.localeCompare(b));
    // At the root level, surface the entry file (e.g. SKILL.md) first.
    if (isRoot && entryFile && node.files.has(entryFile)) {
      fileNames = [entryFile, ...fileNames.filter((n) => n !== entryFile)];
    }
    const entries: Array<{ name: string; node?: Node }> = [
      ...dirNames.map((name) => ({ name, node: node.dirs.get(name)! })),
      ...fileNames.map((name) => ({ name })),
    ];
    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1;
      const branch = isLast ? "└── " : "├── ";
      const label = entry.node ? `${entry.name}/` : entry.name;
      lines.push(`${prefix}${branch}${label}`);
      if (entry.node) {
        walk(entry.node, `${prefix}${isLast ? "    " : "│   "}`, false);
      }
    });
  };

  walk(rootNode, "    ", true);
  return lines.join("\n");
}

/** Re-export so tests / callers can turn an absolute path back into a workspace-relative one. */
export { toWorkspaceRelative };
