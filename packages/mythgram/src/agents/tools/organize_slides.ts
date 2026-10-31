import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const slideSchema = z
  .object({
    html_file_path: z
      .string()
      .describe("The absolute path to the HTML file containing the slide deck."),
    slide_number: z
      .number()
      .int()
      .describe("The slide number to organize within the project."),
  })
  .strict();

const schema = z
  .object({
    project_name: z
      .string()
      .describe(
        "The name of the slide project. Only one project name can be provided per tool call.",
      ),
    slides: z
      .array(slideSchema)
      .min(1)
      .describe(
        "A list of slides to organize into the project. Multiple slides can be provided in a single call.",
      ),
  })
  .strict();

export const organizeSlidesTool = defineTool({
  name: "organize_slides",
  description:
    "Organize one or more HTML slide deck files into a single slide project. Each slide must include its HTML file path and slide number so it can be organized correctly. one project can include multiple slides.",
  schema,
  label: (args) => {
    const count = Array.isArray(args.slides) ? args.slides.length : 0;
    return `Organize ${count} slide${count === 1 ? "" : "s"}: ${args.project_name}`;
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.slides) {
      return {
        ok: false,
        error: {
          code: "slides_unavailable",
          message:
            "organize_slides is only available on the Main Agent, Custom Agents, and multi-agent " +
            "(team/leader/CEO) agents. It cannot run inside a sub-agent or chat mode.",
        },
      };
    }
    return ctx.slides.organizeSlides(args, ctx);
  },
});