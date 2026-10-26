import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const agentSchema = z.object({
  agent: z
    .string()
    .describe(
      "The name of the specialized sub-agent to run for this entry. Call list_sub_agents first to " +
        "discover the available sub-agents and their names.",
    ),
  prompt: z
    .string()
    .describe(
      "A clear, detailed, self-contained description of the task this specific sub-agent should " +
        "complete. Each sub-agent only sees its own prompt (plus your shared context if " +
        "send_my_output is true), so put everything it needs to act correctly right here.",
    ),
  wait_for_output: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Whether to wait for THIS sub-agent to finish and receive its final output before you " +
        "continue. Defaults to true. When true, you block until this sub-agent completes and its " +
        "output is returned inline. When false, this sub-agent is launched detached in the " +
        "background: the call does not wait for it, its final report is written to its own " +
        '".mythgram/sub-agent" file (read it later with file_read), and it keeps running even if you ' +
        "move on or this turn ends. Entries are independent — you can wait on some while others run " +
        "in the background in the same call.",
    ),
  send_my_output: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Whether to share YOUR current conversation/output context with THIS sub-agent so it " +
        "understands the broader goal behind its task. Defaults to false. When true, a summary of " +
        "your conversation so far is handed to the sub-agent alongside its prompt. When false the " +
        "sub-agent sees ONLY its prompt and nothing about this conversation. Prefer putting critical " +
        "specifics directly in 'prompt'; use this to add the surrounding intent.",
    ),
});

const schema = z.object({
  agents: z
    .array(agentSchema)
    .min(1)
    .describe(
      "The list of sub-agents to run concurrently. Each item is one fully independent sub-agent " +
        "execution with its own prompt, its own session, and its own wait/background behaviour. " +
        "Provide at least one entry; add more to fan work out across several sub-agents at once.",
    ),
});

export const callMultipleSubAgentsTool = defineTool({
  name: "call_multiple_sub_agents",
  description:
    "Call multiple specialized sub-agents concurrently in a single tool call. This is the batch " +
    "form of call_sub_agent: it uses the exact same sub-agent system, but launches several " +
    "sub-agents at once so independent tasks run in parallel. Each entry in 'agents' runs as its " +
    "own separate sub-agent — its own session id, system prompt, allowed tools, and memory — with " +
    "no access to the others. Per entry you control blocking with wait_for_output (true = wait for " +
    "and receive its result inline; false = run it detached in the background and read its output " +
    "file later) and context sharing with send_my_output. The call returns once every " +
    "wait_for_output=true sub-agent has finished (their outputs are returned) and every " +
    "wait_for_output=false sub-agent has been started in the background. Call list_sub_agents first " +
    "to discover which sub-agents exist. Prefer this over several separate call_sub_agent calls " +
    "when the tasks are independent and can run at the same time.",
  schema,
  label: (args) => {
    const agents = Array.isArray(args.agents) ? args.agents : [];
    const names = agents.map((a) => a.agent).filter((n) => typeof n === "string" && n.length > 0);
    const shown = names.slice(0, 3).join(", ");
    const extra = names.length > 3 ? `, +${names.length - 3} more` : "";
    return `Sub-Agents (${agents.length}): ${shown}${extra}`.trim();
  },
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.subAgents) {
      return {
        ok: false,
        error: {
          code: "sub_agents_unavailable",
          message: "Sub-agents are not available in this context.",
        },
      };
    }
    return ctx.subAgents.runMany(
      {
        agents: args.agents.map((a) => ({
          agent: a.agent,
          prompt: a.prompt,
          wait_for_output: a.wait_for_output,
          send_my_output: a.send_my_output,
        })),
      },
      ctx,
    );
  },
});
