import { ArtifactError, type ArtifactMeta } from "../../artifacts/index.js";
import type { ToolContext, ToolResult } from "./types.js";

/**
 * Map an artifact-layer error to the structured ToolResult shape the model understands. Unknown
 * errors degrade to a generic artifact failure so a tool call never throws.
 */
export function artifactsFailure(error: unknown): ToolResult {
  if (error instanceof ArtifactError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.extra ?? {}),
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "artifact_operation_failed",
      message: `Artifact operation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    },
  };
}

/**
 * Publish the current artifact list to the running turn so the frontend artifacts panel converges
 * immediately after a mutation. Best-effort: a missing emit (e.g. a non-streaming caller) is fine.
 */
export function emitArtifactsUpdated(ctx: ToolContext, artifacts: ArtifactMeta[]): void {
  try {
    ctx.emit?.("artifacts_updated", { artifacts });
  } catch {
    // The structured tool result already tells the model what happened.
  }
}
