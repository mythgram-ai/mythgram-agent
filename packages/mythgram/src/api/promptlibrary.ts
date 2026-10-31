import { Router, type Request, type Response } from "express";
import type { PromptLibraryManager } from "../prompt-library.js";

/**
 * Prompt Library API — read/CRUD over the persistent user-saved prompts.
 *
 * The frontend primarily persists prompts through the shared app-state sync
 * (the `promptLibrary` document), exactly like Custom Agents / Main Agent
 * prompts / task modes; these endpoints expose the same data through a
 * dedicated, well-typed surface (and give external callers a clean CRUD API).
 * Every write goes through the PromptLibraryManager, which stores entries in
 * the existing SQLite app_state repository.
 */
export function buildPromptLibraryRouter(manager: PromptLibraryManager): Router {
  const router = Router();

  /** List every saved prompt (newest first). */
  router.get("/", (_req: Request, res: Response) => {
    const prompts = manager.list();
    res.json({ ok: true, count: prompts.length, prompts });
  });

  router.get("/:id", (req: Request, res: Response) => {
    const prompt = manager.get(String(req.params.id));
    if (!prompt) {
      res.status(404).json({ error: "Prompt not found." });
      return;
    }
    res.json({ ok: true, prompt });
  });

  router.post("/", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title =
      typeof body.title === "string"
        ? body.title
        : typeof body.name === "string"
          ? (body.name as string)
          : "";
    const description =
      typeof body.description === "string"
        ? body.description
        : typeof body.short_description === "string"
          ? (body.short_description as string)
          : "";
    const content =
      typeof body.content === "string"
        ? body.content
        : typeof body.prompt === "string"
          ? (body.prompt as string)
          : typeof body.text === "string"
            ? (body.text as string)
            : "";
    if (!title.trim() && !content.trim()) {
      res.status(400).json({ error: "A prompt title or prompt text is required." });
      return;
    }
    try {
      const prompt = manager.create({ title, description, content });
      res.json({ ok: true, prompt });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.put("/:id", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Parameters<PromptLibraryManager["update"]>[1] = {};
    if (typeof body.title === "string") patch.title = body.title;
    else if (typeof body.name === "string") patch.title = body.name as string;
    if (typeof body.description === "string") patch.description = body.description;
    else if (typeof body.short_description === "string")
      patch.description = body.short_description as string;
    if (typeof body.content === "string") patch.content = body.content;
    else if (typeof body.prompt === "string") patch.content = body.prompt as string;
    else if (typeof body.text === "string") patch.content = body.text as string;

    const prompt = manager.update(String(req.params.id), patch);
    if (!prompt) {
      res.status(404).json({ error: "Prompt not found." });
      return;
    }
    res.json({ ok: true, prompt });
  });

  router.delete("/:id", (req: Request, res: Response) => {
    const removed = manager.delete(String(req.params.id));
    res.json({ ok: removed });
  });

  return router;
}
