import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireCustomAgents } from "./customAgentManagement.js";

const schema = z.object({}).strict();

type ListAvailableAgentsArgs = z.infer<typeof schema>;

/**
 * list_available_agents — list all custom AI agents by exact name + short description.
 *
 * Use this to discover which custom agents exist before deleting one by exact name,
 * and whenever the user asks what custom agents they already have.
 */
export const listAvailableAgentsTool = defineTool({
  name: "list_available_agents",
  description: "List all custom AI agents currently available to the user.",
  schema,
  label: (_args: ListAvailableAgentsArgs) => "List Agents",
  async execute(
    _args: ListAvailableAgentsArgs,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const unavailable = requireCustomAgents(ctx);
    if (unavailable) return unavailable;
    return ctx.customAgents!.list();
  },
});
