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
        "The unique ID of the ACP agent whose currently running task should be interrupted.",
      ),
    prompt: z
      .string()
      .trim()
      .min(1, "An interruption prompt is required.")
      .describe("The interruption instruction or message to send to the ACP agent."),
  })
  .strict();

type InterruptAcpAgentArgs = z.infer<typeof schema>;

/**
 * Interrupt_acp_agent — interrupt a currently running ACP agent task and send a new prompt.
 *
 * The running turn is cancelled and, once the agent releases the session, the supplied prompt is
 * sent as the next turn. The agent's final output for the new prompt is returned inline.
 */
export const interruptAcpAgentTool = defineTool({
  name: "Interrupt_acp_agent",
  description:
    "Interrupt a currently running ACP agent task and provide an interruption prompt or instruction explaining what should happen next.",
  schema,
  label: (args: InterruptAcpAgentArgs) => {
    const id = typeof args.acp_agent_id === "string" ? args.acp_agent_id.trim() : "";
    return id ? `Interrupt ACP Agent: ${id}` : "Interrupt ACP Agent";
  },
  async execute(args: InterruptAcpAgentArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireAcpAgents(ctx);
    if (unavailable) return unavailable;
    return ctx.acpAgents!.interrupt(args.acp_agent_id, args.prompt, ctx);
  },
});
