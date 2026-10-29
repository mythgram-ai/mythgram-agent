import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z
  .object({
    template_ids: z
      .array(
        z
          .string()
          .describe("The unique ID of an available slide template."),
      )
      .min(1)
      .describe(
        "The IDs of the slide templates to read. Multiple templates can be read in a single call.",
      ),
  })
  .strict();

export const readSlidesTemplateTool = defineTool({
  name: "read_slides_template",
  description:
    "Read one or more slide templates by their IDs. Returns the available template content so you can inspect the slide structure, layout, design, and other template details.",
  schema,
  label: (args) => {
    const count = Array.isArray(args.template_ids) ? args.template_ids.length : 0;
    return `Read ${count} slide template${count === 1 ? "" : "s"}`;
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.slides) {
      return {
        ok: false,
        error: {
          code: "slides_unavailable",
          message:
            "read_slides_template is only available on the Main Agent, Custom Agents, and " +
            "multi-agent (team/leader/CEO) agents.",
        },
      };
    }
    const unique = Array.from(new Set(args.template_ids));
    if (unique.length !== args.template_ids.length) {
      return {
        ok: false,
        error: {
          code: "duplicate_template_ids",
          message: "template_ids must not contain duplicate IDs.",
        },
      };
    }
    return ctx.slides.readTemplates(unique);
  },
});