import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type SkillFileDefinition, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve } from "../../utils/paths.js";
import { SKILL_NAME_PATTERN } from "./skill_initialize.js";

/** Maximum length of the skill name (its folder / storage identifier). */
export const MAX_SKILL_NAME_CHARS = 70;

/** Maximum length of the short description the agent uses to pick the skill. */
export const MAX_SKILL_DESC_CHARS = 300;

/** Default entry file name looked for at the root of the skill source directory. */
export const DEFAULT_SKILL_ENTRY_FILE = "SKILL.md";

/**
 * The skill name becomes the installed skill's folder / storage identifier and must exactly match
 * the format skill_initialize (and the rest of the skill system) accepts: lowercase alphanumeric
 * segments separated by single hyphens. In particular any uppercase (capital) letter is rejected,
 * and — crucially — a name that create_skill accepts is always initializable, so a freshly created
 * skill can be materialized in the same turn.
 */
export const SKILL_NAME_FORMAT_MESSAGE =
  "The skill name must be lowercase alphanumeric segments separated by single hyphens (for " +
  "example: git-workflow). Uppercase (capital) letters, spaces, underscores and other symbols " +
  "are not allowed.";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A skill name is required.")
    .max(
      MAX_SKILL_NAME_CHARS,
      `The skill name must be ${MAX_SKILL_NAME_CHARS} characters or fewer.`,
    )
    .refine((value) => SKILL_NAME_PATTERN.test(value), SKILL_NAME_FORMAT_MESSAGE)
    .describe(
      "The name of the custom skill. This name becomes the installed skill's folder or storage " +
        "identifier. It must be lowercase alphanumeric segments separated by single hyphens (e.g. " +
        "git-workflow); uppercase (capital) letters, spaces and underscores are not allowed. " +
        "Maximum 70 characters.",
    ),
  description: z
    .string()
    .trim()
    .min(1, "A short description is required.")
    .max(
      MAX_SKILL_DESC_CHARS,
      `The short description must be ${MAX_SKILL_DESC_CHARS} characters or fewer.`,
    )
    .describe(
      "A concise description of what the skill does, when it should be used, and what capabilities " +
        "or knowledge it provides. Maximum 300 characters.",
    ),
  source_path: z
    .string()
    .trim()
    .min(1, "A source path is required.")
    .describe(
      "A direct absolute filesystem path to the directory containing the completed SKILL.md and " +
        "all skill reference files or folders. The path must start with '/'. Example: " +
        "/workspace/egskill/. The tool reads the complete contents of this directory recursively. " +
        "The source directory name is not used as the installed skill name; the value of name is " +
        "used instead.",
    ),
});

/**
 * Recursively read all files under `rootAbs`, returning each as a skill-relative path (forward
 * slashes) plus its utf8 content. Directories are walked depth-first and entries are sorted so
 * the resulting list is deterministic.
 */
async function collectFiles(rootAbs: string): Promise<SkillFileDefinition[]> {
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
 * Choose the skill's entry file: prefer a root-level SKILL.md (case-insensitive); otherwise a
 * root-level markdown file; otherwise the first (sorted) file. Falls back to SKILL.md when the
 * source is empty so a caller can still create an empty shell if desired.
 */
function determineEntryFile(files: SkillFileDefinition[]): string {
  for (const file of files) {
    if (!file.path.includes("/") && file.path.toLowerCase() === DEFAULT_SKILL_ENTRY_FILE.toLowerCase()) {
      return file.path;
    }
  }
  const rootMarkdown = files.find((f) => !f.path.includes("/") && f.path.toLowerCase().endsWith(".md"));
  if (rootMarkdown) return rootMarkdown.path;
  return files[0]?.path ?? DEFAULT_SKILL_ENTRY_FILE;
}

export const createSkillTool = defineTool({
  name: "create_skill",
  description:
    "Create and persist a custom skill for the user. Use this tool after creating the skill's " +
    "SKILL.md and any reference files or directories with file-writing tools. The provided " +
    "source_path must point to the completed skill directory. The tool packages the complete " +
    "directory contents and saves the skill in the user's browser-local skill storage under the " +
    "supplied skill name. The saved skill is treated as a user-owned installed skill and becomes " +
    "available to the skill list/load tools (list_skills / skill_initialize). This tool does not " +
    "persist the installed skill to the application's server filesystem as an installed skill — " +
    "it only reads the source files you already wrote so it can package them into the skill.",
  schema,
  label: (args) => `Create Skill: ${args.name}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const sourceAbs = safeResolve(ctx.workspaceRoot, args.source_path);

      let stat;
      try {
        stat = await fs.stat(sourceAbs);
      } catch {
        return {
          ok: false,
          error: {
            code: "source_not_found",
            message: `The skill source directory "${args.source_path}" does not exist. Create it and write its files first with file_write.`,
            source_path: args.source_path,
          },
        };
      }

      if (!stat.isDirectory()) {
        return {
          ok: false,
          error: {
            code: "source_not_directory",
            message: `The skill source path "${args.source_path}" is a file, not a directory. Point source_path at the folder containing the skill's files.`,
            source_path: args.source_path,
          },
        };
      }

      let files;
      try {
        files = await collectFiles(sourceAbs);
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "skill_read_failed",
            message: `Failed to read the skill source: ${error instanceof Error ? error.message : String(error)}`,
            source_path: args.source_path,
          },
        };
      }

      if (files.length === 0) {
        return {
          ok: false,
          error: {
            code: "empty_skill_source",
            message:
              `The skill source directory "${args.source_path}" contains no files. Write the ` +
              "skill's SKILL.md (and any reference files) there first with file_write before " +
              "calling create_skill.",
            source_path: args.source_path,
          },
        };
      }

      const name = args.name.trim();
      const description = args.description.trim();
      const entryFile = determineEntryFile(files);

      // Register the skill into the live turn so it is immediately discoverable by list_skills and
      // can be materialized by skill_initialize in the SAME turn — without waiting for the frontend
      // to persist it and echo it back on the next turn. The frontend still persists it (via the
      // returned created_skill payload) so it survives across turns.
      ctx.skills?.register({
        name,
        description,
        skillFile: entryFile,
        files,
        enabled: true,
      });

      return {
        ok: true,
        data: {
          created_skill: {
            name,
            description,
            skill_file: entryFile,
            files,
            enabled: true,
          },
          file_count: files.length,
          entry_file: entryFile,
          message:
            `Created skill "${name}" from ${files.length} file(s) with entry file "${entryFile}". ` +
            "It has been saved in the user's browser-local skill storage and is now available to " +
            "the skill list/load tools (list_skills / skill_initialize).",
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "create_skill_failed",
          message: error instanceof Error ? error.message : String(error),
          source_path: args.source_path,
        },
      };
    }
  },
});