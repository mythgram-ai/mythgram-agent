import { z } from "zod";
import { artifactsManager } from "../../artifacts/index.js";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { artifactsFailure } from "./artifactSupport.js";

const schema = z
  .object({
    artifact_id: z
      .string()
      .min(1, "An artifact id is required.")
      .describe(
        "The unique identifier of the artifact to read, use list_artifacts for getting artifacts id.",
      ),
  })
  .strict();

type ReadArtifactArgs = z.infer<typeof schema>;

/**
 * read_artifact — load an artifact's raw file content by id so the agent can inspect or analyze it.
 */
export const readArtifactTool = defineTool({
  name: "read_artifact",
  description:
    "Read the content of an existing artifact using its unique ID. Use this tool when you need to " +
    "inspect or analyze an artifact's content.",
  schema,
  label: (args: ReadArtifactArgs) => `Artifact: read ${args.artifact_id}`,
  async execute(args: ReadArtifactArgs, ctx: ToolContext): Promise<ToolResult> {
    try {
      const artifact = await artifactsManager.read(args.artifact_id, ctx.workspaceRoot);
      return {
        ok: true,
        data: {
          artifact_id: artifact.id,
          title: artifact.title,
          description: artifact.description,
          type: artifact.type,
          file: artifact.file,
          size_bytes: artifact.sizeBytes,
          content: artifact.content,
        },
      };
    } catch (error) {
      return artifactsFailure(error);
    }
  },
});
