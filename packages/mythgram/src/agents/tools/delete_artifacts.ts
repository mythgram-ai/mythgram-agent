import { z } from "zod";
import { artifactsManager } from "../../artifacts/index.js";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { artifactsFailure, emitArtifactsUpdated } from "./artifactSupport.js";

const schema = z
  .object({
    artifact_id: z
      .string()
      .min(1, "An artifact id is required.")
      .describe(
        "The unique identifier of the artifact to delete, use list_artifacts for getting artifacts id.",
      ),
  })
  .strict();

type DeleteArtifactsArgs = z.infer<typeof schema>;

/**
 * delete_artifacts — permanently remove an artifact by id (its file and metadata).
 */
export const deleteArtifactsTool = defineTool({
  name: "delete_artifacts",
  description: "Delete an existing artifact using its unique artifact ID.",
  schema,
  label: (args: DeleteArtifactsArgs) => `Artifact: delete ${args.artifact_id}`,
  async execute(args: DeleteArtifactsArgs, ctx: ToolContext): Promise<ToolResult> {
    try {
      const removed = await artifactsManager.remove(args.artifact_id, ctx.workspaceRoot);
      emitArtifactsUpdated(ctx, await artifactsManager.list(ctx.workspaceRoot));
      return {
        ok: true,
        data: {
          deleted: true,
          artifact: removed,
          artifact_id: removed.id,
          message: `Deleted artifact "${removed.title}" (id: ${removed.id}).`,
        },
      };
    } catch (error) {
      return artifactsFailure(error);
    }
  },
});
