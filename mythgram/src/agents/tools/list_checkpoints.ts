import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import {
  listSafetyBackups,
  readCheckpointManifest,
} from "./checkpoints.js";

const schema = z.object({});

export const listCheckpointsTool = defineTool({
  name: "list_checkpoints",
  description:
    "List all available checkpoints with their names and descriptions. Use this when you need to " +
    "find an existing checkpoint.",
  schema,
  label: () => "List Checkpoints",
  async execute(_args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const manifest = await readCheckpointManifest(ctx.workspaceRoot);

      // Only report checkpoints whose zip still exists; a missing zip means the
      // checkpoint was removed outside this tool and can no longer be restored.
      const checkpoints: Array<{
        name: string;
        description: string;
        file: string;
        created_at: number;
        size_bytes: number;
        file_count: number;
      }> = [];
      const missing: string[] = [];
      for (const record of manifest) {
        try {
          const stat = await fs.stat(path.join(ctx.workspaceRoot, ...record.file.split("/")));
          if (!stat.isFile()) {
            missing.push(record.name);
            continue;
          }
          checkpoints.push({
            name: record.name,
            description: record.description,
            file: record.file,
            created_at: record.createdAt,
            size_bytes: stat.size,
            file_count: record.fileCount,
          });
        } catch {
          missing.push(record.name);
        }
      }
      checkpoints.sort((a, b) => b.created_at - a.created_at);

      const safetyBackups = await listSafetyBackups(ctx.workspaceRoot);

      return {
        ok: true,
        data: {
          count: checkpoints.length,
          checkpoints,
          safety_backups: safetyBackups.map((backup) => ({
            name: backup.name,
            file: backup.file,
            created_at: backup.createdAt,
            size_bytes: backup.sizeBytes,
            file_count: backup.fileCount,
          })),
          missing,
          message:
            checkpoints.length === 0
              ? "No checkpoints exist yet. Create one with create_checkpoint after completing a task."
              : `${checkpoints.length} checkpoint(s) available. Restore one with restore_checkpoint ` +
                `using its exact name.`,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "checkpoint_list_failed",
          message: `Could not list checkpoints: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  },
});
