import { Router, type Request, type Response } from "express";
import type { MemoryAgentService } from "../agents/memoryagent/index.js";
import type { MemoryAgentRunRow } from "../database/index.js";
import { isSafeSessionId } from "../database/index.js";
import type { SessionEventBuffer } from "../services/eventBuffer.js";
import { initSSE, formatSSE } from "../utils/sse.js";

/** Wire shape of one memory-agent run returned by the list/detail endpoints. */
function serializeRun(run: MemoryAgentRunRow): Record<string, unknown> {
  return {
    id: run.id,
    chat_session_id: run.chatSessionId,
    status: run.status,
    provider: run.provider,
    model: run.model,
    summary: run.summary,
    error: run.error,
    updated_files: run.updatedFiles,
    queued_at: run.queuedAt,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
  };
}

/**
 * REST + SSE surface of the background memory agent. Everything the memory agent does
 * happens in the backend; these endpoints only let the frontend WATCH: list sessions
 * (queued/running/completed/failed with counts), read one run, and attach to a run's
 * live stream (or replay a finished run from the SQLite event log).
 */
export function buildMemoryAgentRouter(memoryAgent: MemoryAgentService): Router {
  const router = Router();

  /** Sessions overview: counts + the most recent runs. */
  router.get("/runs", (req: Request, res: Response) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 50;
    res.json({
      ok: true,
      counts: memoryAgent.counts(),
      runs: memoryAgent.listRuns(limit).map(serializeRun),
    });
  });

  router.get("/runs/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      res.status(400).json({ error: "Invalid run id." });
      return;
    }
    const run = memoryAgent.getRun(id);
    if (!run) {
      res.status(404).json({ error: "Memory-agent run not found." });
      return;
    }
    res.json({ ok: true, run: serializeRun(run) });
  });

  /**
   * Attach to a run's SSE stream. Live (queued/running/recently finished) runs stream from
   * the in-memory buffer with replay from `since_event_id`; older finished runs replay from
   * the persisted event log. Body: { since_event_id?: number }.
   */
  router.post("/runs/:id/stream", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      res.status(400).json({ error: "Invalid run id." });
      return;
    }

    const body = (req.body ?? {}) as { since_event_id?: unknown };
    const sinceId =
      typeof body.since_event_id === "number" && Number.isFinite(body.since_event_id)
        ? Math.floor(body.since_event_id)
        : -1;

    const buffer = memoryAgent.liveBuffer(id);
    if (buffer) {
      await streamFromBuffer(res, buffer, sinceId);
      return;
    }

    const run = memoryAgent.getRun(id);
    if (!run) {
      res.status(404).json({ error: "Memory-agent run not found." });
      return;
    }

    replayFromDatabase(res, memoryAgent, id, sinceId, run.status);
  });

  return router;
}

/** Replay a finished (or interrupted) run straight from the SQLite event log. */
function replayFromDatabase(
  res: Response,
  memoryAgent: MemoryAgentService,
  runId: string,
  sinceId: number,
  status: string,
): void {
  initSSE(res);
  const events = memoryAgent.storedEvents(runId, sinceId);

  let sawTerminal = false;
  let lastId = sinceId;
  for (const event of events) {
    // A coalesced row whose range straddles sinceId contains text the client already
    // rendered — skip it rather than resend duplicated content.
    if (event.firstEventId <= sinceId) continue;
    res.write(formatSSE(event.event, { ...event.data, _event_id: event.eventId }));
    lastId = event.eventId;
    if (event.event === "done") sawTerminal = true;
  }
  // A run interrupted by a restart has no terminal event — synthesize one so the client
  // stops waiting instead of reconnect-looping.
  if (!sawTerminal) {
    res.write(
      formatSSE("done", {
        ok: status === "completed",
        interrupted: status !== "completed",
        _event_id: lastId + 1,
      }),
    );
  }
  res.end();
}

async function streamFromBuffer(
  res: Response,
  buffer: SessionEventBuffer,
  sinceId: number,
): Promise<void> {
  initSSE(res);
  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  try {
    for await (const event of buffer.subscribe(sinceId)) {
      if (closed) break;
      res.write(formatSSE(event.event, event.data));
    }
  } catch {
    // client disconnected or buffer ended; fall through to close.
  } finally {
    if (!closed) res.end();
  }
}
