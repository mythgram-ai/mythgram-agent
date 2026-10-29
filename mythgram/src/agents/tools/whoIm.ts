import { z } from "zod";
import { defineTool, type AgentInfoRuntime, type AgentSelfInfo, type ToolContext, type ToolResult } from "./types.js";

const schema = z.object({}).strict();

/** Runtime-overridable clock so tests can assert a stable timestamp. */
let now: () => Date = () => new Date();

/** Test hook: freeze/replace the clock used to stamp `generated_at`. */
export function setAgentInfoClock(clock: () => Date): void {
  now = clock;
}

/**
 * Build an AgentInfoRuntime from a (possibly partial) snapshot. Missing optional sections are
 * omitted from the returned object so the tool only reports what the surface actually knows.
 */
export function createAgentInfoRuntime(info: AgentSelfInfo): AgentInfoRuntime {
  const snapshot: AgentSelfInfo = { ...info };
  return {
    describe: () => ({ ...snapshot, generated_at: snapshot.generated_at || now().toISOString() }),
  };
}

export const whoImTool = defineTool({
  name: "who_im",
  description:
    "Get information about yourself, including your identity, model, capabilities, available " +
    "tools, context limits, connected integrations, available skills and sub-agents, the active " +
    "user profile, and more about you. Use this whenever you need to know who you are, what you " +
    "can do, or what resources are available to you before answering or acting.",
  schema,
  label: () => "Who am I",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const runtime = ctx.agentInfo;
    if (!runtime) {
      return {
        ok: false,
        error: {
          code: "no_agent_info",
          message:
            "who_im is unavailable: no agent self-description runtime is present for this tool call.",
        },
      };
    }

    try {
      const info = runtime.describe();
      const data = compact(info);
      return {
        ok: true,
        data,
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "agent_info_failed",
          message: `Could not assemble agent information: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
});

/**
 * Drop empty/undefined optional sections so the returned payload stays compact and only contains
 * meaningful information (never a page of empty arrays).
 */
function compact(info: AgentSelfInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {
    agent: info.agent,
    model: info.model,
    context: info.context,
    workspace_root: info.workspace_root,
    generated_at: info.generated_at,
  };
  if (info.skills && info.skills.length > 0) out.skills = info.skills;
  if (info.sub_agents && info.sub_agents.length > 0) out.sub_agents = info.sub_agents;
  if (info.mcp_servers && info.mcp_servers.length > 0) out.mcp_servers = info.mcp_servers;
  if (info.connectors && info.connectors.length > 0) out.connectors = info.connectors;
  if (info.user_profile) out.user_profile = info.user_profile;
  if (info.memory && info.memory.file_count > 0) out.memory = info.memory;
  if (info.knowledge && info.knowledge.file_count > 0) out.knowledge = info.knowledge;
  if (info.todos && info.todos.total > 0) out.todos = info.todos;
  return out;
}
