import { Router, type Request, type Response } from "express";
import {
  describeCron,
  getNextOccurrences,
  isValidCron,
  listTimezones,
  type ScheduleStore,
  type ScheduleScheduler,
  validateScheduleInput,
} from "../cron/index.js";
import { toRecurrence } from "../cron/store.js";
import { isSafeSessionId } from "../database/index.js";
import type { MythgramDatabase } from "../database/index.js";
import type { CustomAgentManager } from "../agents/customagent/index.js";
import { buildSystemPrompt } from "../agents/systemprompt.js";

/**
 * Schedules API — CRUD + execution control for the persistent cron system.
 *
 * Schedules are owned entirely by the backend (SQLite `schedules` table +
 * `schedule_runs` history) and executed by the background scheduler, so they
 * keep working with no browser open. The frontend manages them here:
 *
 *   GET    /api/schedules                 list (with display status)
 *   POST   /api/schedules                 create
 *   POST   /api/schedules/preview         next fire times for a draft payload
 *   GET    /api/schedules/timezones       supported IANA timezones
 *   GET    /api/schedules/:id             detail
 *   PUT    /api/schedules/:id             update (partial)
 *   DELETE /api/schedules/:id             delete (+ history)
 *   POST   /api/schedules/:id/duplicate   full copy (starts paused)
 *   POST   /api/schedules/:id/run         manual "Run now"
 *   GET    /api/schedules/:id/runs        execution history
 *   GET    /api/schedules/:id/runs/:runId one run's logs
 */

function err(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

export function buildSchedulesRouter(
  store: ScheduleStore,
  scheduler: ScheduleScheduler,
  db: MythgramDatabase,
  customAgents: CustomAgentManager,
): Router {
  const router = Router();

  /** Every schedule with its display status. */
  router.get("/", (_req: Request, res: Response) => {
    res.json({ ok: true, count: store.list().length, schedules: store.listViews() });
  });

  /** Supported timezones for the setup UI picker. */
  router.get("/timezones", (_req: Request, res: Response) => {
    res.json({ ok: true, timezones: listTimezones() });
  });

  /**
   * Preview the next fire times of a draft schedule payload (validates the
   * recurrence without persisting anything). Body: the schedule fields.
   */
  router.post("/preview", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { draft, error } = validateScheduleInput(body, false);
    if (!draft || error) {
      res.json({ ok: false, error: error ?? "Invalid schedule.", occurrences: [] });
      return;
    }
    const countRaw = (req.body as Record<string, unknown>).count;
    const count = typeof countRaw === "number" && Number.isFinite(countRaw)
      ? Math.max(1, Math.min(Math.floor(countRaw), 20))
      : 5;
    const occurrences = getNextOccurrences(
      {
        kind: draft.kind,
        cron: draft.cron,
        intervalMinutes: draft.intervalMinutes,
        time: draft.time,
        weekdays: draft.weekdays,
        dayOfMonth: draft.dayOfMonth,
        runAt: draft.runAt,
        startAt: draft.startAt,
        endAt: draft.endAt,
        timezone: draft.timezone,
      },
      Date.now(),
      count,
    );
    res.json({
      ok: true,
      occurrences,
      description: draft.kind === "cron" ? describeCron(draft.cron) : undefined,
      cronValid: draft.kind === "cron" ? isValidCron(draft.cron) : undefined,
    });
  });

  /** Create a schedule. */
  router.post("/", (req: Request, res: Response) => {
    try {
      const created = store.create(req.body ?? {});
      // A referenced Custom Agent must exist (fail fast with a clear message).
      if (created.agentType === "custom" && created.customAgentId && !customAgents.get(created.customAgentId)) {
        store.delete(created.id);
        err(res, 400, "The selected Custom Agent no longer exists. Pick another agent.");
        return;
      }
      res.json({ ok: true, schedule: store.getView(created.id) });
    } catch (error) {
      err(res, 400, error instanceof Error ? error.message : String(error));
    }
  });

  router.get("/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "Invalid schedule id.");
      return;
    }
    const view = store.getView(id);
    if (!view) {
      err(res, 404, "Schedule not found.");
      return;
    }
    res.json({ ok: true, schedule: view });
  });

  router.put("/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "Invalid schedule id.");
      return;
    }
    try {
      const updated = store.update(id, req.body ?? {});
      if (!updated) {
        err(res, 404, "Schedule not found.");
        return;
      }
      if (updated.agentType === "custom" && updated.customAgentId && !customAgents.get(updated.customAgentId)) {
        err(res, 400, "The selected Custom Agent no longer exists. Pick another agent.");
        return;
      }
      res.json({ ok: true, schedule: store.getView(id) });
    } catch (error) {
      err(res, 400, error instanceof Error ? error.message : String(error));
    }
  });

  router.delete("/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "Invalid schedule id.");
      return;
    }
    res.json({ ok: store.delete(id) });
  });

  /** Duplicate a schedule (full copy under a new id, starts paused). */
  router.post("/:id/duplicate", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "Invalid schedule id.");
      return;
    }
    const copy = store.duplicate(id);
    if (!copy) {
      err(res, 404, "Schedule not found.");
      return;
    }
    res.json({ ok: true, schedule: store.getView(copy.id) });
  });

  /** Manual "Run now" — executes immediately (null when already running/done). */
  router.post("/:id/run", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "Invalid schedule id.");
      return;
    }
    const runId = await scheduler.runNow(id);
    if (!runId) {
      err(res, 409, "The schedule cannot run right now (already running, or completed).");
      return;
    }
    res.json({ ok: true, run_id: runId });
  });

  /** Execution history (most recent first). */
  router.get("/:id/runs", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "Invalid schedule id.");
      return;
    }
    if (!store.get(id)) {
      err(res, 404, "Schedule not found.");
      return;
    }
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 50;
    res.json({ ok: true, runs: db.scheduleRuns.listBySchedule(id, limit) });
  });

  /** One run's logs. */
  router.get("/:id/runs/:runId", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const runId = String(req.params.runId);
    if (!isSafeSessionId(id) || !isSafeSessionId(runId)) {
      err(res, 400, "Invalid schedule or run id.");
      return;
    }
    const run = db.scheduleRuns.get(runId);
    if (!run || run.scheduleId !== id) {
      err(res, 404, "Run not found.");
      return;
    }
    res.json({ ok: true, run });
  });

  /**
   * Raw context + meter for one schedule: the task prompt as the user message
   * plus the resolved system prompt the scheduled run executes with (Default or
   * the schedule's Custom Agent), and the latest captured `context_usage` for
   * the meter (null until a run reports). Schedule runs use ephemeral sessions,
   * so the transcript is the schedule prompt itself — the raw view shows exactly
   * what the agent receives. Powers the Schedules history context popup
   * (limit + raw view). Never throws.
   */
  router.get("/:id/context", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "Invalid schedule id.");
      return;
    }
    const schedule = store.get(id);
    if (!schedule) {
      err(res, 404, "Schedule not found.");
      return;
    }
    let systemPrompt: string | null = null;
    let systemPromptSource: "custom" | "builtin" = "builtin";
    try {
      if (schedule.agentType === "custom" && schedule.customAgentId) {
        const custom = customAgents.get(schedule.customAgentId) ?? null;
        if (custom && custom.systemPrompt.trim().length > 0) {
          systemPrompt = custom.systemPrompt;
          systemPromptSource = "custom";
        } else {
          systemPrompt = buildSystemPrompt(process.cwd(), {});
        }
      } else {
        systemPrompt = buildSystemPrompt(process.cwd(), {});
      }
    } catch {
      systemPrompt = null;
    }
    const messages = [{ role: "user", content: schedule.prompt }];
    let usage: Record<string, unknown> | null = null;
    try {
      usage = scheduler.lastContextUsage(id);
    } catch {
      usage = null;
    }
    res.json({
      ok: true,
      schedule_id: schedule.id,
      schedule_name: schedule.name,
      agent_type: schedule.agentType,
      provider: schedule.provider,
      model: schedule.model,
      systemPrompt,
      systemPromptSource,
      messages,
      source: "persisted",
      messageCount: messages.length,
      usage,
      fetchedAt: Date.now(),
    });
  });

  return router;
}

/** Re-exported so the preview endpoint shares the recurrence conversion. */
export { toRecurrence };
