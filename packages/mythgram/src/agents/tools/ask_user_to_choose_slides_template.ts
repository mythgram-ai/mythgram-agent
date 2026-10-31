import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({}).strict();

export const askUserToChooseSlidesTemplateTool = defineTool({
  name: "ask_user_to_choose_slides_template",
  description:
    "Display all available slide templates to the user and ask user to choose one. The tool automatically retrieves the complete list of available templates, Returns the user's selection, including the selected template ID.",
  schema,
  label: () => "Ask user to choose a slide template",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.slides) {
      return {
        ok: false,
        error: {
          code: "slides_unavailable",
          message:
            "ask_user_to_choose_slides_template is only available on the Main Agent, Custom Agents, " +
            "and multi-agent (team/leader/CEO) agents.",
        },
      };
    }
    return ctx.slides.askUserToChooseTemplate(ctx);
  },
});