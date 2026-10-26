import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import type { AppConfig } from "../config.js";
import { safeResolve, toWorkspaceRelative } from "../utils/paths.js";
import { mimeTypeFromPath } from "../utils/mime.js";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number | null;
  children?: FileNode[];
}

const IGNORED = new Set([".git", "node_modules", ".next", "dist", ".cache"]);
const MAX_DEPTH = 6;
const MAX_ENTRIES = 2000;

/** Upload folder (inside the workspace) where prompt attachments are stored. Never in SQLite. */
export const UPLOADS_DIR = "uploads";
/** Per-file upload limit: 300 MB. */
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
/** Max files accepted in a single upload request. */
const MAX_UPLOAD_FILES = 10;

/** Strip directories/traversal from a client filename and keep it filesystem-safe. */
function sanitizeUploadName(raw: string): string {
  const base = path.basename(String(raw ?? "")).trim().replace(/\\/g, "");
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 180);
  return cleaned || `upload_${Date.now()}`;
}

/** Unique absolute target inside <workspace>/uploads for a sanitized name (no overwrite). */
async function uniqueUploadTarget(uploadsAbs: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = path.basename(name, ext) || "upload";
  let candidate = path.join(uploadsAbs, `${stem}${ext}`);
  for (let i = 1; i < 1000; i += 1) {
    try {
      await fsp.access(candidate);
      candidate = path.join(uploadsAbs, `${stem}_${i}${ext}`);
    } catch {
      return candidate;
    }
  }
  return path.join(uploadsAbs, `${stem}_${Date.now()}${ext}`);
}

export function buildFilesRouter(config: AppConfig): Router {
  const router = Router();

  // Full (bounded) tree of the workspace for the explorer.
  router.get("/tree", async (req: Request, res: Response) => {
    const requested = typeof req.query.path === "string" && req.query.path.trim() ? req.query.path : ".";
    try {
      const absolute = safeResolve(config.workspaceRoot, requested);
      const counter = { count: 0 };
      const tree = await buildNode(config.workspaceRoot, absolute, 0, counter);
      res.json({ root: toWorkspaceRelative(config.workspaceRoot, absolute), tree });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Read a single file's contents.
  router.get("/read", async (req: Request, res: Response) => {
    const requested = typeof req.query.path === "string" ? req.query.path : "";
    if (!requested) {
      res.status(400).json({ error: "path query parameter is required." });
      return;
    }
    try {
      const absolute = safeResolve(config.workspaceRoot, requested);
      const content = await fsp.readFile(absolute, "utf8");
      res.json({ path: toWorkspaceRelative(config.workspaceRoot, absolute), content });
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Stream a workspace file's raw bytes for inline preview (images, PDFs, HTML, etc.). The
  // browser renders it in place; the `name` query param only customizes the Content-Disposition.
  router.get("/preview", (req: Request, res: Response) => {
    const requested = typeof req.query.path === "string" ? req.query.path : "";
    if (!requested) {
      res.status(400).json({ error: "path query parameter is required." });
      return;
    }
    try {
      const absolute = safeResolve(config.workspaceRoot, requested);
      sendWorkspaceFile(res, absolute, {
        disposition: "inline",
        contentType: mimeTypeFromPath(absolute),
        fallbackName: path.basename(absolute),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Stream a workspace file with a download attachment disposition so the browser saves it.
  router.get("/download", (req: Request, res: Response) => {
    const requested = typeof req.query.path === "string" ? req.query.path : "";
    if (!requested) {
      res.status(400).json({ error: "path query parameter is required." });
      return;
    }
    try {
      const absolute = safeResolve(config.workspaceRoot, requested);
      sendWorkspaceFile(res, absolute, {
        disposition: "attachment",
        contentType: mimeTypeFromPath(absolute),
        fallbackName: path.basename(absolute),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Upload prompt attachments (any file type, including images) into <workspace>/uploads/.
  // Stored as plain files on disk — never in the SQLite database. Per-file limit is 300 MB.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES },
  }).array("files", MAX_UPLOAD_FILES);

  router.post("/upload", (req: Request, res: Response) => {
    upload(req, res, async (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code =
          (err as { code?: string }).code === "LIMIT_FILE_SIZE"
            ? "Each uploaded file must be 300 MB or smaller."
            : `Upload failed: ${message}`;
        res.status(400).json({ error: code });
        return;
      }
      const files = (req.files ?? []) as Express.Multer.File[];
      if (files.length === 0) {
        res.status(400).json({ error: "No files received (field name must be 'files')." });
        return;
      }
      try {
        const uploadsAbs = path.join(config.workspaceRoot, UPLOADS_DIR);
        await fsp.mkdir(uploadsAbs, { recursive: true });
        const saved: Array<{
          name: string;
          path: string;
          absolute_path: string;
          size: number;
          content_type: string;
        }> = [];
        for (const file of files) {
          const name = sanitizeUploadName(file.originalname);
          const target = await uniqueUploadTarget(uploadsAbs, name);
          await fsp.writeFile(target, file.buffer);
          const stat = await fsp.stat(target);
          saved.push({
            name: path.basename(target),
            path: toWorkspaceRelative(config.workspaceRoot, target),
            absolute_path: target,
            size: stat.size,
            content_type: mimeTypeFromPath(target),
          });
        }
        res.json({ ok: true, files: saved, file_count: saved.length });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  return router;
}

/** Open a workspace file and stream its bytes to the response with the requested disposition. */
function sendWorkspaceFile(
  res: Response,
  absolute: string,
  options: { disposition: "inline" | "attachment"; contentType: string; fallbackName: string },
): void {
  if (!fs.existsSync(absolute)) {
    res.status(404).json({ error: `File does not exist: ${absolute}` });
    return;
  }
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) {
    res.status(400).json({ error: `Path is not a regular file: ${absolute}` });
    return;
  }

  const filename = path.basename(absolute) || options.fallbackName;
  res.setHeader(
    "Content-Disposition",
    `${options.disposition}; filename="${filename.replace(/"/g, "")}"`,
  );
  res.setHeader("Content-Type", options.contentType);
  res.setHeader("Content-Length", String(stat.size));

  const stream = fs.createReadStream(absolute);
  stream.on("error", (error) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  });
  stream.pipe(res);
}

async function buildNode(
  root: string,
  absolute: string,
  depth: number,
  counter: { count: number },
): Promise<FileNode[]> {
  if (depth >= MAX_DEPTH || counter.count >= MAX_ENTRIES) return [];

  let dirents;
  try {
    dirents = await fsp.readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];
  for (const dirent of dirents) {
    if (counter.count >= MAX_ENTRIES) break;
    if (IGNORED.has(dirent.name)) continue;
    counter.count += 1;

    const childAbs = `${absolute}/${dirent.name}`;
    const relPath = toWorkspaceRelative(root, childAbs);

    if (dirent.isDirectory()) {
      nodes.push({
        name: dirent.name,
        path: relPath,
        type: "dir",
        children: await buildNode(root, childAbs, depth + 1, counter),
      });
    } else if (dirent.isFile()) {
      let size: number | null = null;
      try {
        size = (await fsp.stat(childAbs)).size;
      } catch {
        size = null;
      }
      nodes.push({ name: dirent.name, path: relPath, type: "file", size });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}
