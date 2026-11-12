import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { safeResolve } from "../../utils/paths.js";
import { requireRoles } from "./roleManagement.js";
import { DEFAULT_ROLE_FILE } from "../../role/index.js";

/** Maximum length of a role name. */
export const MAX_ROLE_NAME_CHARS = 120;

/** Maximum length of the short description used by list_role. */
export const MAX_ROLE_DESC_CHARS = 500;

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "A role name is required.")
      .max(MAX_ROLE_NAME_CHARS, `The role name must be ${MAX_ROLE_NAME_CHARS} characters or fewer.`)
      .describe(
        "A short, human-readable name for the role (e.g. \"Senior code reviewer\"). This is how the " +
          "role is shown to the user and referenced by list_role / read_role.",
      ),
    description: z
      .string()
      .trim()
      .min(1, "A role description is required.")
      .max(MAX_ROLE_DESC_CHARS, `The role description must be ${MAX_ROLE_DESC_CHARS} characters or fewer.`)
      .describe(
        "A concise description of what the role is and when the agent should act as it. " +
          `Maximum ${MAX_ROLE_DESC_CHARS} characters.`,
      ),
    role_file_path: z
      .string()
      .trim()
      .min(1, "A role file path is required.")
      .describe(
        "A direct absolute filesystem path to the completed role.md file you already wrote with " +
          "file_write. The backend reads the file's full contents and registers it as the role. " +
          "The path must start with '/'.",
      ),
  })
  .strict();

type CreateRoleArgs = z.infer<typeof schema>;

/**
 * create_role — register a user role from an existing role.md file.
 *
 * Flow the model must follow: first write the role.md document with file_write (or apply_patch),
 * then call this tool with the role name, a short description, and that file's absolute path. The
 * file's FULL contents are registered as the role. The created role is returned so the frontend
 * persists it, and it is immediately visible to list_role / read_role this turn.
 */
export const createRoleTool = defineTool({
  name: "create_role",
  description:
    "Create and register a user role from an existing role.md file. First write the role.md " +
    "document with the file-writing tool, then call this tool with the role name, a short " +
    "description, and the absolute path to that file. The backend reads the file contents and " +
    "registers it as the role. Do not pass the role content directly — always pass the file path.",
  schema,
  label: (args: CreateRoleArgs) => `Create Role: ${args.name}`,
  async execute(args: CreateRoleArgs, ctx: ToolContext): Promise<ToolResult> {
    const unavailable = requireRoles(ctx);
    if (unavailable) return unavailable;

    try {
      const sourceAbs = safeResolve(ctx.workspaceRoot, args.role_file_path);

      let stat;
      try {
        stat = await fs.stat(sourceAbs);
      } catch {
        return {
          ok: false,
          error: {
            code: "role_file_not_found",
            message: `The role file "${args.role_file_path}" does not exist. Create it first with file_write.`,
            role_file_path: args.role_file_path,
          },
        };
      }

      if (!stat.isFile()) {
        return {
          ok: false,
          error: {
            code: "role_file_not_file",
            message: `The role file path "${args.role_file_path}" is not a file. Point role_file_path at the role.md document.`,
            role_file_path: args.role_file_path,
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
            code: "role_read_failed",
            message: `Failed to read the role file: ${error instanceof Error ? error.message : String(error)}`,
            role_file_path: args.role_file_path,
          },
        };
      }

      const roleFile = path.basename(sourceAbs).trim() || DEFAULT_ROLE_FILE;
      const registered = ctx.roles!.register({
        id: "",
        name: args.name.trim(),
        description: args.description.trim(),
        roleFile,
        content,
        enabled: true,
      });

      return {
        ok: true,
        data: {
          created_role: {
            id: registered.id,
            name: registered.name,
            description: registered.description,
            role_file: registered.roleFile,
            content: registered.content,
            enabled: true,
          },
          message:
            `Created role "${registered.name}". It has been saved for the user and is now ` +
            "available to list_role / read_role.",
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "create_role_failed",
          message: error instanceof Error ? error.message : String(error),
          role_file_path: args.role_file_path,
        },
      };
    }
  },
});
