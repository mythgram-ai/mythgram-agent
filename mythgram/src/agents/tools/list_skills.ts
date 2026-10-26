import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({});

export const listSkillsTool = defineTool({
  name: "list_skills",
  description:
    "Returns a list of all available skills. A skill is a reusable, packaged capability (a folder " +
    "named after the skill containing an entry SKILL.md plus optional reference/example/script " +
    "files) that teaches you how to perform a specific type of task. Call this to discover which " +
    "skills exist and what files each contains, then use skill_initialize to materialize the ones " +
    "you need onto disk before reading them with file_read.",
  schema,
  label: () => "List Skills",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const skills = ctx.skills?.list() ?? [];
    return {
      ok: true,
      data: {
        count: skills.length,
        skills: skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          skill_file: skill.skill_file,
          files: skill.files,
          tree: skill.tree,
        })),
      },
    };
  },
});
