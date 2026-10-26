import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireCustomSystemPrompts } from "./list_available_custom_system_prompt.js";

const schema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[0-9]{20}$/, "The id must be the exact 20-digit id of the custom system prompt.")
      .describe("The exact 20-digit ID of the custom system prompt to delete."),
  })
  .strict();

type DeleteCustomSystemPromptArgs = z.infer<typeof schema>;

/**
 * delete_custom_system_prompt — permanently remove a saved custom system prompt by its
 * exact 20-digit id.
 *
 * Call list_available_custom_system_prompt first to get the exact id of the prompt to
 * delete; never invent or modify ids. The backend verifies the prompt exists before deleting it.
 */
export const deleteCustomSystemPromptTool = defineTool({
  name: "delete_custom_system_prompt",
  description:
    "Delete an existing custom system prompt using its exact 20-digit ID. Obtain the ID from list_available_custom_system_prompt or another trusted source. Do not invent or modify IDs. The backend should verify that the prompt exists before deleting it.",
  schema,
  label: (args: DeleteCustomSystemPromptArgs) => {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    return id ? `Custom system prompt: delete ${id}` : "Custom system prompt: delete";
  },
  async execute(args: DeleteCustomSystemPromptArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireCustomSystemPrompts(ctx);
    if (unavailable) return unavailable;
    return ctx.customSystemPrompts!.remove(args.id, ctx);
  },
});
