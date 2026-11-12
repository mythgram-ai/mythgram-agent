import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { requireRoles } from "./roleManagement.js";

const schema = z.object({
  role_id: z
    .string()
    .trim()
    .min(1, "A role id is required.")
    .describe("The exact id of the role to read (from list_role)."),
});

type ReadRoleArgs = z.infer<typeof schema>;

/** read_role — read one role's full content by id. */
export const readRoleTool = defineTool({
  name: "read_role",
  description:
    "Read a role's complete content by its exact id (from list_role). Returns the role's name, " +
    "description, file name, and full markdown document. Use it when the user asks you to act as a " +
    "role or when a role was attached to the request.",
  schema,
  label: (args: ReadRoleArgs) => `Read Role: ${args.role_id}`,
  async execute(args: ReadRoleArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireRoles(ctx);
    if (unavailable) return unavailable;

    const role = ctx.roles!.get(args.role_id);
    if (!role) {
      const available = ctx.roles!.list();
      return {
        ok: false,
        error: {
          code: "unknown_role",
          message:
            `No role with id "${args.role_id}" exists. ` +
            (available.length > 0
              ? `Available roles: ${available.map((r) => `${r.name} (${r.id})`).join(", ")}.`
              : "There are no roles. The user can create one from the Roles panel."),
        },
      };
    }

    return {
      ok: true,
      data: {
        role: {
          id: role.id,
          name: role.name,
          description: role.description,
          role_file: role.roleFile,
          content: role.content,
        },
      },
    };
  },
});
