import { Router, type Request, type Response } from "express";
import { ArtifactError, artifactsManager, isArtifactType } from "../artifacts/index.js";
import type { AppConfig } from "../config.js";

/**
 * Artifacts API — list, preview, edit, pin, duplicate, and delete the artifacts saved by the agent
 * (or the user). The agent tools write through the same filesystem-backed manager, so an artifact
 * the agent saves appears in the panel immediately (and vice versa).
 */
export function buildArtifactsRouter(config: AppConfig): Router {
  const router = Router();

  const fail = (res: Response, error: unknown): void => {
    if (error instanceof ArtifactError) {
      const status = error.code === "artifact_not_found" ? 404 : 400;
      res.status(status).json({ error: error.message, code: error.code, ...(error.extra ?? {}) });
      return;
    }
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      code: "artifact_operation_failed",
    });
  };

  /** List every saved artifact (metadata only, newest/pinned first). */
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const artifacts = await artifactsManager.list(config.workspaceRoot);
      res.json({ ok: true, count: artifacts.length, artifacts });
    } catch (error) {
      fail(res, error);
    }
  });

  /** Read one artifact with its full raw content (for preview/editing). */
  router.get("/:id", async (req: Request, res: Response) => {
    try {
      const artifact = await artifactsManager.read(String(req.params.id), config.workspaceRoot);
      res.json({ ok: true, artifact });
    } catch (error) {
      fail(res, error);
    }
  });

  /** Update an artifact's metadata and/or replace its content. */
  router.put("/:id", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const artifact = await artifactsManager.update(
        String(req.params.id),
        {
          title: typeof body.title === "string" ? body.title : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          type: isArtifactType(body.type) ? body.type : undefined,
          content: typeof body.content === "string" ? body.content : undefined,
        },
        config.workspaceRoot,
      );
      res.json({ ok: true, artifact });
    } catch (error) {
      fail(res, error);
    }
  });

  /** Pin or unpin an artifact. Defaults to toggling the current value when `pinned` is omitted. */
  router.post("/:id/pin", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const id = String(req.params.id);
      const current = await artifactsManager.get(id, config.workspaceRoot);
      const pinned = typeof body.pinned === "boolean" ? body.pinned : !(current?.pinned ?? false);
      const artifact = await artifactsManager.setPinned(id, pinned, config.workspaceRoot);
      res.json({ ok: true, artifact });
    } catch (error) {
      fail(res, error);
    }
  });

  /** Duplicate an artifact under a new id. */
  router.post("/:id/duplicate", async (req: Request, res: Response) => {
    try {
      const artifact = await artifactsManager.duplicate(String(req.params.id), config.workspaceRoot);
      res.json({ ok: true, artifact });
    } catch (error) {
      fail(res, error);
    }
  });

  /** Delete an artifact (file + metadata). */
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const removed = await artifactsManager.remove(String(req.params.id), config.workspaceRoot);
      res.json({ ok: true, artifact: removed });
    } catch (error) {
      fail(res, error);
    }
  });

  return router;
}
