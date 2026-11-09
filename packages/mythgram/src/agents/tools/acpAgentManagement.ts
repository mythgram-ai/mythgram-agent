import type { ToolContext, ToolResult } from "./types.js";

/**
 * Shared plumbing for the six agent-driven ACP-agent tools.
 *
 * These tools let the agent drive EXTERNAL ACP-compatible agents (Claude Agent, Codex, Gemini CLI,
 * OpenCode, Goose, ...) through the SAME in-app AcpClientManager the console's ACP panel uses:
 *
 *   - connect_acp_agents             — self-connect a new ACP-compatible agent (name + command + args)
 *   - list_available_acp_agents      — list every connected agent (id + name + status)
 *   - delete_acp_agents              — disconnect and remove a connected agent by id
 *   - call_connected_acp_agents      — send a prompt to one or more agents (wait or background)
 *   - Interrupt_acp_agent            — interrupt a running agent task and send a new prompt
 *   - start_new_acp_agent_session    — start a fresh session for an existing connected agent
 *
 * This file is only the agent-facing glue (tool-name registry + context guard). The persistent
 * bridge lives in agents/acpAgents.ts (AcpAgentsRuntime).
 */

/** The six agent-driven ACP-agent tool names (single source of truth). */
export const ACP_AGENT_MANAGEMENT_TOOL_NAMES: readonly string[] = [
  "connect_acp_agents",
  "list_available_acp_agents",
  "delete_acp_agents",
  "call_connected_acp_agents",
  "Interrupt_acp_agent",
  "start_new_acp_agent_session",
];

const ACP_AGENT_TOOL_NAMES = new Set<string>(ACP_AGENT_MANAGEMENT_TOOL_NAMES);

/** True when a tool name is one of the agent-driven ACP-agent tools. */
export function isAcpAgentManagementTool(name: string): boolean {
  return ACP_AGENT_TOOL_NAMES.has((name ?? "").trim());
}

/**
 * Shared guard: the ACP-agent tools need the ACP-agents runtime, so they only work where it is
 * injected (main / custom / team / CEO agents) and never for sub-agents, chat mode, or the memory
 * agent.
 */
export function requireAcpAgents(ctx: ToolContext): ToolResult | null {
  if (!ctx.acpAgents) {
    return {
      ok: false,
      error: {
        code: "acp_agents_unavailable",
        message:
          "ACP-agent tools are not available in this context. They are only available to the main agent, custom agents, and team/CEO agents.",
      },
    };
  }
  return null;
}
