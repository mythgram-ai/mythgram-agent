import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requirePromptLibrary } from "./list_available_prompts_in_prompt_library.js";

const schema = z
  .object({
    title: z.string().describe("A short, clear title for the prompt."),
    description: z
      .string()
      .describe("A brief description explaining what the prompt is used for."),
    prompt: z
      .string()
      .describe(
        "The complete prompt content to save in the prompt library. Preserve the prompt exactly " +
          "as intended by the user.",
      ),
  })
  .strict();

type SavePromptArgs = z.infer<typeof schema>;

/**
 * save_prompt_in_prompt_library — store a reusable prompt in the user's prompt library.
 *
 * The library is persisted in the SQLite app_state document the frontend syncs, so a prompt saved
 * here survives restarts and appears in the Prompt Library page immediately (the runtime emits a
 * `prompt_library_updated` event). The prompt text is stored exactly as provided.
 */
export const savePromptInPromptLibraryTool = defineTool({
  name: "save_prompt_in_prompt_library",
  description:
    "Save a prompt to the prompt library. Use this tool when the user wants to store, save, or add " +
    "a prompt to their prompt library for future use. provide a title, a short description, and " +
    "the complete prompt.",
  schema,
  label: (args: SavePromptArgs) => {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    return title ? `Prompt library: save "${title}"` : "Prompt library: save";
  },
  async execute(args: SavePromptArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requirePromptLibrary(ctx);
    if (unavailable) return unavailable;
    return ctx.promptLibrary!.save(
      { title: args.title, description: args.description, prompt: args.prompt },
      ctx,
    );
  },
});
