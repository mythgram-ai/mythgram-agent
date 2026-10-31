import { Router, type Request, type Response } from "express";
import type { ChannelManager } from "../channels/index.js";
import type { CustomAgentManager } from "../agents/customagent/index.js";
import { isSafeSessionId } from "../database/index.js";
import { buildSystemPrompt } from "../agents/systemprompt.js";
import { buildChannelSystemSection } from "../agents/tools/sendResponses.js";

/**
 * Channels API — messaging-channel adapters (Telegram / Discord / Slack).
 *
 * Connections (tokens stay server-side; the browser only sees the public
 * projection), per-channel agent selection, per-user chat history, and chat/agent
 * management for the dashboard:
 *
 *   GET    /api/channels                        connections (public, no tokens)
 *   POST   /api/channels                        create { kind, name?, token }
 *   PUT    /api/channels/:id                    rename / replace token / enable
 *   DELETE /api/channels/:id                    delete (+ chats + transcripts)
 *   PUT    /api/channels/:id/agent              { agentId } — agent for NEW chats
 *   GET    /api/channels/:id/chats              per-user chats of a channel
 *   GET    /api/channels/:id/chats/:chatId/messages  transcript view
 *   PUT    /api/channels/:id/chats/:chatId/agent     { agentId } — switch one chat
 *   POST   /api/channels/:id/chats/:userKey/new-chat start a fresh chat
 */

function err(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

export function buildChannelsRouter(
  manager: ChannelManager,
  customAgents: CustomAgentManager,
): Router {
  const router = Router();

  /** Every connection (public projection: status, bot identity, agent, chat counts). */
  router.get("/", (_req: Request, res: Response) => {
    res.json({ ok: true, channels: manager.listPublic() });
  });

  /** Create a connection: validates the token against the provider, then starts it. */
  router.post("/", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { kind?: unknown; name?: unknown; token?: unknown };
    try {
      const channel = await manager.createChannel(body);
      res.json({ ok: true, channel });
    } catch (error) {
      err(res, 400, error instanceof Error ? error.message : String(error));
    }
  });

  router.get("/:id", (req: Request, res: Response) => {
    const channel = manager.getPublic(String(req.params.id));
    if (!channel) {
      err(res, 404, "Channel not found.");
      return;
    }
    res.json({ ok: true, channel });
  });

  router.put("/:id", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { name?: unknown; token?: unknown; enabled?: unknown };
    try {
      const channel = await manager.updateChannel(String(req.params.id), body);
      res.json({ ok: true, channel });
    } catch (error) {
      err(res, 400, error instanceof Error ? error.message : String(error));
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    const removed = await manager.deleteChannel(String(req.params.id));
    res.json({ ok: removed });
  });

  /** Agent serving NEW chats on a channel. Body: { agentId: string | null } ("main" = Default). */
  router.put("/:id/agent", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { agentId?: unknown; agent_id?: unknown };
    const raw = body.agentId ?? body.agent_id;
    try {
      const channel = manager.setChannelAgent(
        String(req.params.id),
        typeof raw === "string" ? raw : null,
      );
      res.json({ ok: true, channel });
    } catch (error) {
      err(res, 400, error instanceof Error ? error.message : String(error));
    }
  });

  /** Per-user chats of a channel (agent, title, recency). */
  router.get("/:id/chats", (req: Request, res: Response) => {
    const channel = manager.getPublic(String(req.params.id));
    if (!channel) {
      err(res, 404, "Channel not found.");
      return;
    }
    const chats = manager.listChats(String(req.params.id)).map((chat) => ({
      chat_id: chat.id,
      user_key: chat.userKey,
      user_label: chat.userLabel,
      agent_id: chat.agentId,
      agent_name: agentName(customAgents, chat.agentId),
      title: chat.title,
      created_at: chat.createdAt,
      updated_at: chat.updatedAt,
    }));
    res.json({ ok: true, count: chats.length, chats });
  });

  /** Transcript view of one chat (user/assistant text; tool traffic summarized). */
  router.get("/:id/chats/:chatId/messages", (req: Request, res: Response) => {
    const chatId = String(req.params.chatId);
    if (!isSafeSessionId(chatId)) {
      err(res, 400, "Invalid chat id.");
      return;
    }
    const db = manager.db;
    const chat = db.channelChats.get(chatId);
    if (!chat || chat.channelId !== String(req.params.id)) {
      err(res, 404, "Chat not found.");
      return;
    }
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 200;
    const messages = db.channelMessages
      .list(chatId)
      .slice(-limit)
      .map((m, i) => ({
        seq: i,
        role: m.role,
        text: textOf(m.content),
        has_tools: Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
      }));
    res.json({ ok: true, chat_id: chatId, messages });
  });

  /**
   * Raw context + meter for one channel chat: the provider-format transcript
   * (untruncated, from channel_messages) plus the resolved system prompt the
   * channel turn runs with (Default or the chat's Custom Agent + channel rules),
   * and the latest captured `context_usage` for the meter (null until a turn
   * reports). Powers the Channels dashboard context popup (limit + raw view).
   * Never throws for transcript reads.
   */
  router.get("/:id/chats/:chatId/context", (req: Request, res: Response) => {
    const chatId = String(req.params.chatId);
    if (!isSafeSessionId(chatId)) {
      err(res, 400, "Invalid chat id.");
      return;
    }
    const db = manager.db;
    const chat = db.channelChats.get(chatId);
    if (!chat || chat.channelId !== String(req.params.id)) {
      err(res, 404, "Chat not found.");
      return;
    }
    const connection = manager.store.get(chat.channelId);
    let messages: unknown[] = [];
    try {
      messages = db.channelMessages.list(chatId).map((m) => ({ ...m }));
    } catch {
      messages = [];
    }
    // Resolve the system prompt the same way the runner does: Custom Agent's
    // own prompt when the chat serves one, else the built-in Main Agent prompt —
    // plus the channel rules section.
    let systemPrompt: string | null = null;
    let systemPromptSource: "custom" | "builtin" = "builtin";
    try {
      const custom = chat.agentId ? customAgents.get(chat.agentId) ?? null : null;
      if (custom && custom.systemPrompt.trim().length > 0) {
        systemPrompt = custom.systemPrompt;
        systemPromptSource = "custom";
      } else {
        systemPrompt = buildSystemPrompt(process.cwd(), {});
      }
      if (connection) {
        const section = buildChannelSystemSection({
          kind: connection.kind,
          channelName: connection.name,
          userLabel: chat.userLabel,
        });
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${section}` : section;
      }
    } catch {
      // keep null — raw transcript still served
    }
    let usage: Record<string, unknown> | null = null;
    try {
      usage = manager.lastChatContextUsage(chatId);
    } catch {
      usage = null;
    }
    res.json({
      ok: true,
      chat_id: chatId,
      channel_id: chat.channelId,
      agent_id: chat.agentId,
      agent_name: agentName(customAgents, chat.agentId),
      systemPrompt,
      systemPromptSource,
      messages,
      source: messages.length > 0 ? "persisted" : "empty",
      messageCount: messages.length,
      usage,
      fetchedAt: Date.now(),
    });
  });

  /** Switch the agent serving one existing chat. Body: { agentId: string | null }. */
  router.put("/:id/chats/:chatId/agent", (req: Request, res: Response) => {
    const chatId = String(req.params.chatId);
    if (!isSafeSessionId(chatId)) {
      err(res, 400, "Invalid chat id.");
      return;
    }
    const body = (req.body ?? {}) as { agentId?: unknown; agent_id?: unknown };
    const raw = body.agentId ?? body.agent_id;
    try {
      const chat = manager.setChatAgent(chatId, typeof raw === "string" ? raw : null);
      if (chat.channelId !== String(req.params.id)) {
        err(res, 404, "Chat not found.");
        return;
      }
      res.json({
        ok: true,
        chat_id: chat.id,
        agent_id: chat.agentId,
        agent_name: agentName(customAgents, chat.agentId),
      });
    } catch (error) {
      err(res, 400, error instanceof Error ? error.message : String(error));
    }
  });

  /** Start a fresh chat for an external user (dashboard "new chat"). */
  router.post("/:id/chats/:userKey/new-chat", (req: Request, res: Response) => {
    const userKey = String(req.params.userKey);
    if (!userKey) {
      err(res, 400, "A user key is required.");
      return;
    }
    try {
      const chat = manager.newChatForUser(String(req.params.id), userKey);
      res.json({
        ok: true,
        chat_id: chat.id,
        agent_id: chat.agentId,
        agent_name: agentName(customAgents, chat.agentId),
      });
    } catch (error) {
      err(res, 400, error instanceof Error ? error.message : String(error));
    }
  });

  return router;
}

function agentName(customAgents: CustomAgentManager, agentId: string | null): string {
  if (!agentId) return "Default Agent";
  return customAgents.get(agentId)?.name ?? "Default Agent";
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 4000);
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>;
          if (typeof record.text === "string") return record.text;
          if (record.type === "image_url") return "[attached image]";
        }
        return "";
      })
      .filter((t) => t.length > 0)
      .join("\n")
      .slice(0, 4000);
  }
  return "";
}
