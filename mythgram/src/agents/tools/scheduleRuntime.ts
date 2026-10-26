import type {
  ScheduleAgentIdentity,
  ScheduleCreateInput,
  ScheduleRuntime,
  ToolResult,
} from "./types.js";
import type { ScheduleStore } from "../../cron/store.js";
import type { ScheduleScheduler } from "../../cron/scheduler.js";
import { isValidTimezone, zonedToUtc } from "../../cron/timezone.js";
import { isValidCron } from "../../cron/cronparse.js";
import { parseWallTime } from "../../cron/nextrun.js";
import type { ScheduleView } from "../../cron/types.js";

/** Maximum task-prompt length accepted by schedule_create / schedule_update (mirrors the store). */
export const SCHEDULE_PROMPT_MAX = 20_000;

/** Weekday names accepted by schedule_create mapped to cron weekday numbers (0-6, Sun-Sat). */
export const SCHEDULE_WEEKDAYS: Readonly<Record<string, number>> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export interface ScheduleRuntimeDeps {
  /** The persistent schedule store (SQLite). Absent in contexts without schedule access. */
  store?: ScheduleStore | null;
  /** The background scheduler (needed only for schedule_run_now). */
  scheduler?: ScheduleScheduler | null;
  /** The agent identity schedules created through this runtime will run as. */
  agent: ScheduleAgentIdentity;
}

/**
 * Build the ScheduleRuntime bound to a single agent turn. Returns undefined when no store is
 * available, in which case the schedule_* tools report the system as unavailable.
 */
export function createScheduleRuntime(deps: ScheduleRuntimeDeps): ScheduleRuntime | undefined {
  if (!deps.store) return undefined;
  const runner = new ScheduleRunner(deps.store, deps.scheduler ?? null, deps.agent);
  return {
    agent: deps.agent,
    list: (status) => runner.list(status),
    get: (id) => runner.get(id),
    create: (input) => runner.create(input),
    updatePrompt: (id, prompt) => runner.updatePrompt(id, prompt),
    setEnabled: (id, enabled) => runner.setEnabled(id, enabled),
    remove: (id) => runner.remove(id),
    runNow: (id) => runner.runNow(id),
  };
}

/** Shared guard: the schedule runtime is only present when the backend schedule system is wired. */
export function requireSchedules(ctx: {
  schedules?: ScheduleRuntime;
}): ToolResult | null {
  if (!ctx.schedules) {
    return {
      ok: false,
      error: {
        code: "schedules_unavailable",
        message:
          "The schedule tools are not available in this context (the background schedule " +
          "system is not configured).",
      },
    };
  }
  return null;
}

class ScheduleRunner {
  constructor(
    private readonly store: ScheduleStore,
    private readonly scheduler: ScheduleScheduler | null,
    private readonly agent: ScheduleAgentIdentity,
  ) {}

  list(status: "active" | "paused" | "all"): ToolResult {
    const views = this.store.listViews();
    const filtered =
      status === "all"
        ? views
        : status === "active"
          ? views.filter((v) => v.status === "active" || v.status === "running")
          : views.filter((v) => v.status === "paused");
    return {
      ok: true,
      data: {
        status,
        count: filtered.length,
        schedules: filtered.map(summarize),
        message:
          filtered.length === 0
            ? `No ${status === "all" ? "" : `${status} `}schedules exist. Create one with schedule_create.`
            : `${filtered.length} schedule(s) with status "${status}". Use schedule_get with a schedule_id for full details.`,
      },
    };
  }

  get(rawId: string): ToolResult {
    const id = rawId.trim();
    if (!id) {
      return {
        ok: false,
        error: { code: "schedule_id_required", message: "A schedule_id is required." },
      };
    }
    const view = this.store.getView(id);
    if (!view) return notFound(id, this.store);
    return { ok: true, data: describe(view) };
  }

  create(input: ScheduleCreateInput): ToolResult {
    const name = input.scheduleName.trim();
    if (!name) {
      return {
        ok: false,
        error: { code: "schedule_name_required", message: "A schedule_name is required." },
      };
    }
    const prompt = input.taskPrompt.trim();
    if (!prompt) {
      return {
        ok: false,
        error: { code: "task_prompt_required", message: "A task_prompt is required." },
      };
    }
    if (prompt.length > SCHEDULE_PROMPT_MAX) {
      return {
        ok: false,
        error: {
          code: "task_prompt_too_long",
          message: `The task prompt must be ${SCHEDULE_PROMPT_MAX} characters or fewer.`,
        },
      };
    }
    const timezone = input.timezone.trim();
    if (!isValidTimezone(timezone)) {
      return {
        ok: false,
        error: {
          code: "invalid_timezone",
          message: `Unknown timezone "${input.timezone}". Use a valid IANA timezone such as Asia/Calcutta or UTC.`,
        },
      };
    }

    const recurrence = buildRecurrence(input, timezone);
    if (!recurrence.ok) return recurrence;
    const { kind, fields } = recurrence;

    const window = buildWindow(input, timezone);
    if (!window.ok) return window;

    try {
      const created = this.store.create({
        name,
        prompt,
        agentType: this.agent.type,
        customAgentId: this.agent.type === "custom" ? (this.agent.customAgentId ?? null) : null,
        provider: this.agent.provider,
        model: this.agent.model,
        kind,
        ...fields,
        timezone,
        ...(window.startAt !== undefined ? { startAt: window.startAt } : {}),
        ...(window.endAt !== undefined ? { endAt: window.endAt } : {}),
        enabled: true,
      });
      const view = this.store.getView(created.id);
      return {
        ok: true,
        data: {
          ...(view ? describe(view) : { schedule_id: created.id, schedule_name: name }),
          message:
            `Schedule "${name}" created and activated. It runs as the ` +
            `${this.agent.type === "custom" ? "active Custom Agent" : "Default Agent"}.`,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "schedule_create_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  updatePrompt(rawId: string, rawPrompt: string): ToolResult {
    const id = rawId.trim();
    if (!id) {
      return {
        ok: false,
        error: { code: "schedule_id_required", message: "A schedule_id is required." },
      };
    }
    const prompt = rawPrompt.trim();
    if (!prompt) {
      return {
        ok: false,
        error: {
          code: "prompt_required",
          message: "A non-empty prompt is required — describe what the agent should execute.",
        },
      };
    }
    if (prompt.length > SCHEDULE_PROMPT_MAX) {
      return {
        ok: false,
        error: {
          code: "prompt_too_long",
          message: `The prompt must be ${SCHEDULE_PROMPT_MAX} characters or fewer.`,
        },
      };
    }
    try {
      const updated = this.store.updatePrompt(id, prompt);
      if (!updated) return notFound(id, this.store);
      const view = this.store.getView(id);
      return {
        ok: true,
        data: {
          schedule_id: updated.id,
          schedule_name: updated.name,
          status: view?.status ?? "unknown",
          next_run_at: view?.nextRunAt ?? null,
          message:
            `Schedule "${updated.name}" now runs the new prompt. Timing, cadence, timezone, ` +
            "and other settings are unchanged — the next run is unaffected.",
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "schedule_update_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  setEnabled(rawId: string, enabled: boolean): ToolResult {
    const id = rawId.trim();
    if (!id) {
      return {
        ok: false,
        error: { code: "schedule_id_required", message: "A schedule_id is required." },
      };
    }
    const current = this.store.getView(id);
    if (!current) return notFound(id, this.store);
    if (current.enabled === enabled) {
      return {
        ok: true,
        data: {
          schedule_id: current.id,
          schedule_name: current.name,
          status: current.status,
          next_run_at: current.nextRunAt,
          message: `Schedule "${current.name}" is already ${enabled ? "on" : "off"}.`,
        },
      };
    }
    const updated = this.store.setEnabled(id, enabled);
    if (!updated) return notFound(id, this.store);
    const view = this.store.getView(id);
    const finishedOnce = updated.kind === "once" && updated.runCount > 0;
    return {
      ok: true,
      data: {
        schedule_id: updated.id,
        schedule_name: updated.name,
        status: view?.status ?? "unknown",
        next_run_at: view?.nextRunAt ?? null,
        message: enabled
          ? finishedOnce
            ? `Schedule "${updated.name}" is on, but it is a one-time schedule that already ran — it will not fire again.`
            : `Schedule "${updated.name}" is on and will run as scheduled.`
          : `Schedule "${updated.name}" is off (paused) and will not run until turned on again.`,
      },
    };
  }

  remove(rawId: string): ToolResult {
    const id = rawId.trim();
    if (!id) {
      return {
        ok: false,
        error: { code: "schedule_id_required", message: "A schedule_id is required." },
      };
    }
    const current = this.store.get(id);
    if (!current) return notFound(id, this.store);
    const name = current.name;
    this.store.delete(id);
    return {
      ok: true,
      data: {
        schedule_id: id,
        deleted: true,
        message: `Schedule "${name}" deleted permanently. It will not run again.`,
      },
    };
  }

  async runNow(rawId: string): Promise<ToolResult> {
    const id = rawId.trim();
    if (!id) {
      return {
        ok: false,
        error: { code: "schedule_id_required", message: "A schedule_id is required." },
      };
    }
    const current = this.store.get(id);
    if (!current) return notFound(id, this.store);
    if (!this.scheduler) {
      return {
        ok: false,
        error: {
          code: "scheduler_unavailable",
          message: "The background scheduler is not running, so the schedule cannot run now.",
        },
      };
    }
    const runId = await this.scheduler.runNow(id);
    if (!runId) {
      return {
        ok: false,
        error: {
          code: "schedule_busy",
          message:
            `Schedule "${current.name}" cannot run right now (it is already running, or it is ` +
            "a completed one-time schedule).",
        },
      };
    }
    return {
      ok: true,
      data: {
        schedule_id: id,
        schedule_name: current.name,
        run_id: runId,
        message:
          `Schedule "${current.name}" started running in the background (run ${runId}). It ` +
          "executes independently — continue with your work and check the execution history " +
          "later for the outcome.",
      },
    };
  }
}

// ---- Recurrence mapping -----------------------------------------------------

type RecurrenceFailure = { ok: false; error: { code: string; message: string } };

type RecurrenceResult =
  | { ok: true; kind: "once" | "interval" | "daily" | "weekly" | "monthly" | "cron"; fields: Record<string, unknown> }
  | RecurrenceFailure;

/** Map the tool's cadence + fields onto the store's recurrence kinds, validating per cadence. */
function buildRecurrence(input: ScheduleCreateInput, timezone: string): RecurrenceResult {
  switch (input.cadence) {
    case "one_time": {
      if (!input.date?.trim() || !input.time?.trim()) {
        return {
          ok: false,
          error: {
            code: "date_time_required",
            message: 'A one_time schedule requires both "date" (YYYY-MM-DD) and "time" (HH:MM).',
          },
        };
      }
      const runAt = dateTimeToUtc(input.date, input.time, timezone);
      if (runAt === null) {
        return {
          ok: false,
          error: {
            code: "invalid_date_time",
            message: `Invalid date/time "${input.date} ${input.time}". Use YYYY-MM-DD and HH:MM (24-hour).`,
          },
        };
      }
      if (runAt <= Date.now()) {
        return {
          ok: false,
          error: {
            code: "date_in_past",
            message: "A one_time schedule must be in the future.",
          },
        };
      }
      return { ok: true, kind: "once", fields: { runAt } };
    }
    case "every_x": {
      if (input.interval === undefined || !input.intervalUnit) {
        return {
          ok: false,
          error: {
            code: "interval_required",
            message: 'An every_x schedule requires both "interval" and "interval_unit" (minutes, hours, or days).',
          },
        };
      }
      if (!Number.isInteger(input.interval) || input.interval < 1) {
        return {
          ok: false,
          error: {
            code: "invalid_interval",
            message: "The interval must be a whole number of 1 or more.",
          },
        };
      }
      const factor = input.intervalUnit === "hours" ? 60 : input.intervalUnit === "days" ? 1440 : 1;
      const intervalMinutes = Math.floor(input.interval) * factor;
      if (intervalMinutes < 1 || intervalMinutes > 525_600) {
        return {
          ok: false,
          error: {
            code: "invalid_interval",
            message: "The interval must be between 1 minute and 1 year (525,600 minutes).",
          },
        };
      }
      return { ok: true, kind: "interval", fields: { intervalMinutes } };
    }
    case "daily": {
      if (!input.time?.trim()) {
        return {
          ok: false,
          error: {
            code: "time_required",
            message: 'A daily schedule requires "time" (HH:MM, 24-hour).',
          },
        };
      }
      const wall = parseWallTime(input.time);
      if (!wall) {
        return {
          ok: false,
          error: {
            code: "invalid_time",
            message: `Invalid time "${input.time}". Use HH:MM (24-hour).`,
          },
        };
      }
      return { ok: true, kind: "daily", fields: { time: toTime(wall) } };
    }
    case "weekly": {
      if (!input.time?.trim()) {
        return {
          ok: false,
          error: {
            code: "time_required",
            message: 'A weekly schedule requires "time" (HH:MM, 24-hour).',
          },
        };
      }
      const wall = parseWallTime(input.time);
      if (!wall) {
        return {
          ok: false,
          error: {
            code: "invalid_time",
            message: `Invalid time "${input.time}". Use HH:MM (24-hour).`,
          },
        };
      }
      if (!input.weekdays || input.weekdays.length === 0) {
        return {
          ok: false,
          error: {
            code: "weekdays_required",
            message: "A weekly schedule requires at least one weekday.",
          },
        };
      }
      const days: number[] = [];
      for (const raw of input.weekdays) {
        const day = SCHEDULE_WEEKDAYS[raw.trim().toLowerCase()];
        if (day === undefined) {
          return {
            ok: false,
            error: {
              code: "invalid_weekday",
              message:
                `Unknown weekday "${raw}". Use monday, tuesday, wednesday, thursday, friday, ` +
                "saturday, or sunday.",
            },
          };
        }
        if (!days.includes(day)) days.push(day);
      }
      days.sort((a, b) => a - b);
      return { ok: true, kind: "weekly", fields: { time: toTime(wall), weekdays: days } };
    }
    case "monthly": {
      if (!input.time?.trim()) {
        return {
          ok: false,
          error: {
            code: "time_required",
            message: 'A monthly schedule requires "time" (HH:MM, 24-hour).',
          },
        };
      }
      const wall = parseWallTime(input.time);
      if (!wall) {
        return {
          ok: false,
          error: {
            code: "invalid_time",
            message: `Invalid time "${input.time}". Use HH:MM (24-hour).`,
          },
        };
      }
      if (input.dayOfMonth === undefined) {
        return {
          ok: false,
          error: {
            code: "day_of_month_required",
            message: "A monthly schedule requires day_of_month (1-31).",
          },
        };
      }
      return { ok: true, kind: "monthly", fields: { time: toTime(wall), dayOfMonth: input.dayOfMonth } };
    }
    case "custom_cron": {
      const expression = input.cronExpression?.trim() ?? "";
      if (!expression) {
        return {
          ok: false,
          error: {
            code: "cron_required",
            message: "A custom_cron schedule requires cron_expression (5 fields).",
          },
        };
      }
      if (!isValidCron(expression)) {
        return {
          ok: false,
          error: {
            code: "invalid_cron",
            message:
              `Invalid cron expression "${expression}". Expected 5 fields: ` +
              "minute hour day-of-month month day-of-week.",
          },
        };
      }
      return { ok: true, kind: "cron", fields: { cron: expression.replace(/\s+/g, " ") } };
    }
    default:
      return {
        ok: false,
        error: {
          code: "invalid_cadence",
          message:
            `Unknown cadence "${(input as { cadence: unknown }).cadence}". Expected one of: ` +
            "one_time, every_x, daily, weekly, monthly, custom_cron.",
        },
      };
  }
}

type WindowResult = { ok: true; startAt?: number; endAt?: number } | RecurrenceFailure;

/** Optional active window (start/end dates) as UTC epoch-ms midnights in the schedule timezone. */
function buildWindow(input: ScheduleCreateInput, timezone: string): WindowResult {
  let startAt: number | undefined;
  let endAt: number | undefined;
  if (input.startDate?.trim()) {
    const parsed = dateTimeToUtc(input.startDate, "00:00", timezone);
    if (parsed === null) {
      return {
        ok: false,
        error: {
          code: "invalid_start_date",
          message: `Invalid start_date "${input.startDate}". Use YYYY-MM-DD.`,
        },
      };
    }
    startAt = parsed;
  }
  if (input.endDate?.trim()) {
    const parsed = dateTimeToUtc(input.endDate, "00:00", timezone);
    if (parsed === null) {
      return {
        ok: false,
        error: {
          code: "invalid_end_date",
          message: `Invalid end_date "${input.endDate}". Use YYYY-MM-DD.`,
        },
      };
    }
    endAt = parsed;
  }
  if (startAt !== undefined && endAt !== undefined && endAt <= startAt) {
    return {
      ok: false,
      error: {
        code: "invalid_window",
        message: "The end date must be after the start date.",
      },
    };
  }
  return { ok: true, startAt, endAt };
}

/** Parse YYYY-MM-DD plus HH:MM into a UTC epoch-ms instant in the given timezone. */
function dateTimeToUtc(dateRaw: string, timeRaw: string, timezone: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateRaw.trim());
  const wall = parseWallTime(timeRaw);
  if (!dateMatch || !wall) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return zonedToUtc({ year, month, day, hour: wall.hour, minute: wall.minute }, timezone);
}

function toTime(wall: { hour: number; minute: number }): string {
  return `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
}

// ---- View shaping -----------------------------------------------------------

const CADENCE_BY_KIND: Record<string, string> = {
  once: "one_time",
  interval: "every_x",
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
  cron: "custom_cron",
};

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Compact row for schedule_list. */
function summarize(view: ScheduleView): Record<string, unknown> {
  return {
    schedule_id: view.id,
    schedule_name: view.name,
    status: view.status,
    cadence: CADENCE_BY_KIND[view.kind] ?? view.kind,
    next_run_at: view.nextRunAt,
    last_run_at: view.lastRunAt,
    last_status: view.lastStatus,
    timezone: view.timezone,
  };
}

/** Full details for schedule_get / schedule_create. */
function describe(view: ScheduleView): Record<string, unknown> {
  return {
    schedule_id: view.id,
    schedule_name: view.name,
    task_prompt: view.prompt,
    cadence: CADENCE_BY_KIND[view.kind] ?? view.kind,
    status: view.status,
    enabled: view.enabled,
    timezone: view.timezone,
    next_run_at: view.nextRunAt,
    last_run_at: view.lastRunAt,
    last_status: view.lastStatus,
    last_error: view.lastError,
    run_count: view.runCount,
    ...(view.kind === "once" && view.runAt !== null ? { date: toDate(view.runAt, view.timezone), time: toClock(view.runAt, view.timezone) } : {}),
    ...(view.kind === "interval" && view.intervalMinutes !== null
      ? splitInterval(view.intervalMinutes)
      : {}),
    ...(view.time !== null && view.kind !== "once" && view.kind !== "interval" && view.kind !== "cron"
      ? { time: view.time }
      : {}),
    ...(view.kind === "weekly" ? { weekdays: view.weekdays.map((d) => WEEKDAY_NAMES[d] ?? String(d)) } : {}),
    ...(view.kind === "monthly" && view.dayOfMonth !== null ? { day_of_month: view.dayOfMonth } : {}),
    ...(view.kind === "cron" && view.cron ? { cron_expression: view.cron } : {}),
    ...(view.startAt !== null ? { start_date: toDate(view.startAt, view.timezone) } : {}),
    ...(view.endAt !== null ? { end_date: toDate(view.endAt, view.timezone) } : {}),
    agent_type: view.agentType,
    provider: view.provider,
    model: view.model,
    created_at: view.createdAt,
    updated_at: view.updatedAt,
  };
}

/** "YYYY-MM-DD" of a UTC instant in the schedule timezone. */
function toDate(utcMs: number, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    const d = new Date(utcMs);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
}

/** "HH:MM" of a UTC instant in the schedule timezone. */
function toClock(utcMs: number, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(utcMs))
      .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    return `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
  } catch {
    const d = new Date(utcMs);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
}

/** Split stored interval minutes back into a value + largest exact unit. */
function splitInterval(totalMinutes: number): { interval: number; interval_unit: string } {
  if (totalMinutes % 1440 === 0) return { interval: totalMinutes / 1440, interval_unit: "days" };
  if (totalMinutes % 60 === 0) return { interval: totalMinutes / 60, interval_unit: "hours" };
  return { interval: totalMinutes, interval_unit: "minutes" };
}

/** A structured "schedule not found" error listing what IS available. */
function notFound(id: string, store: ScheduleStore): ToolResult {
  const available = store
    .listViews()
    .slice(0, 20)
    .map((v) => v.id);
  return {
    ok: false,
    error: {
      code: "schedule_not_found",
      message:
        `No schedule with id "${id}" exists. Call schedule_list to see the exact ` +
        "available ids, then retry with one of them.",
      ...(available.length > 0 ? { available_ids: available } : {}),
    },
  };
}
