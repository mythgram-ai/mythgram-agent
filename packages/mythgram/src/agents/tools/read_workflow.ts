import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireWorkflows } from "./workflowManagement.js";

const schema = z.object({
  workflow_id: z
    .string()
    .trim()
    .min(1, "A workflow id is required.")
    .describe("The exact id of the workflow to read (from list_workflow)."),
});

type ReadWorkflowArgs = z.infer<typeof schema>;

/** read_workflow — read one workflow's full content by id. */
export const readWorkflowTool = defineTool({
  name: "read_workflow",
  description:
    "Read a workflow's complete content by its exact id (from list_workflow). Returns the " +
    "workflow's name, description, file name, and full markdown document. Use it when the user " +
    "asks you to follow a workflow or when a workflow was attached to the request.",
  schema,
  label: (args: ReadWorkflowArgs) => `Read Workflow: ${args.workflow_id}`,
  async execute(args: ReadWorkflowArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireWorkflows(ctx);
    if (unavailable) return unavailable;

    const workflow = ctx.workflows!.get(args.workflow_id);
    if (!workflow) {
      const available = ctx.workflows!.list();
      return {
        ok: false,
        error: {
          code: "unknown_workflow",
          message:
            `No workflow with id "${args.workflow_id}" exists. ` +
            (available.length > 0
              ? `Available workflows: ${available.map((w) => `${w.name} (${w.id})`).join(", ")}.`
              : "There are no workflows. The user can create one from the Workflows panel."),
        },
      };
    }

    return {
      ok: true,
      data: {
        workflow: {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          workflow_file: workflow.workflowFile,
          content: workflow.content,
        },
      },
    };
  },
});
