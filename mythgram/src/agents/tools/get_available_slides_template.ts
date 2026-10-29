import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({}).strict();

export const getAvailableSlidesTemplateTool = defineTool({
  name: "get_available_slides_template",
  description:
    "Get a list of all available slide templates, including their IDs and any available descriptive information.",
  schema,
  label: () => "List slide templates",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.slides) {
      return {
        ok: false,
        error: {
          code: "slides_unavailable",
          message:
            "get_available_slides_template is only available on the Main Agent, Custom Agents, and " +
            "multi-agent (team/leader/CEO) agents.",
        },
      };
    }
    return ctx.slides.listTemplates();
  },
});