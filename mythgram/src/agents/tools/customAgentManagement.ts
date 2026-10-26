import type { ToolContext, ToolResult } from "./types.js";

/**
 * Shared plumbing for the three agent-driven custom-agent management tools.
 *
 * Custom agents are user-created, independently-configured top-level Main Agents
 * (not sub-agents). Their configs live in the SQLite-backed `customAgents`
 * app_state document (see agents/customagent/manager.ts). These tools let the
 * Main Agent, Custom Agents, and every agent inside a multi-agent team or CEO
 * system create, list, and delete them without leaving the conversation:
 *
 *   - create_agent           — create from a workspace Markdown prompt file
 *   - list_available_agents  — list exact names + short descriptions
 *   - delete_agent           — delete by exact name
 *
 * This file is only the agent-facing glue (tool-name registry + context guard).
 * The persistent bridge lives in agents/customAgents.ts (CustomAgentsRuntime).
 */

/** The three agent-driven custom-agent management tool names (single source of truth). */
export const CUSTOM_AGENT_MANAGEMENT_TOOL_NAMES: readonly string[] = [
  "create_agent",
  "list_available_agents",
  "delete_agent",
];

const CUSTOM_AGENT_TOOL_NAMES = new Set<string>(CUSTOM_AGENT_MANAGEMENT_TOOL_NAMES);

/** True when a tool name is one of the agent-driven custom-agent management tools. */
export function isCustomAgentManagementTool(name: string): boolean {
  return CUSTOM_AGENT_TOOL_NAMES.has((name ?? "").trim());
}

/**
 * Shared guard: custom-agent management tools need the persistent custom-agents runtime,
 * so they only work where it is injected (main / custom / team / CEO agents) and never
 * for sub-agents, chat mode, or the memory agent.
 */
export function requireCustomAgents(ctx: ToolContext): ToolResult | null {
  if (!ctx.customAgents) {
    return {
      ok: false,
      error: {
        code: "custom_agents_unavailable",
        message:
          "Custom-agent management is not available in this context. It is only available to the main agent, custom agents, and team/CEO agents.",
      },
    };
  }
  return null;
}
