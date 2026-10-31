import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  CHECKPOINT_SAFETY_DIR,
  MAX_CHECKPOINT_NAME_CHARS,
  checkpointZipAbs,
  checkpointZipRel,
  clearWorkspaceForRestore,
  collectWorkspaceSnapshot,
  createZipBuffer,
  extractSnapshotEntries,
  generateSafetyBackupName,
  parseZipBuffer,
  readCheckpointManifest,
  validateCheckpointName,
  writeSafetySidecar,
  writeZipAtomic,
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
    .describe("The exact name of the checkpoint to restore. Do not include '.zip'."),
});

export const restoreCheckpointTool = defineTool({
  name: "restore_checkpoint",
  description:
    "Restore the workspace to a previously saved checkpoint. Before restoring, automatically " +
    "create a safety backup of the current workspace in '.mythgram/backups/btocptd/<5-word-name>.zip'. " +
    "Then replace the current workspace files with the selected checkpoint. The original checkpoint " +
    "and safety backup must remain unchanged so the previous state can be recovered if needed.",
  schema,
  label: (args) => `Restore Checkpoint: ${args.name}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const nameCheck = validateCheckpointName(args.name);
    if (nameCheck.error) {
      return { ok: false, error: { code: "invalid_checkpoint_name", message: nameCheck.error } };
    }
    const { name } = nameCheck;
    const key = name.toLowerCase();

    const fail = (code: string, message: string): ToolResult => ({
      ok: false,
      error: { code, message, name },
    });

    try {
      const manifest = await readCheckpointManifest(ctx.workspaceRoot);
      const record = manifest.find((entry) => entry.name.toLowerCase() === key);
      if (!record) {
        return fail(
          "checkpoint_not_found",
          `No checkpoint named "${name}" exists. Call list_checkpoints to see the exact ` +
            `available names, then retry with one of them.`,
        );
      }

      let zipBuffer: Buffer;
      try {
        zipBuffer = await fs.readFile(checkpointZipAbs(ctx.workspaceRoot, record.name));
      } catch {
        return fail(
          "checkpoint_not_found",
          `Checkpoint "${record.name}" is listed but its file "${checkpointZipRel(record.name)}" ` +
            `is missing. It cannot be restored.`,
        );
      }

      let zipEntries;
      try {
        zipEntries = parseZipBuffer(zipBuffer);
      } catch (error) {
        return fail(
          "checkpoint_corrupt",
          `Checkpoint "${record.name}" could not be read: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (ctx.signal?.aborted) {
        return fail("aborted", "The restore was aborted before it started.");
      }

      // Step 1 — safety backup of the CURRENT workspace, so this restore itself
      // can be undone. The backup is written first; nothing is deleted before it
      // exists on disk.
      const safetyName = await generateSafetyBackupName(ctx.workspaceRoot);
      const safetyRel = `${CHECKPOINT_SAFETY_DIR}/${safetyName}.zip`;
      const safetyAbs = path.join(ctx.workspaceRoot, ...safetyRel.split("/"));
      let safetyFileCount = 0;
      try {
        const current = await collectWorkspaceSnapshot(ctx.workspaceRoot, ctx.signal);
        const safetyZip = createZipBuffer(current.entries);
        await writeZipAtomic(safetyAbs, safetyZip);
        safetyFileCount = current.fileCount;
        await writeSafetySidecar(ctx.workspaceRoot, {
          name: safetyName,
          file: safetyRel,
          createdAt: Date.now(),
          sizeBytes: safetyZip.length,
          fileCount: current.fileCount,
          reason: `Automatic safety backup taken before restoring checkpoint "${record.name}".`,
        });
      } catch (error) {
        if ((error as { code?: string }).code === "aborted" || ctx.signal?.aborted) {
          await fs.rm(safetyAbs, { force: true }).catch(() => undefined);
          return fail("aborted", "The restore was aborted while creating the safety backup. Nothing was changed.");
        }
        return fail(
          "safety_backup_failed",
          `Could not create the safety backup before restoring: ${error instanceof Error ? error.message : String(error)} ` +
            `Nothing was changed.`,
        );
      }

      // Step 2 — clear the workspace (preserving the agent state directory and
      // version control), then extract the checkpoint in place. The checkpoint
      // zip is only ever read — never moved or modified — so it stays restorable.
      let restored;
      try {
        await clearWorkspaceForRestore(ctx.workspaceRoot, ctx.signal);
        restored = await extractSnapshotEntries(ctx.workspaceRoot, zipEntries, ctx.signal);
      } catch (error) {
        if ((error as { code?: string }).code === "aborted" || ctx.signal?.aborted) {
          return fail(
            "aborted",
            `The restore was aborted partway. The workspace may be incomplete — the full previous ` +
              `state is preserved in the safety backup at "${safetyRel}".`,
          );
        }
        return fail(
          "checkpoint_restore_failed",
          `The restore failed partway: ${error instanceof Error ? error.message : String(error)} ` +
            `The full previous state is preserved in the safety backup at "${safetyRel}".`,
        );
      }

      const skippedNote =
        restored.skipped.length > 0 ? ` ${restored.skipped.length} protected entr${restored.skipped.length === 1 ? "y was" : "ies were"} skipped.` : "";
      return {
        ok: true,
        data: {
          name: record.name,
          safety_backup: safetyRel,
          safety_backup_name: safetyName,
          safety_backup_files: safetyFileCount,
          restored_files: restored.fileCount,
          restored_dirs: restored.dirCount,
          message:
            `Successfully restored checkpoint "${record.name}" (${restored.fileCount} files). ` +
            `Your previous workspace state was automatically preserved as a safety backup at ` +
            `"${safetyRel}" (${safetyFileCount} files), and the "${record.name}" checkpoint itself ` +
            `remains intact — so you can safely undo this restore or return to the checkpoint again ` +
            `at any time.${skippedNote}`,
        },
      };
    } catch (error) {
      if ((error as { code?: string }).code === "aborted" || ctx.signal?.aborted) {
        return fail("aborted", "The restore was aborted.");
      }
      return fail(
        "checkpoint_restore_failed",
        `Could not restore checkpoint "${name}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
