import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requirePromptLibrary } from "./list_available_prompts_in_prompt_library.js";

const schema = z
  .object({
    prompt_id: z.string().describe("The unique ID of the prompt to delete from the prompt library."),
  })
  .strict();

type DeletePromptArgs = z.infer<typeof schema>;

/**
 * delete_prompt_from_prompt_library — permanently remove a saved prompt by its exact id.
 *
 * The library is the SAME persistent store the frontend syncs, so the deletion is durable and the
 * Prompt Library page updates immediately (the runtime emits a `prompt_library_updated` event).
 */
export const deletePromptFromPromptLibraryTool = defineTool({
  name: "delete_prompt_from_prompt_library",
  description:
    "Delete a prompt from the prompt library. Use this tool when the user wants to remove or delete " +
    "a saved prompt from their prompt library. provide the exact prompt ID of the prompt to " +
    "delete. If the prompt ID is not known, first use list_available_prompts_in_prompt_library to " +
    "find the available prompts and their IDs.",
  schema,
  label: (args: DeletePromptArgs) => {
    const id = typeof args.prompt_id === "string" ? args.prompt_id.trim() : "";
    return id ? `Prompt library: delete ${id}` : "Prompt library: delete";
  },
  async execute(args: DeletePromptArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requirePromptLibrary(ctx);
    if (unavailable) return unavailable;
    return ctx.promptLibrary!.remove(args.prompt_id, ctx);
  },
});
