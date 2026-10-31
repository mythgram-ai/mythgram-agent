import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z
  .object({
    project_id: z
      .string()
      .describe(
        "The unique ID of the slide project to convert into a reusable slide template.",
      ),
  })
  .strict();

export const saveSlidesAsTemplateTool = defineTool({
  name: "save_slides_as_template",
  description:
    "Save an existing slide project as a reusable slide template. The template is created from the specified project and made available for future slide projects.",
  schema,
  label: () => "Save slide project as template",
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.slides) {
      return {
        ok: false,
        error: {
          code: "slides_unavailable",
          message:
            "save_slides_as_template is only available on the Main Agent, Custom Agents, and " +
            "multi-agent (team/leader/CEO) agents.",
        },
      };
    }
    return ctx.slides.saveAsTemplate(args.project_id, ctx);
  },
});