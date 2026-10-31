import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { resolveDefaultSkills } from "../skills/index.js";

/** Error message returned when the model tries to delete a built-in (default) skill. */
export const DELETE_DEFAULT_SKILL_ERROR = "can't delete default skills";

const schema = z.object({
  skill_name: z
    .string()
    .trim()
    .min(1, "A skill name is required.")
    .describe("The exact name of the skill to permanently delete."),
});

export const deleteSkillTool = defineTool({
  name: "delete_skill",
  description:
    "Permanently delete an existing skill by its exact skill name. The skill name must exactly " +
    "match an existing skill. Before deletion, verify that the skill exists. Built-in default " +
    "skills cannot be deleted — only user/agent-created skills. This action cannot be undone. The " +
    "skill is removed from the user's saved skills so it is no longer available to list_skills / " +
    "skill_initialize in this and future sessions.",
  schema,
  label: (args) => `Delete Skill: ${args.skill_name}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const runtime = ctx.skills;
    if (!runtime) {
      return {
        ok: false,
        error: {
          code: "registry_unavailable",
          message:
            "The skill runtime is not available in this context. delete_skill can only be used by " +
            "the main agent.",
        },
      };
    }

    const requested = args.skill_name.trim();
    const requestedKey = requested.toLowerCase();

    // Built-in default skills are shipped with the agent and can never be removed.
    const defaults = await resolveDefaultSkills();
    const isDefault = defaults.some((def) => def.name.trim().toLowerCase() === requestedKey);
    if (isDefault) {
      return {
        ok: false,
        error: {
          code: "cannot_delete_default_skill",
          message: DELETE_DEFAULT_SKILL_ERROR,
        },
      };
    }

    // The name must match an existing (user-defined) skill exactly (case-insensitive).
    const match = runtime.definitions.find(
      (def) => def.name.trim().toLowerCase() === requestedKey,
    );
    if (!match) {
      const names = runtime.definitions
        .map((def) => def.name.trim())
        .filter((name) => name.length > 0);
      return {
        ok: false,
        error: {
          code: "unknown_skill",
          message:
            `No skill named "${requested}" exists. ` +
            (names.length > 0
              ? `Available skills: ${names.join(", ")}.`
              : "There are no skills to delete."),
        },
      };
    }

    // The frontend removes the skill from the user's saved skills (its local SQLite database) when
    // it sees this result, mirroring how create_skill persists a newly created skill.
    return {
      ok: true,
      data: {
        deleted_skill: match.name,
        message:
          `Deleted skill "${match.name}". It has been removed from the user's saved skills and is ` +
          "no longer available to list_skills or skill_initialize.",
      },
    };
  },
});
