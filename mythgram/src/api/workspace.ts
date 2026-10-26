import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { config, setWorkspaceRoot } from "../config.js";
import { safeResolve, toWorkspaceRelative } from "../utils/paths.js";

/**
 * Workspace API — lets the user see and change the agent's workspace at runtime.
 *
 * The workspace defaults to wherever mythgram is started/running (process.cwd()).
 * All file tools are sandboxed to it, and the ".mythgram" dir is initialized where
 * the workspace is set.
 *
 * - GET  /api/workspace         -> { workspace } (absolute path)
 * - POST /api/workspace         -> { workspace } — body { path?: string }.
 *      An absolute path switches to it (created when missing); a relative path is
 *      resolved inside the current workspace (so `<folder>` or `<a>/<b>/<c>` creates
 *      a new workspace underneath it). Empty path returns the current workspace.
 * - POST /api/workspace/mkdir   -> { path } — body { path: string }.
 *      Creates a folder (nested paths like `<a>/<b>/<c>` supported) inside the
 *      current workspace and returns its workspace-relative path.
 */
export function buildWorkspaceRouter(): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json({ ok: true, workspace: config.workspaceRoot });
  });

  router.post("/", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { path?: unknown; create?: unknown };
    const raw = typeof body.path === "string" ? body.path.trim() : "";
    if (!raw) {
      res.json({ ok: true, workspace: config.workspaceRoot });
      return;
    }

    let target: string;
    try {
      target = path.isAbsolute(raw)
        ? path.normalize(raw)
        : path.resolve(config.workspaceRoot, raw);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    try {
      const stat = await fsp.stat(target).catch(() => null);
      if (stat && !stat.isDirectory()) {
        res.status(400).json({ error: `Path exists and is not a directory: ${target}` });
        return;
      }
      const workspace = setWorkspaceRoot(target);
      res.json({ ok: true, workspace });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/mkdir", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { path?: unknown };
    const raw = typeof body.path === "string" ? body.path.trim() : "";
    if (!raw) {
      res.status(400).json({ error: "A folder path is required (e.g. <folder name> or <a>/<b>/<c>)." });
      return;
    }

    let absolute: string;
    try {
      absolute = safeResolve(config.workspaceRoot, raw);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    try {
      await fsp.mkdir(absolute, { recursive: true });
      // Guard: the target must be a directory (not a file that already existed).
      const stat = await fsp.stat(absolute);
      if (!stat.isDirectory()) {
        res.status(400).json({ error: `Path exists and is not a directory: ${raw}` });
        return;
      }
      res.json({
        ok: true,
        path: toWorkspaceRelative(config.workspaceRoot, absolute),
        workspace: config.workspaceRoot,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Keep the process alive check cheap: confirm the workspace root exists.
  router.get("/check", (_req: Request, res: Response) => {
    const exists = fs.existsSync(config.workspaceRoot);
    res.json({ ok: exists, workspace: config.workspaceRoot });
  });

  return router;
}
