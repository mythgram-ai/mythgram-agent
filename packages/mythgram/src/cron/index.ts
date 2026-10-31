/**
 * Schedule/Cron system — persistent background task scheduling.
 *
 * The scheduler lives entirely in the backend process: it loads all active
 * schedules at boot, fires due schedules through the EXISTING agent runtime
 * (Default Agent or a user Custom Agent), records every execution, and
 * recovers safely across restarts — with no browser open.
 *
 *   types      — schedule/run shapes + display status
 *   timezone   — Intl-based IANA timezone math (no new dependencies)
 *   cronparse  — 5-field cron parser + matcher + describer
 *   nextrun    — next-fire-time calculation for every recurrence kind
 *   store      — validation + SQLite persistence (schedules table)
 *   runner     — one execution via the existing AgentRunner/CustomAgentRunner
 *   scheduler  — background tick loop, boot recovery, duplicate guards
 */
export type {
  ScheduleAgentType,
  ScheduleConfig,
  ScheduleKind,
  ScheduleRun,
  ScheduleRunStatus,
  ScheduleStatus,
  ScheduleTrigger,
  ScheduleView,
  ScheduleWire,
} from "./types.js";
export { isTerminalSchedule, scheduleStatusOf } from "./types.js";
export { isValidTimezone, listTimezones, normalizeTimezone } from "./timezone.js";
export { describeCron, isValidCron, parseCron } from "./cronparse.js";
export { getNextOccurrences, getNextRun, parseWallTime } from "./nextrun.js";
export { ScheduleStore, validateScheduleInput } from "./store.js";
export { ScheduleRunner, SCHEDULE_RUN_OUTPUT_MAX, SCHEDULE_RUN_TIMEOUT_MS } from "./runner.js";
export { ScheduleScheduler, SCHEDULER_CATCH_UP_MS, SCHEDULER_TICK_MS } from "./scheduler.js";
