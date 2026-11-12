import { randomUUID } from "node:crypto";
import type {
  WorkflowDefinition,
  WorkflowListEntry,
  WorkflowRuntime,
} from "../agents/tools/types.js";

/** Default entry file name for a workflow document. */
export const DEFAULT_WORKFLOW_FILE = "workflow.md";

/**
 * Normalize a persisted workflow document (frontend camelCase or wire snake_case) into safe,
 * well-typed definitions. Shared by the channel/cron/ACP main-agent surfaces, which load the
 * user's workflows straight from the app-state database.
 */
export function normalizeWorkflowList(raw: unknown): WorkflowDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkflowDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;

    const workflowFile =
      typeof record.workflowFile === "string" && record.workflowFile.trim().length > 0
        ? record.workflowFile.trim()
        : typeof record.workflow_file === "string" && record.workflow_file.trim().length > 0
          ? record.workflow_file.trim()
          : DEFAULT_WORKFLOW_FILE;

    out.push({
      id: typeof record.id === "string" ? record.id.trim() : "",
      name,
      description: typeof record.description === "string" ? record.description : "",
      workflowFile,
      content: typeof record.content === "string" ? record.content : "",
      enabled: record.enabled !== false,
    });
  }
  return out;
}

/** Generate a stable unique id for an agent-created workflow. */
function generateId(): string {
  return `workflow-${randomUUID()}`;
}

/**
 * Build the WorkflowRuntime bound to a single turn. The returned object is injected into the
 * ToolContext so the workflow tools (create_workflow / delete_workflow / list_workflow /
 * read_workflow) can enumerate and manage the user's workflows.
 */
export function createWorkflowRuntime(definitions: WorkflowDefinition[]): WorkflowRuntime {
  const runner = new WorkflowRunner(definitions);
  return {
    definitions,
    list: () => runner.list(),
    get: (id) => runner.get(id),
    register: (workflow) => runner.register(workflow),
    remove: (id) => runner.remove(id),
  };
}

class WorkflowRunner {
  constructor(private readonly definitions: WorkflowDefinition[]) {}

  /**
   * Add a workflow definition to the live turn (or replace an existing one matched by id or by
   * case-insensitive name). Mutates the shared `definitions` array in place so the runtime's
   * exposed `definitions`, `list()`, and `get()` all see the new workflow immediately.
   */
  register(workflow: WorkflowDefinition): WorkflowDefinition {
    const id = (workflow.id ?? "").trim() || generateId();
    const normalized: WorkflowDefinition = { ...workflow, id };
    const nameKey = normalized.name.trim().toLowerCase();
    const index = this.definitions.findIndex(
      (def) => def.id === id || def.name.trim().toLowerCase() === nameKey,
    );
    if (index >= 0) {
      this.definitions[index] = normalized;
    } else {
      this.definitions.push(normalized);
    }
    return normalized;
  }

  /** Enabled workflows with id, name, and description. */
  list(): WorkflowListEntry[] {
    return this.definitions
      .filter((def) => def.enabled !== false && def.name.trim().length > 0)
      .map((def) => ({
        id: def.id,
        name: def.name.trim(),
        description: def.description ?? "",
      }));
  }

  /** Find one enabled workflow by exact id (falling back to a case-insensitive name match). */
  get(id: string): WorkflowDefinition | undefined {
    const target = id.trim();
    if (!target) return undefined;
    const lower = target.toLowerCase();
    return this.definitions.find(
      (def) =>
        def.enabled !== false &&
        (def.id === target || def.name.trim().toLowerCase() === lower),
    );
  }

  /** Remove a workflow by id (or case-insensitive name). Returns false when nothing matched. */
  remove(id: string): boolean {
    const target = id.trim();
    if (!target) return false;
    const lower = target.toLowerCase();
    const index = this.definitions.findIndex(
      (def) => def.id === target || def.name.trim().toLowerCase() === lower,
    );
    if (index < 0) return false;
    this.definitions.splice(index, 1);
    return true;
  }
}
