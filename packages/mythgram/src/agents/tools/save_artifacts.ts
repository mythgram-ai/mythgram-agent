import { z } from "zod";
import { artifactsManager } from "../../artifacts/index.js";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";
import { artifactsFailure, emitArtifactsUpdated } from "./artifactSupport.js";

const schema = z
  .object({
    artifact_file_path: z
      .string()
      .min(1, "An artifact file path is required.")
      .describe("The absolute file system path of the artifact file to save."),
    title: z.string().min(1, "An artifact title is required.").describe("The title of the artifact."),
    description: z
      .string()
      .min(1, "An artifact description is required.")
      .describe("A brief description of the artifact and its contents."),
    type: z
      .enum(["markdown", "code_file", "text", "html", "csv", "json", "docs", "design", "slides"])
      .describe("The type of artifact being saved."),
  })
  .strict();

type SaveArtifactsArgs = z.infer<typeof schema>;

/**
 * save_artifacts — copy an existing workspace file into the artifacts store so it can be listed,
 * read, shown to the user, edited, pinned, duplicated, and deleted later. Image/video/audio files
 * are rejected. The artifact's file is written under `.mythgram/artifacts/`.
 */
export const saveArtifactsTool = defineTool({
  name: "save_artifacts",
  description:
    "Save an artifact using an absolute file path, its title, description, and artifact type. The " +
    "file is copied into '.mythgram/artifacts/' and becomes a reusable artifact. Media files " +
    "(images, video, audio) cannot be saved as artifacts.",
  schema,
  label: (args: SaveArtifactsArgs) =>
    args.title.trim().length > 0 ? `Artifact: save ${args.title}` : "Artifact: save",
  async execute(args: SaveArtifactsArgs, ctx: ToolContext): Promise<ToolResult> {
    try {
      const meta = await artifactsManager.save(
        {
          artifactFilePath: args.artifact_file_path,
          title: args.title,
          description: args.description,
          type: args.type,
        },
        ctx.workspaceRoot,
      );
      emitArtifactsUpdated(ctx, await artifactsManager.list(ctx.workspaceRoot));
      return {
        ok: true,
        data: {
          artifact: meta,
          artifact_id: meta.id,
          file: meta.file,
          message:
            `Saved artifact "${meta.title}" (id: ${meta.id}, type: ${meta.type}) at ` +
            `"${meta.file}". Edit it directly at that path, or show it to the user with ` +
            `show_artifact_to_user.`,
        },
      };
    } catch (error) {
      return artifactsFailure(error);
    }
  },
});
