import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z
  .object({
    project_id: z
      .string()
      .describe("The unique ID of the slide project to manage."),
    action: z
      .enum([
        "delete_slide",
        "replace_slide",
        "change_slide_position",
        "rename_slide_project",
        "delete_slide_project",
      ])
      .describe("The operation to perform on the slide project."),
    slide_number: z
      .number()
      .int()
      .optional()
      .describe(
        "The current slide number. Required for delete_slide, replace_slide, and change_slide_position.",
      ),
    html_file_path: z
      .string()
      .optional()
      .describe(
        "The path to the replacement HTML slide file. Required for replace_slide.",
      ),
    new_position: z
      .number()
      .int()
      .optional()
      .describe(
        "The desired position of the slide within the project. Required for change_slide_position.",
      ),
    new_project_name: z
      .string()
      .optional()
      .describe(
        "The new name for the slide project. Required for rename_slide_project.",
      ),
  })
  .strict();

export const manageSlidesTool = defineTool({
  name: "manage_slides",
  description:
    "Manage an existing slide project. Supports deleting a slide, replacing a slide's HTML file, changing a slide's position, renaming the project, or deleting the entire project. The slide project ID is required for every operation. Provide the additional parameters required by the selected operation.",
  schema,
  label: (args) => `Manage slides: ${args.action}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.slides) {
      return {
        ok: false,
        error: {
          code: "slides_unavailable",
          message:
            "manage_slides is only available on the Main Agent, Custom Agents, and multi-agent " +
            "(team/leader/CEO) agents.",
        },
      };
    }

    // Action-specific required arguments are validated here (not in the zod schema) so the
    // model gets a clear, actionable error instead of a generic invalid_arguments failure.
    if (
      (args.action === "delete_slide" ||
        args.action === "replace_slide" ||
        args.action === "change_slide_position") &&
      args.slide_number === undefined
    ) {
      return {
        ok: false,
        error: {
          code: "slide_number_required",
          message: `slide_number is required for action "${args.action}".`,
        },
      };
    }
    if (args.action === "replace_slide" && !args.html_file_path?.trim()) {
      return {
        ok: false,
        error: {
          code: "html_file_path_required",
          message: "html_file_path is required for action \"replace_slide\".",
        },
      };
    }
    if (args.action === "change_slide_position" && args.new_position === undefined) {
      return {
        ok: false,
        error: {
          code: "new_position_required",
          message: "new_position is required for action \"change_slide_position\".",
        },
      };
    }
    if (args.action === "rename_slide_project" && !args.new_project_name?.trim()) {
      return {
        ok: false,
        error: {
          code: "new_project_name_required",
          message: "new_project_name is required for action \"rename_slide_project\".",
        },
      };
    }

    return ctx.slides.manageSlides(args, ctx);
  },
});