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
        "The unique ID of the connected ACP agent for which a new session should be started.",
      ),
  })
  .strict();

type StartNewAcpAgentSessionArgs = z.infer<typeof schema>;

/**
 * start_new_acp_agent_session — start a fresh conversation session for an existing connected ACP
 * agent.
 *
 * By default call_connected_acp_agents reuses the session bound to the current chat (preserving the
 * external agent's context). This tool forces a brand-new session and rebinds it to the chat, so the
 * agent starts without any prior conversation context.
 */
export const startNewAcpAgentSessionTool = defineTool({
  name: "start_new_acp_agent_session",
  description:
    "Start a new conversation session for an existing connected ACP-compatible agent. This creates a fresh session without requiring the agent to be connected again.",
  schema,
  label: (args: StartNewAcpAgentSessionArgs) => {
    const id = typeof args.acp_agent_id === "string" ? args.acp_agent_id.trim() : "";
    return id ? `New ACP Session: ${id}` : "New ACP Session";
  },
  async execute(args: StartNewAcpAgentSessionArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireAcpAgents(ctx);
    if (unavailable) return unavailable;
    return ctx.acpAgents!.startNewSession(args.acp_agent_id, ctx);
  },
});
