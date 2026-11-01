import { z } from "zod";
import { artifactsManager } from "../../artifacts/index.js";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { artifactsFailure } from "./artifactSupport.js";

const schema = z.object({}).strict();

type ListArtifactsArgs = z.infer<typeof schema>;

/**
 * list_artifacts — enumerate every saved artifact with the metadata needed to read, show, edit, or
 * delete it (id, title, description, type, file path, size, pinned).
 */
export const listArtifactsTool = defineTool({
  name: "list_artifacts",
  description:
    "List all available artifacts and return their relevant metadata, such as artifact IDs, and " +
    "file paths.",
  schema,
  label: (_args: ListArtifactsArgs) => "Artifacts: list",
  async execute(_args: ListArtifactsArgs, ctx: ToolContext): Promise<ToolResult> {
    try {
      const artifacts = await artifactsManager.list(ctx.workspaceRoot);
      return {
        ok: true,
        data: {
          count: artifacts.length,
          artifacts,
          message:
            artifacts.length === 0
              ? "No artifacts have been saved yet. Use save_artifacts to save a file as an artifact."
              : "Use read_artifact to inspect an artifact's content, show_artifact_to_user to " +
                "preview it, or delete_artifacts to remove one by id.",
        },
      };
    } catch (error) {
      return artifactsFailure(error);
    }
  },
});
