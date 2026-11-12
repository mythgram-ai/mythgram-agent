import { randomUUID } from "node:crypto";
import type {
  RoleDefinition,
  RoleListEntry,
  RoleRuntime,
} from "../agents/tools/types.js";

/** Default entry file name for a role document. */
export const DEFAULT_ROLE_FILE = "role.md";

/**
 * Normalize a persisted role document (frontend camelCase or wire snake_case) into safe,
 * well-typed definitions. Shared by the channel/cron/ACP main-agent surfaces, which load the
 * user's roles straight from the app-state database.
 */
export function normalizeRoleList(raw: unknown): RoleDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: RoleDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;

    const roleFile =
      typeof record.roleFile === "string" && record.roleFile.trim().length > 0
        ? record.roleFile.trim()
        : typeof record.role_file === "string" && record.role_file.trim().length > 0
          ? record.role_file.trim()
          : DEFAULT_ROLE_FILE;

    out.push({
      id: typeof record.id === "string" ? record.id.trim() : "",
      name,
      description: typeof record.description === "string" ? record.description : "",
      roleFile,
      content: typeof record.content === "string" ? record.content : "",
      enabled: record.enabled !== false,
    });
  }
  return out;
}

/** Generate a stable unique id for an agent-created role. */
function generateId(): string {
  return `role-${randomUUID()}`;
}

/**
 * Build the RoleRuntime bound to a single turn. The returned object is injected into the
 * ToolContext so the role tools (create_role / delete_role / list_role / read_role) can enumerate
 * and manage the user's roles.
 */
export function createRoleRuntime(definitions: RoleDefinition[]): RoleRuntime {
  const runner = new RoleRunner(definitions);
  return {
    definitions,
    list: () => runner.list(),
    get: (id) => runner.get(id),
    register: (role) => runner.register(role),
    remove: (id) => runner.remove(id),
  };
}

class RoleRunner {
  constructor(private readonly definitions: RoleDefinition[]) {}

  /**
   * Add a role definition to the live turn (or replace an existing one matched by id or by
   * case-insensitive name). Mutates the shared `definitions` array in place so the runtime's
   * exposed `definitions`, `list()`, and `get()` all see the new role immediately.
   */
  register(role: RoleDefinition): RoleDefinition {
    const id = (role.id ?? "").trim() || generateId();
    const normalized: RoleDefinition = { ...role, id };
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

  /** Enabled roles with id, name, and description. */
  list(): RoleListEntry[] {
    return this.definitions
      .filter((def) => def.enabled !== false && def.name.trim().length > 0)
      .map((def) => ({
        id: def.id,
        name: def.name.trim(),
        description: def.description ?? "",
      }));
  }

  /** Find one enabled role by exact id (falling back to a case-insensitive name match). */
  get(id: string): RoleDefinition | undefined {
    const target = id.trim();
    if (!target) return undefined;
    const lower = target.toLowerCase();
    return this.definitions.find(
      (def) =>
        def.enabled !== false &&
        (def.id === target || def.name.trim().toLowerCase() === lower),
    );
  }

  /** Remove a role by id (or case-insensitive name). Returns false when nothing matched. */
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
