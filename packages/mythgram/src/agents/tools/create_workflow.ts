import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve } from "../../utils/paths.js";
import { requireWorkflows } from "./workflowManagement.js";
import { DEFAULT_WORKFLOW_FILE } from "../../workflow/index.js";

/** Maximum length of a workflow name. */
export const MAX_WORKFLOW_NAME_CHARS = 120;

/** Maximum length of the short description used by list_workflow. */
export const MAX_WORKFLOW_DESC_CHARS = 500;

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "A workflow name is required.")
      .max(MAX_WORKFLOW_NAME_CHARS, `The workflow name must be ${MAX_WORKFLOW_NAME_CHARS} characters or fewer.`)
      .describe(
        "A short, human-readable name for the workflow (e.g. \"Bug triage\"). This is how the " +
          "workflow is shown to the user and referenced by list_workflow / read_workflow.",
      ),
    description: z
      .string()
      .trim()
      .min(1, "A workflow description is required.")
      .max(MAX_WORKFLOW_DESC_CHARS, `The workflow description must be ${MAX_WORKFLOW_DESC_CHARS} characters or fewer.`)
      .describe(
        "A concise description of what the workflow does and when it should be used. " +
          `Maximum ${MAX_WORKFLOW_DESC_CHARS} characters.`,
      ),
    workflow_file_path: z
      .string()
      .trim()
      .min(1, "A workflow file path is required.")
      .describe(
        "A direct absolute filesystem path to the completed workflow.md file you already wrote " +
          "with file_write. The backend reads the file's full contents and registers it as the " +
          "workflow. The path must start with '/'.",
      ),
  })
  .strict();

type CreateWorkflowArgs = z.infer<typeof schema>;

/**
 * create_workflow — register a user workflow from an existing workflow.md file.
 *
 * Flow the model must follow: first write the workflow.md document with file_write (or apply_patch),
 * then call this tool with the workflow name, a short description, and that file's absolute path.
 * The file's FULL contents are registered as the workflow. The created workflow is returned so the
 * frontend persists it, and it is immediately visible to list_workflow / read_workflow this turn.
 */
export const createWorkflowTool = defineTool({
  name: "create_workflow",
  description:
    "Create and register a user workflow from an existing workflow.md file. First write the " +
    "workflow.md document with the file-writing tool, then call this tool with the workflow name, a " +
    "short description, and the absolute path to that file. The backend reads the file contents and " +
    "registers it as the workflow. Do not pass the workflow content directly — always pass the file " +
    "path.",
  schema,
  label: (args: CreateWorkflowArgs) => `Create Workflow: ${args.name}`,
  async execute(args: CreateWorkflowArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireWorkflows(ctx);
    if (unavailable) return unavailable;

    try {
      const sourceAbs = safeResolve(ctx.workspaceRoot, args.workflow_file_path);

      let stat;
      try {
        stat = await fs.stat(sourceAbs);
      } catch {
        return {
          ok: false,
          error: {
            code: "workflow_file_not_found",
            message: `The workflow file "${args.workflow_file_path}" does not exist. Create it first with file_write.`,
            workflow_file_path: args.workflow_file_path,
          },
        };
      }

      if (!stat.isFile()) {
        return {
          ok: false,
          error: {
            code: "workflow_file_not_file",
            message: `The workflow file path "${args.workflow_file_path}" is not a file. Point workflow_file_path at the workflow.md document.`,
            workflow_file_path: args.workflow_file_path,
          },
        };
      }

      let content: string;
      try {
        content = await fs.readFile(sourceAbs, "utf8");
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "workflow_read_failed",
            message: `Failed to read the workflow file: ${error instanceof Error ? error.message : String(error)}`,
            workflow_file_path: args.workflow_file_path,
          },
        };
      }

      const workflowFile = path.basename(sourceAbs).trim() || DEFAULT_WORKFLOW_FILE;
      const registered = ctx.workflows!.register({
        id: "",
        name: args.name.trim(),
        description: args.description.trim(),
        workflowFile,
        content,
        enabled: true,
      });

      return {
        ok: true,
        data: {
          created_workflow: {
            id: registered.id,
            name: registered.name,
            description: registered.description,
            workflow_file: registered.workflowFile,
            content: registered.content,
            enabled: true,
          },
          message:
            `Created workflow "${registered.name}". It has been saved for the user and is now ` +
            "available to list_workflow / read_workflow.",
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "create_workflow_failed",
          message: error instanceof Error ? error.message : String(error),
          workflow_file_path: args.workflow_file_path,
        },
      };
    }
  },
});
