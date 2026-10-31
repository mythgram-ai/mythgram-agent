import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import { buildSystemPrompt } from "../agents/systemprompt.js";

/**
 * System-prompt API — exposes the built Main Agent system prompt so the Custom Agent creation UI can
 * PRE-FILL its "System Prompt" field (spec §2). A Custom Agent therefore starts with exactly the same
 * base capabilities and instructions as the Main Agent; the user then freely edits/adds/removes.
 *
 * The prompt is built with default options (the neutral Main Agent surface): the sub-agent
 * session-reuse tools are omitted, matching the default Main Agent baseline.
 */
export function buildSystemPromptRouter(config: AppConfig): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    const systemPrompt = buildSystemPrompt(config.workspaceRoot, {});
    res.json({ ok: true, system_prompt: systemPrompt, workspace: config.workspaceRoot });
  });

  return router;
}
