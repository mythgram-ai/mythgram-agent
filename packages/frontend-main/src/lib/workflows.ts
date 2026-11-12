import type { Workflow } from "@/types";

/**
 * Build the prompt fragment appended to a user's message when one or more workflows are attached
 * via the composer's "/" picker. The agent receives each workflow's name, description, and the full
 * workflow.md content, plus an explicit instruction to work according to it.
 */
export function buildAttachedWorkflowPrompt(workflows: readonly Workflow[]): string {
  const active = workflows.filter((wf) => wf.name.trim().length > 0);
  if (active.length === 0) return "";

  const blocks = active.map((wf) => {
    const file = wf.workflowFile.trim() || "workflow.md";
    const description = wf.description.trim();
    return [
      `## Attached workflow: ${wf.name.trim()}`,
      `The user has attached the workflow "${wf.name.trim()}" (${file}). Work exactly like this workflow: follow its steps, order, constraints, and rules precisely.`,
      description ? `Description: ${description}` : "",
      "",
      wf.content.trim(),
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  });

  return [
    "# Attached workflows",
    "The user has attached one or more workflows to this request. Treat each attached workflow as binding instructions and carry out the request according to it.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}