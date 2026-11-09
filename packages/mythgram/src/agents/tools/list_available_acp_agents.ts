import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireAcpAgents } from "./acpAgentManagement.js";

const schema = z.object({}).strict();

type ListAvailableAcpAgentsArgs = z.infer<typeof schema>;

/**
 * list_available_acp_agents — retrieve every connected ACP-compatible agent (id + name + status).
 *
 * Use this to discover the exact acp_agent_id before calling, deleting, interrupting, or starting a
 * new session for an ACP agent, and whenever the user asks which ACP agents are connected.
 */
export const listAvailableAcpAgentsTool = defineTool({
  name: "list_available_acp_agents",
  description:
    "Retrieve a list of all connected ACP-compatible agents, including their unique IDs, names, and availability information.",
  schema,
  label: (_args: ListAvailableAcpAgentsArgs) => "List ACP Agents",
  async execute(_args: ListAvailableAcpAgentsArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireAcpAgents(ctx);
    if (unavailable) return unavailable;
    return ctx.acpAgents!.list();
  },
});
