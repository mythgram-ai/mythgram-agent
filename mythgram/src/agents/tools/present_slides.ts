import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z
  .object({
    project_ids: z
      .array(
        z
          .string()
          .describe("The unique ID of a slide project."),
      )
      .min(1)
      .describe(
        "The IDs of the slide projects to present to the user. Multiple projects can be presented in a single call.",
      ),
  })
  .strict();

export const presentSlidesTool = defineTool({
  name: "present_slides",
  description:
    "Present slide project previews to the user. Accepts one or more slide project IDs and displays the corresponding project previews.",
  schema,
  label: (args) => {
    const count = Array.isArray(args.project_ids) ? args.project_ids.length : 0;
    return `Present ${count} slide project${count === 1 ? "" : "s"}`;
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.slides) {
      return {
        ok: false,
        error: {
          code: "slides_unavailable",
          message:
            "present_slides is only available on the Main Agent, Custom Agents, and multi-agent " +
            "(team/leader/CEO) agents.",
        },
      };
    }
    // uniqueItems in the spec: reject duplicates instead of silently de-duplicating.
    const unique = Array.from(new Set(args.project_ids));
    if (unique.length !== args.project_ids.length) {
      return {
        ok: false,
        error: {
          code: "duplicate_project_ids",
          message: "project_ids must not contain duplicate IDs.",
        },
      };
    }
    return ctx.slides.presentProjects(unique, ctx);
  },
});