import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireCustomAgents } from "./customAgentManagement.js";

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "The exact custom agent name is required.")
      .describe(
        "The exact name of the custom agent to delete. use list_available_custom_agent for getting available custom agents list.",
      ),
  })
  .strict();

type DeleteAgentArgs = z.infer<typeof schema>;

/**
 * delete_agent — delete an existing custom AI agent by its exact name.
 *
 * Call list_available_agents first to get the exact name of the agent to delete;
 * never invent or guess a name. Only delete an agent when the user explicitly asks
 * for it.
 */
export const deleteAgentTool = defineTool({
  name: "delete_agent",
  description: "Delete an existing custom AI agent by its exact name.",
  schema,
  label: (args: DeleteAgentArgs) => {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    return name ? `Delete Agent: ${name}` : "Delete Agent";
  },
  async execute(args: DeleteAgentArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireCustomAgents(ctx);
    if (unavailable) return unavailable;
    return ctx.customAgents!.removeByName(args.name, ctx);
  },
});
