/**
 * ScheduleStore — validation, normalization, and persistence for schedules.
 *
 * Schedules live in the application's SQLite database (`schedules` table,
 * same database + repository pattern as every other entity). This store is the
 * single place that turns untrusted wire payloads into well-formed configs,
 * computes `nextRunAt` on every save, and serves typed configs to the
 * scheduler, the runner, and the API router.
 */

import type { SchedulesRepo, ScheduleRecord } from "../database/repositories/schedulesRepo.js";
import type { ScheduleRunsRepo } from "../database/repositories/scheduleRunsRepo.js";
import { createScheduleId } from "../database/index.js";
import { getNextRun, parseWallTime, type RecurrenceInput } from "./nextrun.js";
import { isValidCron } from "./cronparse.js";
import { normalizeTimezone } from "./timezone.js";
import {
  scheduleStatusOf,
  type ScheduleAgentType,
  type ScheduleConfig,
  type ScheduleKind,
  type ScheduleView,
  type ScheduleWire,
} from "./types.js";

const NAME_MAX = 100;
const PROMPT_MAX = 20_000;
const KIND_VALUES: readonly ScheduleKind[] = ["once", "interval", "daily", "weekly", "monthly", "cron"];

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "yes" || value === "on" || value === 1) return true;
  if (value === false || value === "no" || value === "off" || value === 0) return false;
  return fallback;
}

/** Result of validating a wire payload: either a clean draft or an error message. */
export interface ValidatedSchedule {
  draft?: ScheduleDraft;
  error?: string;
}

/** A fully normalized schedule draft (no ids/timestamps — the store adds those). */
export interface ScheduleDraft {
  name: string;
  prompt: string;
  agentType: ScheduleAgentType;
  customAgentId: string | null;
  provider: string;
  model: string;
  kind: ScheduleKind;
  cron: string;
  intervalMinutes: number | null;
  time: string | null;
  weekdays: number[];
  dayOfMonth: number | null;
  runAt: number | null;
  startAt: number | null;
  endAt: number | null;
  timezone: string;
  enabled: boolean;
}

function first<T>(...values: Array<T | undefined>): T | undefined {
  for (const v of values) {
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Validate + normalize an untrusted create/update payload. `isUpdate` allows
 * partial payloads (only the provided fields are validated); creation requires
 * the recurrence fields of the chosen kind.
 */
export function validateScheduleInput(raw: unknown, isUpdate: boolean): ValidatedSchedule {
  if (!raw || typeof raw !== "object") {
    return { error: "A schedule payload is required." };
  }
  const r = raw as ScheduleWire;
  const need = (field: string): boolean => !isUpdate;

  const draft: ScheduleDraft = {
    name: "",
    prompt: "",
    agentType: "default",
    customAgentId: null,
    provider: "",
    model: "",
    kind: "once",
    cron: "",
    intervalMinutes: null,
    time: null,
    weekdays: [],
    dayOfMonth: null,
    runAt: null,
    startAt: null,
    endAt: null,
    timezone: "UTC",
    enabled: true,
  };

  // Name.
  if (r.name !== undefined || need("name")) {
    const name = str(r.name).trim();
    if (!name) return { error: "A schedule name is required." };
    if (name.length > NAME_MAX) return { error: `The schedule name must be ${NAME_MAX} characters or fewer.` };
    draft.name = name;
  }

  // Prompt.
  if (r.prompt !== undefined || need("prompt")) {
    const prompt = str(r.prompt).trim();
    if (!prompt) return { error: "A task prompt is required — describe what the agent should do." };
    if (prompt.length > PROMPT_MAX) {
      return { error: `The task prompt must be ${PROMPT_MAX} characters or fewer.` };
    }
    draft.prompt = prompt;
  }

  // Agent selection: "default" (built-in Default Agent) or "custom" + id.
  if (r.agentType !== undefined || r.agent_type !== undefined) {
    const rawType = str(first(r.agentType, r.agent_type)).trim().toLowerCase();
    if (rawType !== "default" && rawType !== "custom") {
      return { error: `Unknown agent type "${rawType}". Expected "default" or "custom".` };
    }
    draft.agentType = rawType;
  }
  if (r.customAgentId !== undefined || r.custom_agent_id !== undefined) {
    const id = str(first(r.customAgentId, r.custom_agent_id)).trim();
    draft.customAgentId = id.length > 0 ? id : null;
  }
  if (draft.agentType === "custom" && !draft.customAgentId && need("agent")) {
    return { error: "A Custom Agent must be selected when the agent type is \"custom\"." };
  }

  // Provider/model snapshot (may be empty — resolved from Settings at run time).
  if (r.provider !== undefined) draft.provider = str(r.provider).trim();
  if (r.model !== undefined) draft.model = str(r.model).trim();

  // Kind.
  if (r.kind !== undefined || need("kind")) {
    const kind = str(r.kind).trim().toLowerCase();
    if (!(KIND_VALUES as readonly string[]).includes(kind)) {
      return { error: `Unknown schedule kind "${kind}". Expected one of: ${KIND_VALUES.join(", ")}.` };
    }
    draft.kind = kind as ScheduleKind;
  }

  // Timezone (always normalized; invalid degrades to UTC).
  if (r.timezone !== undefined) draft.timezone = normalizeTimezone(r.timezone);

  // Kind-specific recurrence fields.
  const kind = draft.kind;
  if (kind === "once" || r.runAt !== undefined || r.run_at !== undefined || r.date !== undefined) {
    const runAt = num(first(r.runAt, r.run_at, r.date));
    if (runAt !== null) draft.runAt = Math.floor(runAt);
    else if (need("kind") && kind === "once") {
      return { error: "A date and time is required for a one-time schedule." };
    }
  }
  if (kind === "cron" || r.cron !== undefined) {
    const cron = str(r.cron).trim();
    if (cron) {
      if (!isValidCron(cron)) {
        return { error: `Invalid cron expression "${cron}". Expected 5 fields: minute hour day-of-month month day-of-week.` };
      }
      draft.cron = cron.replace(/\s+/g, " ");
    } else if (need("kind") && kind === "cron") {
      return { error: "A cron expression is required for a custom-cron schedule." };
    }
  }
  if (kind === "interval" || r.intervalMinutes !== undefined || r.interval_minutes !== undefined) {
    let minutes = num(first(r.intervalMinutes, r.interval_minutes));
    // The setup UI sends everyValue + everyUnit ("minutes" | "hours" | "days").
    if (minutes === null && (r.everyValue !== undefined || r.every_value !== undefined)) {
      const value = num(first(r.everyValue, r.every_value));
      const unit = str(first(r.everyUnit, r.every_unit)).trim().toLowerCase();
      if (value !== null) {
        const factor = unit === "hours" ? 60 : unit === "days" ? 1440 : 1;
        minutes = Math.floor(value) * factor;
      }
    }
    if (minutes !== null) {
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 525_600) {
        return { error: "The interval must be between 1 minute and 1 year (525,600 minutes)." };
      }
      draft.intervalMinutes = minutes;
    } else if (need("kind") && kind === "interval") {
      return { error: "An interval (every X minutes/hours/days) is required." };
    }
  }
  if (kind === "daily" || kind === "weekly" || kind === "monthly" || r.time !== undefined) {
    const time = str(r.time).trim();
    if (time) {
      if (!parseWallTime(time)) return { error: `Invalid time "${time}". Expected HH:MM (24-hour).` };
      const wall = parseWallTime(time)!;
      draft.time = `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`;
    } else if (need("kind") && (kind === "daily" || kind === "weekly" || kind === "monthly")) {
      return { error: "A time of day (HH:MM) is required." };
    }
  }
  if (kind === "weekly" || r.weekdays !== undefined) {
    const rawDays = Array.isArray(r.weekdays) ? r.weekdays : [];
    const days = [...new Set(
      rawDays
        .map((d) => (typeof d === "string" && d.trim() !== "" ? Number(d) : d))
        .filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6),
    )].sort((a, b) => a - b);
    if (days.length > 0) draft.weekdays = days;
    else if (need("kind") && kind === "weekly") {
      return { error: "Pick at least one weekday for a weekly schedule." };
    }
  }
  if (kind === "monthly" || r.dayOfMonth !== undefined || r.day_of_month !== undefined) {
    const dom = num(first(r.dayOfMonth, r.day_of_month));
    if (dom !== null) {
      if (!Number.isInteger(dom) || dom < 1 || dom > 31) {
        return { error: "The day of month must be between 1 and 31." };
      }
      draft.dayOfMonth = dom;
    } else if (need("kind") && kind === "monthly") {
      return { error: "A day of month (1-31) is required for a monthly schedule." };
    }
  }

  // Optional window.
  const startRaw = first(r.startAt, r.start_at, r.startDate, r.start_date);
  if (startRaw !== undefined && startRaw !== null) {
    const startAt = num(startRaw);
    if (startAt === null) return { error: "Invalid start date." };
    draft.startAt = Math.floor(startAt);
  } else if (isUpdate && startRaw === null) {
    draft.startAt = null;
  }
  const endRaw = first(r.endAt, r.end_at, r.endDate, r.end_date);
  if (endRaw !== undefined && endRaw !== null) {
    const endAt = num(endRaw);
    if (endAt === null) return { error: "Invalid end date." };
    draft.endAt = Math.floor(endAt);
  } else if (isUpdate && endRaw === null) {
    draft.endAt = null;
  }
  if (draft.startAt !== null && draft.endAt !== null && draft.endAt <= draft.startAt) {
    return { error: "The end date must be after the start date." };
  }

  // Enabled flag.
  if (r.enabled !== undefined) draft.enabled = bool(r.enabled, true);

  return { draft };
}

/** Turn a DB row into a typed config. */
export function rowToConfig(row: {
  id: string;
  name: string;
  prompt: string;
  agentType: string;
  customAgentId: string | null;
  provider: string;
  model: string;
  kind: string;
  cron: string;
  intervalMinutes: number | null;
  time: string | null;
  weekdays: string;
  dayOfMonth: number | null;
  runAt: number | null;
  startAt: number | null;
  endAt: number | null;
  timezone: string;
  enabled: boolean;
  running: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  runCount: number;
  createdAt: number;
  updatedAt: number;
}): ScheduleConfig {
  let weekdays: number[] = [];
  try {
    const parsed: unknown = JSON.parse(row.weekdays || "[]");
    if (Array.isArray(parsed)) {
      weekdays = parsed.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6);
    }
  } catch {
    weekdays = [];
  }
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    agentType: row.agentType === "custom" ? "custom" : "default",
    customAgentId: row.customAgentId,
    provider: row.provider,
    model: row.model,
    kind: (KIND_VALUES as readonly string[]).includes(row.kind) ? (row.kind as ScheduleConfig["kind"]) : "once",
    cron: row.cron,
    intervalMinutes: row.intervalMinutes,
    time: row.time,
    weekdays,
    dayOfMonth: row.dayOfMonth,
    runAt: row.runAt,
    startAt: row.startAt,
    endAt: row.endAt,
    timezone: row.timezone,
    enabled: row.enabled,
    running: row.running,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    lastStatus: row.lastStatus === "failed" || row.lastStatus === "completed" ? row.lastStatus : null,
    lastError: row.lastError,
    runCount: row.runCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A ScheduleConfig as recurrence input for the next-run calculator. */
export function toRecurrence(config: ScheduleConfig): RecurrenceInput {
  return {
    kind: config.kind,
    cron: config.cron,
    intervalMinutes: config.intervalMinutes,
    time: config.time,
    weekdays: config.weekdays,
    dayOfMonth: config.dayOfMonth,
    runAt: config.runAt,
    startAt: config.startAt,
    endAt: config.endAt,
    timezone: config.timezone,
  };
}

/**
 * ScheduleStore — CRUD over the `schedules` table with validation and
 * next-run maintenance. All writes recompute `nextRunAt` so the scheduler
 * tick is a cheap indexed range scan.
 */
export class ScheduleStore {
  constructor(
    private readonly schedules: SchedulesRepo,
    private readonly runs: ScheduleRunsRepo,
  ) {}

  list(): ScheduleConfig[] {
    return this.schedules.list().map(rowToConfig);
  }

  listViews(): ScheduleView[] {
    return this.list().map((config) => ({ ...config, status: scheduleStatusOf(config) }));
  }

  get(id: string): ScheduleConfig | null {
    if (!id) return null;
    const row = this.schedules.get(id);
    return row ? rowToConfig(row) : null;
  }

  getView(id: string): ScheduleView | null {
    const config = this.get(id);
    return config ? { ...config, status: scheduleStatusOf(config) } : null;
  }

  /** Create a schedule from an untrusted payload. Throws on validation errors. */
  create(raw: unknown, now = Date.now()): ScheduleConfig {
    const { draft, error } = validateScheduleInput(raw, false);
    if (!draft || error) throw new Error(error ?? "Invalid schedule.");
    // Fill creation-only defaults for update-style partial drafts.
    const full = applyUpdateDefaults(draft);
    const record = this.toRecord(full, {
      id: createScheduleId(),
      createdAt: now,
      runCount: 0,
      running: false,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
    });
    record.nextRunAt = record.enabled ? getNextRun(toRecurrence(rowToConfig(record as ScheduleRowLike)), now) : null;
    this.schedules.save(record);
    const saved = this.schedules.get(record.id);
    if (!saved) throw new Error("The schedule could not be saved.");
    return rowToConfig(saved);
  }

  /** Update a schedule by id from a partial untrusted payload. Returns null when missing. */
  update(id: string, raw: unknown, now = Date.now()): ScheduleConfig | null {
    const existing = this.get(id);
    if (!existing) return null;
    const { draft, error } = validateScheduleInput(raw, true);
    if (error) throw new Error(error);
    // Merge: only fields present in the payload change (detect via the raw object).
    const body = (raw ?? {}) as Record<string, unknown>;
    const has = (camel: string, snake?: string): boolean =>
      body[camel] !== undefined || (snake !== undefined && body[snake] !== undefined);
    const merged: ScheduleDraft = {
      name: has("name") && draft!.name ? draft!.name : existing.name,
      prompt: has("prompt") && draft!.prompt ? draft!.prompt : existing.prompt,
      agentType: has("agentType", "agent_type") ? draft!.agentType : existing.agentType,
      customAgentId: has("customAgentId", "custom_agent_id") ? draft!.customAgentId : existing.customAgentId,
      provider: has("provider") ? draft!.provider : existing.provider,
      model: has("model") ? draft!.model : existing.model,
      kind: has("kind") ? draft!.kind : existing.kind,
      cron: has("cron") ? draft!.cron : existing.cron,
      intervalMinutes: has("intervalMinutes", "interval_minutes") || has("everyValue", "every_value")
        ? draft!.intervalMinutes
        : existing.intervalMinutes,
      time: has("time") ? draft!.time : existing.time,
      weekdays: has("weekdays") ? draft!.weekdays : existing.weekdays,
      dayOfMonth: has("dayOfMonth", "day_of_month") ? draft!.dayOfMonth : existing.dayOfMonth,
      runAt: has("runAt", "run_at") || has("date") ? draft!.runAt : existing.runAt,
      startAt: has("startAt", "start_at") || has("startDate", "start_date") ? draft!.startAt : existing.startAt,
      endAt: has("endAt", "end_at") || has("endDate", "end_date") ? draft!.endAt : existing.endAt,
      timezone: has("timezone") ? draft!.timezone : existing.timezone,
      enabled: has("enabled") ? draft!.enabled : existing.enabled,
    };
    // Re-validate the merged whole (update-mode skips required checks, so do a full check here).
    const { draft: full, error: fullError } = validateScheduleInput({ ...merged, enabled: merged.enabled }, false);
    if (!full || fullError) throw new Error(fullError ?? "Invalid schedule.");
    if (full.agentType === "custom" && !full.customAgentId) {
      throw new Error("A Custom Agent must be selected when the agent type is \"custom\".");
    }
    const record = this.toRecord(full, {
      id: existing.id,
      createdAt: existing.createdAt,
      runCount: existing.runCount,
      running: existing.running,
      lastRunAt: existing.lastRunAt,
      lastStatus: existing.lastStatus,
      lastError: existing.lastError,
    });
    record.nextRunAt = record.enabled ? getNextRun(toRecurrence(rowToConfig(record as ScheduleRowLike)), now) : null;
    this.schedules.save(record);
    const updated = this.schedules.get(id);
    return updated ? rowToConfig(updated) : null;
  }

  /**
   * Update only the task prompt of a schedule, preserving everything else — timing, cadence,
   * timezone, windows, and in particular the computed `nextRunAt`, which is carried over
   * untouched so a prompt edit never shifts the next run. Returns null when missing.
   * Throws on an empty or oversized prompt.
   */
  updatePrompt(id: string, prompt: string): ScheduleConfig | null {
    const existing = this.get(id);
    if (!existing) return null;
    const clean = prompt.trim();
    if (!clean) throw new Error("A task prompt is required — describe what the agent should do.");
    if (clean.length > PROMPT_MAX) {
      throw new Error(`The task prompt must be ${PROMPT_MAX} characters or fewer.`);
    }
    const record = this.toRecord({ ...existing, prompt: clean }, {
      id: existing.id,
      createdAt: existing.createdAt,
      runCount: existing.runCount,
      running: existing.running,
      lastRunAt: existing.lastRunAt,
      lastStatus: existing.lastStatus,
      lastError: existing.lastError,
    });
    // Preserve the computed next run: a prompt-only edit must not affect timing.
    record.nextRunAt = existing.nextRunAt;
    this.schedules.save(record);
    const saved = this.schedules.get(id);
    return saved ? rowToConfig(saved) : null;
  }

  /**
   * Post-run bookkeeping: bump the run count, record the outcome, advance (or
   * clear) the next run, and auto-disable one-time / expired schedules.
   * Called by the scheduler after every finished execution.
   */  applyRunResult(
    id: string,
    result: { ok: boolean; error?: string | null; startedAt: number; finishedAt: number },
    now = Date.now(),
  ): ScheduleConfig | null {
    const existing = this.get(id);
    if (!existing) return null;
    const finishedOnce = existing.kind === "once";
    const expired = existing.endAt !== null && now > existing.endAt;
    const enabled = !finishedOnce && !expired && existing.enabled;
    const record = this.toRecord({ ...existing, enabled }, {
      id: existing.id,
      createdAt: existing.createdAt,
      runCount: existing.runCount + 1,
      running: false,
      lastRunAt: result.finishedAt,
      lastStatus: result.ok ? "completed" : "failed",
      lastError: result.ok ? null : (result.error ?? "Unknown error"),
    });
    record.nextRunAt = enabled ? getNextRun(toRecurrence(rowToConfig(record as ScheduleRowLike)), now) : null;
    this.schedules.save(record);
    const saved = this.schedules.get(id);
    return saved ? rowToConfig(saved) : null;
  }

  /** Delete a schedule and its execution history. Returns true when removed. */
  delete(id: string): boolean {
    const existing = this.schedules.get(id);
    if (!existing) return false;
    this.runs.transaction(() => {
      this.runs.deleteByScheduleId(id);
      this.schedules.delete(id);
    });
    return true;
  }

  /**
   * Recompute and persist `nextRunAt` from the stored recurrence (used by boot
   * recovery to repair stale rows). Returns the recomputed value.
   */
  refreshNextRun(id: string, now = Date.now()): number | null {
    const row = this.schedules.get(id);
    if (!row) return null;
    const config = rowToConfig(row);
    const next = config.enabled ? getNextRun(toRecurrence(config), now) : null;
    const record = this.toRecord({ ...config }, {
      id: config.id,
      createdAt: config.createdAt,
      runCount: config.runCount,
      running: config.running,
      lastRunAt: config.lastRunAt,
      lastStatus: config.lastStatus,
      lastError: config.lastError,
    });
    record.nextRunAt = next;
    this.schedules.save(record);
    return next;
  }

  /** Duplicate a schedule: same config under a new id, starting paused (safe default). */
  duplicate(id: string, now = Date.now()): ScheduleConfig | null {
    const existing = this.get(id);
    if (!existing) return null;
    const record = this.toRecord(
      {
        name: `${existing.name} (copy)`.slice(0, 100),
        prompt: existing.prompt,
        agentType: existing.agentType,
        customAgentId: existing.customAgentId,
        provider: existing.provider,
        model: existing.model,
        kind: existing.kind,
        cron: existing.cron,
        intervalMinutes: existing.intervalMinutes,
        time: existing.time,
        weekdays: existing.weekdays,
        dayOfMonth: existing.dayOfMonth,
        runAt: existing.kind === "once" ? null : existing.runAt,
        startAt: existing.startAt,
        endAt: existing.endAt,
        timezone: existing.timezone,
        enabled: false,
      },
      {
        id: createScheduleId(),
        createdAt: now,
        runCount: 0,
        running: false,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
      },
    );
    // A duplicated one-time schedule has no fire time — keep it paused until edited.
    // Recurring copies compute their next run but stay paused until enabled.
    record.nextRunAt = null;
    this.schedules.save(record);
    const saved = this.schedules.get(record.id);
    return saved ? rowToConfig(saved) : null;
  }

  /** Flip the enabled flag (pausing clears the computed next run). */
  setEnabled(id: string, enabled: boolean, now = Date.now()): ScheduleConfig | null {    const existing = this.get(id);
    if (!existing) return null;
    const record = this.toRecord({ ...existing, enabled }, {
      id: existing.id,
      createdAt: existing.createdAt,
      runCount: existing.runCount,
      running: existing.running,
      lastRunAt: existing.lastRunAt,
      lastStatus: existing.lastStatus,
      lastError: existing.lastError,
    });
    record.nextRunAt = enabled ? getNextRun(toRecurrence(rowToConfig(record as ScheduleRowLike)), now) : null;
    this.schedules.save(record);
    const saved = this.schedules.get(id);
    return saved ? rowToConfig(saved) : null;
  }

  private toRecord(
    draft: ScheduleDraft,
    meta: {
      id: string;
      createdAt: number;
      runCount: number;
      running: boolean;
      lastRunAt: number | null;
      lastStatus: "completed" | "failed" | null;
      lastError: string | null;
    },
  ): ScheduleRecord {
    const now = Date.now();
    return {
      id: meta.id,
      name: draft.name,
      prompt: draft.prompt,
      agentType: draft.agentType,
      customAgentId: draft.agentType === "custom" ? draft.customAgentId : null,
      provider: draft.provider,
      model: draft.model,
      kind: draft.kind,
      cron: draft.cron,
      intervalMinutes: draft.intervalMinutes,
      time: draft.time,
      weekdays: JSON.stringify(draft.weekdays),
      dayOfMonth: draft.dayOfMonth,
      runAt: draft.runAt,
      startAt: draft.startAt,
      endAt: draft.endAt,
      timezone: draft.timezone,
      enabled: draft.enabled,
      running: meta.running,
      lastRunAt: meta.lastRunAt,
      nextRunAt: null,
      lastStatus: meta.lastStatus,
      lastError: meta.lastError,
      runCount: meta.runCount,
      createdAt: meta.createdAt,
      updatedAt: now,
    };
  }
}

type ScheduleRowLike = Parameters<typeof rowToConfig>[0];

/**
 * Fill kind-required fields of a creation draft validated in non-update mode.
 * (validateScheduleInput with isUpdate=false already enforces them — this is
 * the type-level guarantee that every field the record needs is present.)
 */
function applyUpdateDefaults(draft: ScheduleDraft): ScheduleDraft {
  return draft;
}
