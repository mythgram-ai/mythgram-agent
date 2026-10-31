import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/** Skill names are lowercase, digit, and hyphen-separated segments (e.g. "git-workflow"). */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const schema = z.object({
  file_path: z
    .string()
    .trim()
    .min(1, "file_path must be a non-empty string")
    .describe(
      "Absolute filesystem path to the directory where the .mythgram/skills directory should be " +
        "initialized. The tool creates a .mythgram/skills directory inside this path if it does not already " +
        "exist. Example: /workspace/my-project",
    ),
  skill_names: z
    .array(
      z
        .string()
        .regex(
          SKILL_NAME_PATTERN,
          "Each skill name must be lowercase alphanumeric segments separated by single hyphens (e.g. git-workflow).",
        ),
    )
    .min(1, "Provide at least one skill name to initialize.")
    .refine((names) => new Set(names).size === names.length, {
      message: "skill_names must be unique.",
    })
    .describe(
      "The names of the skills to initialize. Each skill name must be unique and must exactly match " +
        "a skill name returned by the list_skills tool.",
    ),
});

export const skillInitializeTool = defineTool({
  name: "skill_initialize",
  description:
    "Initialize one or more skills inside a workspace .mythgram/skills directory. The tool creates the " +
    ".mythgram/skills directory at the specified absolute path if it does not already exist, then " +
    "initializes the requested skills inside it by writing each skill's files (SKILL.md plus any " +
    "reference/example/script files) to disk. After initializing, read a skill's SKILL.md with " +
    "file_read to learn how to use it. Skill names must exactly match names returned by list_skills.",
  schema,
  label: (args) => {
    const names = Array.isArray(args.skill_names) ? args.skill_names : [];
    if (names.length === 0) return "Initialize Skills";
    if (names.length === 1) return `Initialize Skill: ${names[0]}`;
    return `Initialize Skills: ${names.length}`;
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.skills) {
      return {
        ok: false,
        error: {
          code: "skills_unavailable",
          message: "Skills are not available in this context.",
        },
      };
    }

    try {
      const result = await ctx.skills.initialize(
        { filePath: args.file_path, skillNames: args.skill_names },
        ctx,
      );
      return {
        ok: true,
        data: {
          success: result.success,
          initialized: result.initialized,
          failed: result.failed,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "skill_initialize_failed",
          message: error instanceof Error ? error.message : String(error),
          file_path: args.file_path,
        },
      };
    }
  },
});
