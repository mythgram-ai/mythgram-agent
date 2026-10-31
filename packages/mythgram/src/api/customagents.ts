import { Router, type Request, type Response } from "express";
import type { CustomAgentManager } from "../agents/customagent/index.js";

/**
 * Custom Agents API — read/CRUD over the persistent Custom Agent configurations (spec §8).
 *
 * The frontend primarily persists Custom Agents through the shared app-state sync (the `customAgents`
 * document), exactly like agent teams; these endpoints expose the same data through a
 * dedicated, well-typed surface (and give external callers a clean CRUD API). Every write goes through
 * the CustomAgentManager, which stores configs in the existing SQLite app_state repository.
 */
export function buildCustomAgentsRouter(manager: CustomAgentManager): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    const agents = manager.list();
    res.json({ ok: true, count: agents.length, agents });
  });

  router.get("/:id", (req: Request, res: Response) => {
    const agent = manager.get(String(req.params.id));
    if (!agent) {
      res.status(404).json({ error: "Custom agent not found." });
      return;
    }
    res.json({ ok: true, agent });
  });

  router.post("/", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "A Custom Agent name is required." });
      return;
    }
    const agent = manager.create({
      name,
      description: typeof body.description === "string" ? body.description : "",
      systemPrompt:
        typeof body.system_prompt === "string"
          ? body.system_prompt
          : typeof body.systemPrompt === "string"
            ? (body.systemPrompt as string)
            : "",
      selectedTools: Array.isArray(body.selected_tools)
        ? (body.selected_tools as string[])
        : Array.isArray(body.selectedTools)
          ? (body.selectedTools as string[])
          : [],
    });
    res.json({ ok: true, agent });
  });

  router.put("/:id", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Parameters<CustomAgentManager["update"]>[1] = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.system_prompt === "string") patch.systemPrompt = body.system_prompt;
    else if (typeof body.systemPrompt === "string") patch.systemPrompt = body.systemPrompt as string;
    if (Array.isArray(body.selected_tools)) patch.selectedTools = body.selected_tools as string[];
    else if (Array.isArray(body.selectedTools)) patch.selectedTools = body.selectedTools as string[];

    const agent = manager.update(String(req.params.id), patch);
    if (!agent) {
      res.status(404).json({ error: "Custom agent not found." });
      return;
    }
    res.json({ ok: true, agent });
  });

  router.delete("/:id", (req: Request, res: Response) => {
    const removed = manager.delete(String(req.params.id));
    res.json({ ok: removed });
  });

  return router;
}
