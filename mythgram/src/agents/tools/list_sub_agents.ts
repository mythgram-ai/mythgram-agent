import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({});

export const listSubAgentsTool = defineTool({
  name: "list_sub_agents",
  description:
    "Returns a list of all available sub-agents (name and description). Use this to discover which " +
    "specialized sub-agents can be delegated work with call_sub_agent.",
  schema,
  label: () => "List Sub-Agents",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const available = ctx.subAgents?.available() ?? [];
    return {
      ok: true,
      data: {
        available_sub_agents: available.map((a) => ({
          name: a.name,
          description: a.description,
        })),
      },
    };
  },
});
