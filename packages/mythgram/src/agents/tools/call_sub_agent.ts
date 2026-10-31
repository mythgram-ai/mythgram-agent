import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({
  agent: z
    .string()
    .describe(
      "The name of the specialized sub-agent to execute the task. Call list_sub_agents first to " +
        "discover the available sub-agents and their names.",
    ),
  task: z
    .string()
    .describe("A clear and detailed description of the task that the selected sub-agent should complete."),
  wait_for_output: z
    .boolean()
    .describe(
      "Whether to wait for the sub-agent to finish and return its final result. Set to true when " +
        "the result is needed immediately; set to false to run the sub-agent in the background " +
        "without waiting for its output. When false, the tool returns right away with the path of a " +
        '".mythgram/sub-agent" file where the sub-agent\'s output will be written — read it later with ' +
        "file_read. Background sub-agents keep running even if this main agent is aborted or stops.",
    ),
  send_my_context: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Whether to share YOUR current conversation context with the sub-agent so it understands the " +
        "broader goal behind the delegated task. Defaults to false. When true, a summary of this " +
        "conversation so far (the user's requests, your relevant replies, and recent tool results) is " +
        "handed to the sub-agent alongside 'task', giving it the background it needs to act correctly. " +
        "By default (false) the sub-agent sees ONLY 'task' and nothing about this conversation, so set " +
        "this to true whenever the task depends on context the sub-agent would otherwise be missing. " +
        "Prefer putting critical specifics directly in 'task'; use this to add the surrounding intent.",
    ),
});

export const callSubAgentTool = defineTool({
  name: "call_sub_agent",
  description:
    "Call a specialized sub-agent to perform a specific task. Use this tool when a dedicated " +
    "sub-agent is better suited for the requested work or can complete the task faster. The " +
    "sub-agent runs as a separate call with its own tools and memory. Set wait_for_output=true to " +
    "wait for and receive its final result; set wait_for_output=false to run it in the background " +
    "(the tool returns immediately with a file path where the output will be stored for you to read " +
    "later, and the background sub-agent keeps running independently of this main agent). By default " +
    "the sub-agent cannot see this conversation, so put everything it needs into 'task'; set " +
    "send_my_context=true to additionally share a summary of your current conversation so it grasps " +
    "the broader goal.",
  schema,
  label: (args) =>
    `Sub-Agent: ${args.agent}${args.wait_for_output === false ? " (background)" : ""}` +
    `${args.send_my_context === true ? " (+context)" : ""}`,
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
    return ctx.subAgents.run(
      {
        agent: args.agent,
        task: args.task,
        wait_for_output: args.wait_for_output,
        send_my_context: args.send_my_context,
      },
      ctx,
    );
  },
});
