import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({
  session_id: z
    .string()
    .trim()
    .min(1, "A session id is required.")
    .describe(
      "The 10-character session ID of an existing sub-agent session returned by " +
        "list_sub_agent_sessions.",
    ),
  prompt: z
    .string()
    .trim()
    .min(1, "A non-empty prompt is required.")
    .describe("The follow-up instruction or question to send to the existing sub-agent session."),
});

export const reuseSameSubAgentSessionTool = defineTool({
  name: "reuse_same_sub_agent_session",
  description:
    "Continue an existing sub-agent session using its preserved conversation context. Provide the " +
    "session ID of a previously created sub-agent session and a new prompt. The sub-agent receives " +
    "the new prompt together with the complete context of that existing session, allowing you to " +
    "ask follow-up questions, request clarification, continue work, or obtain additional " +
    "information from the sub-agent.",
  schema,
  label: (args) => `Reuse Sub-Agent Session: ${args.session_id}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const runtime = ctx.subAgents;
    if (!runtime) {
      return {
        ok: false,
        error: {
          code: "sub_agents_unavailable",
          message:
            "The sub-agent runtime is not available in this context. reuse_same_sub_agent_session " +
            "can only be used by the main agent.",
        },
      };
    }

    return runtime.reuseSession({ session_id: args.session_id, prompt: args.prompt }, ctx);
  },
});
