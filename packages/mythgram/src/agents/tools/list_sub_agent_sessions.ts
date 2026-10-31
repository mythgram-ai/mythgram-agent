import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({});

export const listSubAgentSessionsTool = defineTool({
  name: "list_sub_agent_sessions",
  description:
    "List all sub-agent sessions that have been created by call_sub_agent or " +
    "call_multiple_sub_agents. Each session represents a specific sub-agent run and contains its " +
    "session ID and relevant session metadata. Use the returned session IDs with " +
    "reuse_same_sub_agent_session to continue a previously completed or running sub-agent session " +
    "with its existing conversation context.",
  schema,
  label: () => "List Sub-Agent Sessions",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const runtime = ctx.subAgents;
    if (!runtime) {
      return {
        ok: false,
        error: {
          code: "sub_agents_unavailable",
          message:
            "The sub-agent runtime is not available in this context. list_sub_agent_sessions can " +
            "only be used by the main agent.",
        },
      };
    }

    const sessions = runtime.listSessions();
    return {
      ok: true,
      data: {
        count: sessions.length,
        sessions: sessions.map((s) => ({
          session_id: s.session_id,
          agent: s.agent,
          status: s.status,
        })),
        message:
          sessions.length > 0
            ? `${sessions.length} sub-agent session(s) available. Continue one with ` +
              "reuse_same_sub_agent_session using its session_id."
            : "No sub-agent sessions have been created yet. Run a sub-agent with call_sub_agent or " +
              "call_multiple_sub_agents first.",
      },
    };
  },
});
