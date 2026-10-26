import fs from "node:fs/promises";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  MAX_CHECKPOINT_DESC_CHARS,
  MAX_CHECKPOINT_NAME_CHARS,
  checkpointZipAbs,
  checkpointZipRel,
  collectWorkspaceSnapshot,
  createZipBuffer,
  readCheckpointManifest,
  validateCheckpointDescription,
  validateCheckpointName,
  writeCheckpointManifest,
  writeZipAtomic,
  type CheckpointRecord,
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
    .describe("Unique checkpoint name. Do not include '.zip'."),
  description: z
    .string()
    .trim()
    .min(1, "A short description is required.")
    .max(
      MAX_CHECKPOINT_DESC_CHARS,
      `The checkpoint description must be ${MAX_CHECKPOINT_DESC_CHARS} characters or fewer.`,
    )
    .describe("Short description of what this checkpoint contains."),
});

export const createCheckpointTool = defineTool({
  name: "create_checkpoint",
  description:
    "Create a backup of the current workspace so it can be restored later. Saves a ZIP at " +
    "'.mythgram/backups/<name>.zip'. Excludes '.mythgram', '.gitignore', node_modules, build files, " +
    "and other generated files. The name must be unique.",
  schema,
  label: (args) => `Checkpoint: ${args.name}`,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const nameCheck = validateCheckpointName(args.name);
    if (nameCheck.error) {
      return { ok: false, error: { code: "invalid_checkpoint_name", message: nameCheck.error } };
    }
    const descCheck = validateCheckpointDescription(args.description);
    if (descCheck.error) {
      return { ok: false, error: { code: "invalid_checkpoint_description", message: descCheck.error } };
    }
    const { name } = nameCheck;
    const { description } = descCheck;

    try {
      // The name must be unique: reject when the manifest or the zip already has it.
      const manifest = await readCheckpointManifest(ctx.workspaceRoot);
      if (manifest.some((record) => record.name.toLowerCase() === name.toLowerCase())) {
        return {
          ok: false,
          error: {
            code: "checkpoint_name_exists",
            message:
              `A checkpoint named "${name}" already exists. Choose another name, or delete the ` +
              `existing checkpoint first with delete_checkpoint.`,
            name,
          },
        };
      }
      const zipAbs = checkpointZipAbs(ctx.workspaceRoot, name);
      try {
        await fs.access(zipAbs);
        return {
          ok: false,
          error: {
            code: "checkpoint_name_exists",
            message:
              `A checkpoint file for "${name}" already exists at "${checkpointZipRel(name)}". ` +
              `Choose another name, or delete the existing checkpoint first with delete_checkpoint.`,
            name,
          },
        };
      } catch {
        // does not exist yet — the expected path
      }

      if (ctx.signal?.aborted) {
        return { ok: false, error: { code: "aborted", message: "The checkpoint was aborted." } };
      }

      const snapshot = await collectWorkspaceSnapshot(ctx.workspaceRoot, ctx.signal);
      const zip = createZipBuffer(snapshot.entries);
      await writeZipAtomic(zipAbs, zip);

      const record: CheckpointRecord = {
        name,
        description,
        file: checkpointZipRel(name),
        createdAt: Date.now(),
        sizeBytes: zip.length,
        fileCount: snapshot.fileCount,
      };
      const next = (await readCheckpointManifest(ctx.workspaceRoot)).filter(
        (entry) => entry.name.toLowerCase() !== name.toLowerCase(),
      );
      next.push(record);
      await writeCheckpointManifest(ctx.workspaceRoot, next);

      const skippedNote =
        snapshot.skipped.length > 0 ? ` Skipped ${snapshot.skipped.length} unreadable/oversized item(s).` : "";
      return {
        ok: true,
        data: {
          name,
          description,
          file: record.file,
          file_count: snapshot.fileCount,
          size_bytes: zip.length,
          skipped: snapshot.skipped,
          message:
            `Checkpoint "${name}" created at "${record.file}" ` +
            `(${snapshot.fileCount} files, ${zip.length} bytes).${skippedNote} ` +
            `Restore it any time with restore_checkpoint.`,
        },
      };
    } catch (error) {
      if ((error as { code?: string }).code === "aborted" || ctx.signal?.aborted) {
        return { ok: false, error: { code: "aborted", message: "The checkpoint was aborted." } };
      }
      return {
        ok: false,
        error: {
          code: "checkpoint_create_failed",
          message: `Could not create checkpoint "${name}": ${error instanceof Error ? error.message : String(error)}`,
          name,
        },
      };
    }
  },
});
