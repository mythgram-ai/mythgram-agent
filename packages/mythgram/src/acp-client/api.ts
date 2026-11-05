import { Router, type Request, type Response } from "express";
import { AcpClientError, AcpClientManager } from "./manager.js";
import type { AcpElicitationResponse } from "./types.js";

/**
 * HTTP surface for the in-app ACP client.
 *
 *   GET    /api/acp-client                              list configured agents + status
 *   POST   /api/acp-client                              create an agent config
 *   POST   /api/acp-client/validate                     test an unsaved config
 *   GET    /api/acp-client/:id                          one agent
 *   PUT    /api/acp-client/:id                          update an agent config
 *   DELETE /api/acp-client/:id                          delete an agent + its sessions
 *   POST   /api/acp-client/:id/connect                  spawn + initialize the agent
 *   POST   /api/acp-client/:id/disconnect               stop the agent process
 *   POST   /api/acp-client/:id/authenticate             run an advertised auth method
 *   POST   /api/acp-client/:id/logout                   end authenticated state
 *   GET    /api/acp-client/:id/sessions                 list app-owned sessions
 *   POST   /api/acp-client/:id/sessions                 create a session
 *   GET    /api/acp-client/:id/sessions/:sessionId      session + replayable event log
 *   DELETE /api/acp-client/:id/sessions/:sessionId      delete a session
 *   POST   /api/acp-client/:id/sessions/:sessionId/prompt       SSE prompt turn
 *   POST   /api/acp-client/:id/sessions/:sessionId/cancel       cancel the running turn
 *   POST   /api/acp-client/:id/sessions/:sessionId/mode         set session mode
 *   POST   /api/acp-client/:id/sessions/:sessionId/config       set config option
 *   POST   /api/acp-client/:id/sessions/:sessionId/permissions/:requestId
 *   POST   /api/acp-client/:id/sessions/:sessionId/elicitations/:requestId
 *
 * Client-side ids are always our own 20-digit numeric ids; the connected
 * agent's internal session id never leaves the backend.
 */

function sendError(res: Response, error: unknown): void {
  if (error instanceof AcpClientError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  res.status(500).json({
    error: error instanceof Error ? error.message : String(error),
    code: "acp_client_error",
  });
}

function writeEvent(res: Response, event: string, data: unknown): boolean {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

export function buildAcpClientRouter(manager: AcpClientManager, workspaceRoot: string): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      workspace: workspaceRoot,
      clients: manager.listClients(),
    });
  });

  router.post("/validate", async (req: Request, res: Response) => {
    try {
      const result = await manager.validate((req.body ?? {}) as unknown);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/", (req: Request, res: Response) => {
    try {
      const client = manager.createClient((req.body ?? {}) as unknown);
      res.json({ ok: true, client });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/:id", (req: Request, res: Response) => {
    try {
      res.json({ ok: true, client: manager.getClient(String(req.params.id)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put("/:id", (req: Request, res: Response) => {
    try {
      const client = manager.updateClient(String(req.params.id), (req.body ?? {}) as unknown);
      res.json({ ok: true, client });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      await manager.deleteClient(String(req.params.id));
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/connect", async (req: Request, res: Response) => {
    try {
      const client = await manager.connect(String(req.params.id));
      res.json({ ok: true, client });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/disconnect", async (req: Request, res: Response) => {
    try {
      const client = await manager.disconnect(String(req.params.id));
      res.json({ ok: true, client });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/authenticate", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { methodId?: unknown; method_id?: unknown };
    const methodId = typeof body.methodId === "string" ? body.methodId : typeof body.method_id === "string" ? body.method_id : "";
    try {
      const client = await manager.authenticate(String(req.params.id), methodId);
      res.json({ ok: true, client });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/logout", async (req: Request, res: Response) => {
    try {
      const client = await manager.logout(String(req.params.id));
      res.json({ ok: true, client });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/:id/sessions", (req: Request, res: Response) => {
    try {
      const sessions = manager.listSessions(String(req.params.id));
      res.json({ ok: true, sessions });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/sessions", async (req: Request, res: Response) => {
    try {
      const session = await manager.createSession(String(req.params.id), (req.body ?? {}) as unknown);
      res.json({ ok: true, session });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/:id/sessions/:sessionId", (req: Request, res: Response) => {
    try {
      const session = manager.getSession(String(req.params.id), String(req.params.sessionId));
      res.json({ ok: true, session });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/:id/sessions/:sessionId", async (req: Request, res: Response) => {
    try {
      await manager.deleteSession(String(req.params.id), String(req.params.sessionId));
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/sessions/:sessionId/mode", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { modeId?: unknown; mode_id?: unknown };
    const modeId = typeof body.modeId === "string" ? body.modeId : typeof body.mode_id === "string" ? body.mode_id : "";
    try {
      const session = await manager.setSessionMode(
        String(req.params.id),
        String(req.params.sessionId),
        modeId,
      );
      res.json({ ok: true, session });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/sessions/:sessionId/config", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { configId?: unknown; config_id?: unknown; value?: unknown };
    const configId =
      typeof body.configId === "string" ? body.configId : typeof body.config_id === "string" ? body.config_id : "";
    const value =
      typeof body.value === "string" || typeof body.value === "boolean" ? body.value : "";
    try {
      const session = await manager.setSessionConfig(
        String(req.params.id),
        String(req.params.sessionId),
        configId,
        value,
      );
      res.json({ ok: true, session });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/sessions/:sessionId/cancel", async (req: Request, res: Response) => {
    try {
      await manager.cancel(String(req.params.id), String(req.params.sessionId));
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/sessions/:sessionId/permissions/:requestId", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { optionId?: unknown; option_id?: unknown };
    const optionId =
      typeof body.optionId === "string"
        ? body.optionId
        : typeof body.option_id === "string"
          ? body.option_id
          : null;
    try {
      manager.resolvePermission(
        String(req.params.id),
        String(req.params.sessionId),
        String(req.params.requestId),
        optionId,
      );
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/:id/sessions/:sessionId/elicitations/:requestId", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      action?: unknown;
      content?: unknown;
    };
    const action = body.action === "accept" || body.action === "decline" || body.action === "cancel"
      ? body.action
      : "cancel";
    const response: AcpElicitationResponse =
      action === "accept"
        ? {
            action: "accept",
            content:
              body.content && typeof body.content === "object" && !Array.isArray(body.content)
                ? (body.content as Record<string, unknown>)
                : {},
          }
        : { action };
    try {
      manager.resolveElicitation(
        String(req.params.id),
        String(req.params.sessionId),
        String(req.params.requestId),
        response,
      );
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  /** Prompt turn: a single SSE stream of ACP session updates + lifecycle events. */
  router.post("/:id/sessions/:sessionId/prompt", async (req: Request, res: Response) => {
    const clientId = String(req.params.id);
    const sessionId = String(req.params.sessionId);
    const body = (req.body ?? {}) as { text?: unknown; message?: unknown };
    const text = typeof body.text === "string" ? body.text : typeof body.message === "string" ? body.message : "";

    try {
      // Validate synchronously so obvious errors get JSON statuses instead of a 200 SSE.
      manager.getSession(clientId, sessionId);
      if (manager.isSessionRunning(sessionId)) {
        res.status(409).json({ error: "A prompt is already running in this session.", code: "acp_busy" });
        return;
      }
      if (!text.trim()) {
        res.status(400).json({ error: "A message is required.", code: "acp_empty_prompt" });
        return;
      }
    } catch (error) {
      sendError(res, error);
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let finished = false;
    const heartbeat = setInterval(() => {
      if (finished) return;
      try {
        res.write(": ping\n\n");
      } catch {
        // ignore
      }
    }, 15_000);
    heartbeat.unref?.();

    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      try {
        res.end();
      } catch {
        // already closed
      }
    };

    // If the browser goes away mid-turn, cancel the agent so no permission prompt
    // can be left waiting for a UI that no longer exists.
    res.on("close", () => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      void manager.cancel(clientId, sessionId).catch(() => undefined);
    });

    const emit = (event: string, data: unknown): void => {
      if (finished) return;
      if (!writeEvent(res, event, data)) finish();
    };

    try {
      await manager.prompt({ clientId, sessionId, text, emit });
    } catch (error) {
      if (!finished) {
        emit("error", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
        emit("done", { sessionId, stopReason: "error" });
      }
    } finally {
      finish();
    }
  });

  return router;
}