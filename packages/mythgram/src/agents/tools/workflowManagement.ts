import type { ToolContext, ToolResult } from "./types.js";

/**
 * Shared plumbing for the four agent-driven workflow management tools.
 *
 * A workflow is a single markdown document ("workflow.md") in which the user describes the process
 * the agent should follow. Definitions are authored in the frontend and travel with each turn (like
 * skills). These tools let the Main Agent, Custom Agents, and every agent inside a multi-agent team
 * or CEO system manage the user's workflows without leaving the conversation:
 *
 *   - create_workflow — register a workflow from a workspace workflow.md file
 *   - list_workflow   — list ids + names + descriptions
 *   - read_workflow   — read one workflow by id
 *   - delete_workflow — delete by id
 *
 * This file is only the agent-facing glue (tool-name registry + context guard).
 */

/** The four agent-driven workflow management tool names (single source of truth). */
export const WORKFLOW_MANAGEMENT_TOOL_NAMES: readonly string[] = [
  "create_workflow",
  "list_workflow",
  "read_workflow",
  "delete_workflow",
];

const WORKFLOW_TOOL_NAMES = new Set<string>(WORKFLOW_MANAGEMENT_TOOL_NAMES);

/** True when a tool name is one of the agent-driven workflow management tools. */
export function isWorkflowManagementTool(name: string): boolean {
  return WORKFLOW_TOOL_NAMES.has((name ?? "").trim());
}

/**
 * Shared guard: workflow tools need the workflow runtime, so they only work where it is injected
 * (main / custom / team / CEO agents) and never for sub-agents, chat mode, or the memory agent.
 */
export function requireWorkflows(ctx: ToolContext): ToolResult | null {
  if (!ctx.workflows) {
    return {
      ok: false,
      error: {
        code: "workflows_unavailable",
        message:
          "Workflow management is not available in this context. It is only available to the main agent, custom agents, and team/CEO agents.",
      },
    };
  }
  return null;
}
