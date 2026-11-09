import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireAcpAgents } from "./acpAgentManagement.js";

const schema = z
  .object({
    acp_agent_name: z
      .string()
      .trim()
      .min(1, "The ACP agent name is required.")
      .describe("A human-readable name for the ACP-compatible agent."),
    acp_agent_command: z
      .string()
      .trim()
      .min(1, "The ACP agent command is required.")
      .describe(
        "The executable command used to launch the ACP agent. Do not include command-line arguments here.",
      ),
    acp_agent_args: z
      .array(z.string())
      .describe(
        "Command-line arguments passed to the executable command. Include only arguments, not the executable command itself.",
      ),
  })
  .strict();

type ConnectAcpAgentsArgs = z.infer<typeof schema>;

/**
 * connect_acp_agents — self-connect a new ACP-compatible agent from a name, executable command, and
 * arguments.
 *
 * The agent is persisted through the SAME AcpClientManager the console's ACP panel uses and is then
 * spawned/initialized immediately, so it is ready to receive tasks with call_connected_acp_agents.
 * The command holds only the executable; every argument goes in acp_agent_args.
 */
export const connectAcpAgentsTool = defineTool({
  name: "connect_acp_agents",
  description:
    "Connect a new ACP-compatible agent to the system by providing its name, executable command, and command-line arguments. The args field must contain only arguments and must not include the command itself.",
  schema,
  label: (args: ConnectAcpAgentsArgs) => {
    const name = typeof args.acp_agent_name === "string" ? args.acp_agent_name.trim() : "";
    return name ? `Connect ACP: ${name}` : "Connect ACP Agent";
  },
  async execute(args: ConnectAcpAgentsArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireAcpAgents(ctx);
    if (unavailable) return unavailable;
    return ctx.acpAgents!.connect(
      {
        name: args.acp_agent_name,
        command: args.acp_agent_command,
        args: args.acp_agent_args,
      },
      ctx,
    );
  },
});
