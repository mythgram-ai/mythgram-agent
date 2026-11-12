import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireRoles } from "./roleManagement.js";

const schema = z.object({});

/** list_role — enumerate the user's roles (id, name, description). */
export const listRoleTool = defineTool({
  name: "list_role",
  description:
    "List all roles currently available to the user. A role is a user-authored persona (a role.md " +
    "document) that tells you how to act (tone, responsibilities, expertise). Every entry is " +
    "returned with its exact id, name, and short description. Call this before read_role or " +
    "delete_role so you use the exact id.",
  schema,
  label: () => "List Roles",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireRoles(ctx);
    if (unavailable) return unavailable;
    const roles = ctx.roles!.list();
    return {
      ok: true,
      data: { count: roles.length, roles },
    };
  },
});
