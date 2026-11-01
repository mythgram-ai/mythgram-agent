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
        "The unique identifier of the artifact to display to the user, use list_artifacts for getting artifacts id.",
      ),
  })
  .strict();

type ShowArtifactArgs = z.infer<typeof schema>;

/**
 * show_artifact_to_user — present an artifact's raw content directly inside the tool block in the
 * conversation (not a popup). The frontend renders the content attached to this tool call.
 */
export const showArtifactToUserTool = defineTool({
  name: "show_artifact_to_user",
  description:
    "Show an artifact preview to the user. Use the artifact ID to present the artifact.",
  schema,
  label: (args: ShowArtifactArgs) => `Artifact: show ${args.artifact_id}`,
  async execute(args: ShowArtifactArgs, ctx: ToolContext): Promise<ToolResult> {
    try {
      const artifact = await artifactsManager.read(args.artifact_id, ctx.workspaceRoot);

      // Attach the artifact to THIS tool block (not a one-time popup) so it stays viewable in the
      // conversation. Best-effort: a missing emit still returns the structured result below.
      try {
        ctx.emit?.("artifact_show", {
          tool_call_id: ctx.toolCallId ?? null,
          artifact,
        });
      } catch {
        // The structured result still carries the artifact for the model/UI.
      }

      return {
        ok: true,
        data: {
          presented: true,
          artifact,
          artifact_id: artifact.id,
          message:
            `The artifact "${artifact.title}" (type: ${artifact.type}) is now shown to the user ` +
            "inside this tool block.",
        },
      };
    } catch (error) {
      return artifactsFailure(error);
    }
  },
});
