import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireWorkflows } from "./workflowManagement.js";

const schema = z.object({
  workflow_id: z
    .string()
    .trim()
    .min(1, "A workflow id is required.")
    .describe("The exact id of the workflow to permanently delete (from list_workflow)."),
});

type DeleteWorkflowArgs = z.infer<typeof schema>;

/** delete_workflow — permanently remove one of the user's workflows by id. */
export const deleteWorkflowTool = defineTool({
  name: "delete_workflow",
  description:
    "Permanently delete a workflow by its exact id (from list_workflow). The workflow is removed " +
    "from the user's saved workflows so it is no longer available to list_workflow / read_workflow. " +
    "This action cannot be undone — only delete a workflow when the user explicitly asks you to.",
  schema,
  label: (args: DeleteWorkflowArgs) => `Delete Workflow: ${args.workflow_id}`,
  async execute(args: DeleteWorkflowArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireWorkflows(ctx);
    if (unavailable) return unavailable;

    const removed = ctx.workflows!.remove(args.workflow_id);
    if (!removed) {
      const available = ctx.workflows!.list();
      return {
        ok: false,
        error: {
          code: "unknown_workflow",
          message:
            `No workflow with id "${args.workflow_id}" exists. ` +
            (available.length > 0
              ? `Available workflows: ${available.map((w) => `${w.name} (${w.id})`).join(", ")}.`
              : "There are no workflows to delete."),
        },
      };
    }

    return {
      ok: true,
      data: {
        deleted_workflow: args.workflow_id,
        message: `Deleted workflow "${args.workflow_id}". It is no longer available to list_workflow or read_workflow.`,
      },
    };
  },
});
