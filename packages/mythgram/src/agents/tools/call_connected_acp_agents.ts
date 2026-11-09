import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireAcpAgents } from "./acpAgentManagement.js";

const agentSchema = z
  .object({
    acp_agent_id: z
      .string()
      .trim()
      .min(1, "The ACP agent id is required.")
      .describe(
        "The unique ID of the connected ACP agent. Obtain this ID using list_available_acp_agents.",
      ),
    prompt: z
      .string()
      .trim()
      .min(1, "A prompt is required.")
      .describe("The task instructions or prompt to send to the ACP agent."),
    wait_for_output: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Whether to wait for the ACP agent to finish and return its output. Defaults to true. " +
          "When true, this call blocks until the agent completes and its final message is returned " +
          "inline. When false, the agent is launched detached in the background: the call returns " +
          "immediately, the agent's final output is written to a '.mythgram/acp' file (read it later " +
          "with file_read), and it keeps running even if this turn ends. Entries are independent — " +
          "you can wait on some agents while others run in the background in the same call.",
      ),
  })
  .strict();

const schema = z
  .object({
    agents: z
      .array(agentSchema)
      .min(1)
      .describe(
        "The list of connected ACP agents to call concurrently. Each item is one independent ACP " +
          "agent execution with its own prompt and wait/background behaviour. Provide at least one " +
          "entry; add more to fan work out across several ACP agents at once.",
      ),
  })
  .strict();

type CallConnectedAcpAgentsArgs = z.infer<typeof schema>;

/**
 * call_connected_acp_agents — call one or more connected ACP-compatible agents.
 *
 * Each entry names an agent by its unique id, carries its own prompt, and independently chooses
 * whether to wait for the final output (true, default) or run detached in the background (false).
 * Calls reuse the ACP session bound to the current Mythgram chat, so the external agent keeps its
 * context; use start_new_acp_agent_session to force a fresh one.
 */
export const callConnectedAcpAgentsTool = defineTool({
  name: "call_connected_acp_agents",
  description:
    "Call one or multiple connected ACP-compatible agents to perform tasks. Each agent can receive a separate prompt and independently specify whether to wait for its output.",
  schema,
  label: (args: CallConnectedAcpAgentsArgs) => {
    const agents = Array.isArray(args.agents) ? args.agents : [];
    const names = agents
      .map((a) => (typeof a.acp_agent_id === "string" ? a.acp_agent_id : ""))
      .filter((id) => id.length > 0);
    const shown = names.slice(0, 3).join(", ");
    const extra = names.length > 3 ? `, +${names.length - 3} more` : "";
    return `ACP Agents (${agents.length}): ${shown}${extra}`.trim();
  },
  async execute(args: CallConnectedAcpAgentsArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireAcpAgents(ctx);
    if (unavailable) return unavailable;
    return ctx.acpAgents!.call({ agents: args.agents }, ctx);
  },
});
