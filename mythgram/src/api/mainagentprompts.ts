import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import { buildSystemPrompt } from "../agents/systemprompt.js";
import type { MainAgentPromptManager } from "../agents/mainagentprompt/index.js";

/**
 * Main Agent custom system-prompt API — read/CRUD over the persistent custom system prompts for the
 * built-in Main Agent, plus the currently active selection (spec: Custom System Prompts).
 *
 * The backend is the source of truth: prompts and the active id are stored in the SQLite app_state
 * repository through the MainAgentPromptManager. The frontend also mirrors this through the shared
 * app-state sync (the `mainAgentPrompts` / `activeMainAgentPromptId` documents), exactly like Custom
 * Agents; these endpoints expose the same data through a dedicated, well-typed CRUD surface.
 *
 * This feature only changes the INSTRUCTIONS the existing Main Agent runs with — it never creates a
 * new Main Agent, sub-agent, or multi-agent system.
 */
export function buildMainAgentPromptsRouter(
  manager: MainAgentPromptManager,
  config: AppConfig,
): Router {
  const router = Router();

  /** The built-in Main Agent system prompt — used to pre-fill / reload a prompt as a template. */
  router.get("/default", (_req: Request, res: Response) => {
    const systemPrompt = buildSystemPrompt(config.workspaceRoot, {});
    res.json({ ok: true, system_prompt: systemPrompt, workspace: config.workspaceRoot });
  });

  /** List every saved prompt + the currently active id. */
  router.get("/", (_req: Request, res: Response) => {
    const prompts = manager.list();
    res.json({ ok: true, count: prompts.length, active_id: manager.getActiveId(), prompts });
  });

  /** The currently active prompt (or null). */
  router.get("/active", (_req: Request, res: Response) => {
    res.json({ ok: true, active_id: manager.getActiveId(), prompt: manager.getActive() });
  });

  /** Set (or clear) the active prompt. body: { id: string | null }. */
  router.put("/active", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { id?: unknown };
    const id = typeof body.id === "string" && body.id.trim().length > 0 ? body.id.trim() : null;
    const active = manager.setActive(id);
    res.json({ ok: true, active_id: active?.id ?? null, prompt: active });
  });

  router.get("/:id", (req: Request, res: Response) => {
    const prompt = manager.get(String(req.params.id));
    if (!prompt) {
      res.status(404).json({ error: "System prompt not found." });
      return;
    }
    res.json({ ok: true, prompt });
  });

  router.post("/", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "A prompt name is required." });
      return;
    }
    const prompt = manager.create({
      name,
      description: typeof body.description === "string" ? body.description : "",
      content:
        typeof body.content === "string"
          ? body.content
          : typeof body.system_prompt === "string"
            ? (body.system_prompt as string)
            : typeof body.systemPrompt === "string"
              ? (body.systemPrompt as string)
              : "",
    });
    // Optionally activate immediately when the client asks for it.
    if (body.activate === true) manager.setActive(prompt.id);
    res.json({ ok: true, active_id: manager.getActiveId(), prompt });
  });

  router.put("/:id", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Parameters<MainAgentPromptManager["update"]>[1] = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.content === "string") patch.content = body.content;
    else if (typeof body.system_prompt === "string") patch.content = body.system_prompt as string;
    else if (typeof body.systemPrompt === "string") patch.content = body.systemPrompt as string;

    const prompt = manager.update(String(req.params.id), patch);
    if (!prompt) {
      res.status(404).json({ error: "System prompt not found." });
      return;
    }
    res.json({ ok: true, prompt });
  });

  router.delete("/:id", (req: Request, res: Response) => {
    const removed = manager.delete(String(req.params.id));
    res.json({ ok: removed, active_id: manager.getActiveId() });
  });

  return router;
}
