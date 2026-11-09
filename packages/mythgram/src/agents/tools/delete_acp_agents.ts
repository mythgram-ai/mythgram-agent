import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireAcpAgents } from "./acpAgentManagement.js";

const schema = z
  .object({
    acp_agent_id: z
      .string()
      .trim()
      .min(1, "The ACP agent id is required.")
      .describe(
        "The unique ID of the connected ACP agent to disconnect and delete. Obtain this ID using list_available_acp_agents.",
      ),
  })
  .strict();

type DeleteAcpAgentsArgs = z.infer<typeof schema>;

/**
 * delete_acp_agents — disconnect and remove a connected ACP-compatible agent by its unique id.
 *
 * Call list_available_acp_agents first to get the exact id; never invent or guess one. Deleting an
 * agent stops its process and removes its stored connection and sessions.
 */
export const deleteAcpAgentsTool = defineTool({
  name: "delete_acp_agents",
  description:
    "Disconnect and remove a connected ACP-compatible agent from the system using its unique agent ID.",
  schema,
  label: (args: DeleteAcpAgentsArgs) => {
    const id = typeof args.acp_agent_id === "string" ? args.acp_agent_id.trim() : "";
    return id ? `Delete ACP Agent: ${id}` : "Delete ACP Agent";
  },
  async execute(args: DeleteAcpAgentsArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireAcpAgents(ctx);
    if (unavailable) return unavailable;
    return ctx.acpAgents!.remove(args.acp_agent_id, ctx);
  },
});
