import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireWorkflows } from "./workflowManagement.js";

const schema = z.object({});

/** list_workflow — enumerate the user's workflows (id, name, description). */
export const listWorkflowTool = defineTool({
  name: "list_workflow",
  description:
    "List all workflows currently available to the user. A workflow is a user-authored process " +
    "(a workflow.md document) that describes how a task should be carried out. Every entry is " +
    "returned with its exact id, name, and short description. Call this before read_workflow or " +
    "delete_workflow so you use the exact id.",
  schema,
  label: () => "List Workflows",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireWorkflows(ctx);
    if (unavailable) return unavailable;
    const workflows = ctx.workflows!.list();
    return {
      ok: true,
      data: { count: workflows.length, workflows },
    };
  },
});
