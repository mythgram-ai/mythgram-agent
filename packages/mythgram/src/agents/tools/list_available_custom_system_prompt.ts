import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/**
 * Shared guard for the custom-system-prompt tools: the runtime is only present for the
 * top-level surfaces that may manage the user's saved custom system prompts (Main Agent,
 * Custom Agents, and every agent inside a multi-agent team or CEO system). It is absent for
 * sub-agents, chat mode, and the memory agent, so those surfaces get a clear structured
 * error instead of a crash.
 */
export function requireCustomSystemPrompts(ctx: ToolContext): ToolResult | null {
  if (!ctx.customSystemPrompts) {
    return {
      ok: false,
      error: {
        code: "custom_system_prompts_unavailable",
        message:
          "The custom-system-prompt tools are not available in this context (custom system prompts are only " +
          "accessible to the Main Agent, Custom Agents, and multi-agent team/CEO agents, not to " +
          "sub-agents).",
      },
    };
  }
  return null;
}

const schema = z.object({}).strict();

type ListAvailableCustomSystemPromptArgs = z.infer<typeof schema>;

/**
 * list_available_custom_system_prompt — enumerate the user's saved custom system prompts
 * (name + short description + exact 20-digit id) so the agent can discover what exists
 * and use an EXACT id for deletion. Read-only: never creates, updates, or deletes prompts.
 */
export const listAvailableCustomSystemPromptTool = defineTool({
  name: "list_available_custom_system_prompt",
  description:
    "List all available saved custom system prompts. Return each prompt's name, short description, and exact 20-digit ID. Do not modify, omit, or fabricate prompt IDs. This tool is read-only and does not create, update, or delete prompts.",
  schema,
  label: (_args: ListAvailableCustomSystemPromptArgs) => "Custom system prompt: list",
  async execute(
    _args: ListAvailableCustomSystemPromptArgs,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const unavailable = requireCustomSystemPrompts(ctx);
    if (unavailable) return unavailable;
    return ctx.customSystemPrompts!.list();
  },
});
