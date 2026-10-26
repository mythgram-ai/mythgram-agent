import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/**
 * Shared guard for the prompt-library tools: the runtime is only present for the top-level surfaces
 * that may manage the user's saved prompts (Main Agent, Custom Agents, and every agent inside a
 * multi-agent team or CEO system). It is absent for sub-agents, chat mode, and the memory agent, so
 * those surfaces get a clear structured error instead of a crash.
 */
export function requirePromptLibrary(ctx: ToolContext): ToolResult | null {
  if (!ctx.promptLibrary) {
    return {
      ok: false,
      error: {
        code: "prompt_library_unavailable",
        message:
          "The prompt-library tools are not available in this context (the prompt library is only " +
          "accessible to the Main Agent, Custom Agents, and multi-agent team/CEO agents, not to " +
          "sub-agents).",
      },
    };
  }
  return null;
}

const schema = z.object({}).strict();

type ListAvailablePromptsArgs = z.infer<typeof schema>;

/**
 * list_available_prompts_in_prompt_library — enumerate the user's saved prompts (id + title + short
 * description) so the agent can discover what exists and use an EXACT id for deletion.
 */
export const listAvailablePromptsInPromptLibraryTool = defineTool({
  name: "list_available_prompts_in_prompt_library",
  description: "List the prompts currently available in the prompt library.",
  schema,
  label: (_args: ListAvailablePromptsArgs) => "Prompt library: list",
  async execute(_args: ListAvailablePromptsArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requirePromptLibrary(ctx);
    if (unavailable) return unavailable;
    return ctx.promptLibrary!.list();
  },
});
