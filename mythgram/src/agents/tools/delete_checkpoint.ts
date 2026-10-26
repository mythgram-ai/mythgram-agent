import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  MAX_CHECKPOINT_NAME_CHARS,
  checkpointZipAbs,
  readCheckpointManifest,
  safetyDirAbs,
  validateCheckpointName,
  writeCheckpointManifest,
} from "./checkpoints.js";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A checkpoint name is required.")
    .max(
      MAX_CHECKPOINT_NAME_CHARS,
      `The checkpoint name must be ${MAX_CHECKPOINT_NAME_CHARS} characters or fewer.`,
    )
    .describe("Exact checkpoint name to delete. Do not include '.zip'."),
});

export const deleteCheckpointTool = defineTool({
  name: "delete_checkpoint",
  description:
    "Delete the specified checkpoint and its related data. Do not affect the workspace or other " +
    "checkpoints.",
  schema,
  label: (args) => `Delete Checkpoint: ${args.name}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const nameCheck = validateCheckpointName(args.name);
    if (nameCheck.error) {
      return { ok: false, error: { code: "invalid_checkpoint_name", message: nameCheck.error } };
    }
    const { name } = nameCheck;
    const key = name.toLowerCase();

    try {
      const manifest = await readCheckpointManifest(ctx.workspaceRoot);
      const record = manifest.find((entry) => entry.name.toLowerCase() === key);

      // A safety backup (created automatically before a restore) can also be
      // deleted by name — it lives outside the manifest, in the btocptd folder.
      const safetyZip = path.join(safetyDirAbs(ctx.workspaceRoot), `${name}.zip`);
      const safetySidecar = path.join(safetyDirAbs(ctx.workspaceRoot), `${name}.meta.json`);
      if (!record) {
        try {
          await fs.access(safetyZip);
        } catch {
          return {
            ok: false,
            error: {
              code: "checkpoint_not_found",
              message:
                `No checkpoint named "${name}" exists. Call list_checkpoints to see the exact ` +
                `available names, then retry with one of them.`,
              name,
            },
          };
        }
        await fs.rm(safetyZip, { force: true });
        await fs.rm(safetySidecar, { force: true });
        return {
          ok: true,
          data: {
            name,
            deleted: true,
            safety_backup: true,
            message: `Safety backup "${name}" deleted. The workspace is unchanged.`,
          },
        };
      }

      // Delete the checkpoint zip and its manifest entry. The workspace itself
      // and every other checkpoint are left untouched.
      await fs.rm(checkpointZipAbs(ctx.workspaceRoot, record.name), { force: true });
      const next = manifest.filter((entry) => entry.name.toLowerCase() !== key);
      await writeCheckpointManifest(ctx.workspaceRoot, next);

      return {
        ok: true,
        data: {
          name: record.name,
          deleted: true,
          message: `Checkpoint "${record.name}" deleted. The workspace and other checkpoints are unchanged.`,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "checkpoint_delete_failed",
          message: `Could not delete checkpoint "${name}": ${error instanceof Error ? error.message : String(error)}`,
          name,
        },
      };
    }
  },
});
