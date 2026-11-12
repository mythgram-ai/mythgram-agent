import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireRoles } from "./roleManagement.js";

const schema = z.object({
  role_id: z
    .string()
    .trim()
    .min(1, "A role id is required.")
    .describe("The exact id of the role to permanently delete (from list_role)."),
});

type DeleteRoleArgs = z.infer<typeof schema>;

/** delete_role — permanently remove one of the user's roles by id. */
export const deleteRoleTool = defineTool({
  name: "delete_role",
  description:
    "Permanently delete a role by its exact id (from list_role). The role is removed from the " +
    "user's saved roles so it is no longer available to list_role / read_role. This action cannot " +
    "be undone — only delete a role when the user explicitly asks you to.",
  schema,
  label: (args: DeleteRoleArgs) => `Delete Role: ${args.role_id}`,
  async execute(args: DeleteRoleArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireRoles(ctx);
    if (unavailable) return unavailable;

    const removed = ctx.roles!.remove(args.role_id);
    if (!removed) {
      const available = ctx.roles!.list();
      return {
        ok: false,
        error: {
          code: "unknown_role",
          message:
            `No role with id "${args.role_id}" exists. ` +
            (available.length > 0
              ? `Available roles: ${available.map((r) => `${r.name} (${r.id})`).join(", ")}.`
              : "There are no roles to delete."),
        },
      };
    }

    return {
      ok: true,
      data: {
        deleted_role: args.role_id,
        message: `Deleted role "${args.role_id}". It is no longer available to list_role or read_role.`,
      },
    };
  },
});
