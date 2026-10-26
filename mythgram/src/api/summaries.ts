import { Router, type Request, type Response } from "express";
import {
  getCustomHandoffHistory,
  getHandoffHistory,
  getSubAgentHandoffHistory,
} from "../agents/summarization/index.js";
import { isSafeSessionId } from "../database/index.js";

/**
 * Summaries API — past automatic context-summarization runs in a session.
 *
 * The handoff history is recorded backend-side on every terminal handoff
 * outcome (success or failure) and served here so the UI history button can
 * list past runs without replaying every turn's event log:
 *
 *   GET /api/summaries/history/:chatId  past top-level runs (main + custom), oldest first (bounded)
 *   GET /api/summaries/custom-history/:chatId  past custom-agent runs, oldest first (bounded)
 *   GET /api/summaries/sub-agent-history/:chatId  past sub-agent runs, oldest first (bounded)
 */

export function buildSummaryRouter(): Router {
  const router = Router();

  router.get("/history/:chatId", (req: Request, res: Response) => {
    const chatId = String(req.params.chatId);
    if (!isSafeSessionId(chatId)) {
      res.status(400).json({ error: "Invalid chat id." });
      return;
    }
    const history = getHandoffHistory(chatId).map((r) => ({
      handoff_id: r.handoffId,
      chat_id: r.chatId,
      agent: r.agent,
      custom_agent_id: r.customAgentId,
      custom_agent_name: r.customAgentName,
      state: r.state,
      summary: r.summary,
      summary_chars: r.summaryChars,
      latest_user_input: r.latestUserInput,
      code: r.code,
      error: r.error,
      created_at: r.createdAt,
      finished_at: r.finishedAt,
    }));
    res.json({ ok: true, chat_id: chatId, count: history.length, history });
  });

  router.get("/custom-history/:chatId", (req: Request, res: Response) => {
    const chatId = String(req.params.chatId);
    if (!isSafeSessionId(chatId)) {
      res.status(400).json({ error: "Invalid chat id." });
      return;
    }
    const history = getCustomHandoffHistory(chatId).map((r) => ({
      handoff_id: r.handoffId,
      chat_id: r.chatId,
      agent: r.agent,
      custom_agent_id: r.customAgentId,
      custom_agent_name: r.customAgentName,
      state: r.state,
      summary: r.summary,
      summary_chars: r.summaryChars,
      latest_user_input: r.latestUserInput,
      code: r.code,
      error: r.error,
      created_at: r.createdAt,
      finished_at: r.finishedAt,
    }));
    res.json({ ok: true, chat_id: chatId, count: history.length, history });
  });

  router.get("/sub-agent-history/:chatId", (req: Request, res: Response) => {
    const chatId = String(req.params.chatId);
    if (!isSafeSessionId(chatId)) {
      res.status(400).json({ error: "Invalid chat id." });
      return;
    }
    const history = getSubAgentHandoffHistory(chatId).map((r) => ({
      handoff_id: r.handoffId,
      chat_id: r.chatId,
      sub_session_id: r.subSessionId,
      sub_agent: r.subAgentName,
      state: r.state,
      summary: r.summary,
      summary_chars: r.summaryChars,
      latest_user_input: r.latestUserInput,
      code: r.code,
      error: r.error,
      created_at: r.createdAt,
      finished_at: r.finishedAt,
    }));
    res.json({ ok: true, chat_id: chatId, count: history.length, history });
  });

  return router;
}
