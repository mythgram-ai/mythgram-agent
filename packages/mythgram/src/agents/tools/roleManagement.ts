import type { ToolContext, ToolResult } from "./types.js";

/**
 * Shared plumbing for the four agent-driven role management tools.
 *
 * A role is a single markdown document ("role.md") describing the persona the agent should adopt.
 * Definitions are authored in the frontend and travel with each turn (like skills). These tools let
 * the Main Agent, Custom Agents, and every agent inside a multi-agent team or CEO system manage the
 * user's roles without leaving the conversation:
 *
 *   - create_role — register a role from a workspace role.md file
 *   - list_role   — list ids + names + descriptions
 *   - read_role   — read one role by id
 *   - delete_role — delete by id
 *
 * This file is only the agent-facing glue (tool-name registry + context guard).
 */

/** The four agent-driven role management tool names (single source of truth). */
export const ROLE_MANAGEMENT_TOOL_NAMES: readonly string[] = [
  "create_role",
  "list_role",
  "read_role",
  "delete_role",
];

const ROLE_TOOL_NAMES = new Set<string>(ROLE_MANAGEMENT_TOOL_NAMES);

/** True when a tool name is one of the agent-driven role management tools. */
export function isRoleManagementTool(name: string): boolean {
  return ROLE_TOOL_NAMES.has((name ?? "").trim());
}

/**
 * Shared guard: role tools need the role runtime, so they only work where it is injected
 * (main / custom / team / CEO agents) and never for sub-agents, chat mode, or the memory agent.
 */
export function requireRoles(ctx: ToolContext): ToolResult | null {
  if (!ctx.roles) {
    return {
      ok: false,
      error: {
        code: "roles_unavailable",
        message:
          "Role management is not available in this context. It is only available to the main agent, custom agents, and team/CEO agents.",
      },
    };
  }
  return null;
}
