import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireCustomSystemPrompts } from "./list_available_custom_system_prompt.js";

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "A unique, human-readable name for the custom system prompt is required.")
      .describe("A unique, human-readable name for the custom system prompt."),
    description: z
      .string()
      .trim()
      .min(1, "A short description of the purpose and behavior is required.")
      .describe("A short description of the purpose and behavior of the custom system prompt."),
    file_path: z
      .string()
      .trim()
      .min(1, "The absolute filesystem path to the existing file is required.")
      .describe(
        "The absolute filesystem path to the existing file containing the complete system prompt. The backend reads the file contents and saves them as the prompt.",
      ),
  })
  .strict();

type SaveCustomSystemPromptArgs = z.infer<typeof schema>;

/**
 * save_custom_system_prompt — save a custom system prompt from an existing file.
 *
 * Flow the model must follow: first create the file holding the complete system prompt
 * (with file_write / apply_patch), then call this tool with the prompt name, a short
 * description, and that file's absolute path. The file's FULL contents are saved as the
 * new custom system prompt verbatim. The prompt content is never passed inline — only
 * the file path travels on the wire. Each saved prompt receives an exact 20-digit id.
 */
export const saveCustomSystemPromptTool = defineTool({
  name: "save_custom_system_prompt",
  description:
    "Save a custom system prompt from an existing file. First, use the available file-writing tool to create a file containing the complete system prompt. Then call this tool with the prompt name, a short description, and the absolute path to the file. The backend reads the file contents and stores them as the custom system prompt. Do not pass the prompt content directly to this tool; pass the absolute file path.",
  schema,
  label: (args: SaveCustomSystemPromptArgs) => {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    return name ? `Custom system prompt: save "${name}"` : "Custom system prompt: save";
  },
  async execute(args: SaveCustomSystemPromptArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireCustomSystemPrompts(ctx);
    if (unavailable) return unavailable;
    return ctx.customSystemPrompts!.save(
      {
        name: args.name,
        description: args.description,
        filePath: args.file_path,
      },
      ctx,
    );
  },
});
