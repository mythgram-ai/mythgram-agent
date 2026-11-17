---
name: automation-and-schedule
description: "Create and manage background schedules and recurring or one-time agent tasks using the schedule tools. Use when the user asks to schedule a task, set a reminder, run something daily/weekly/hourly or on a cron, or to pause, resume, run now, update, or delete schedules."
---

# Automation and Schedule

## Mission
Turn a user's automation request into a working background schedule, verify it was created correctly, and manage its lifecycle. Scheduled tasks run as a real agent in the background — never describe a schedule as created unless a tool confirmed it.

## Important
The main system prompt does not document these tools. Follow this skill for the exact schemas and workflow.

Availability: the schedule tools require the background schedule system to be configured. If a tool returns `schedules_unavailable`, explain that the system is not configured in this context.

## The eight tools

All use strict schemas — pass only documented fields. Results follow `{ok, data?, error?}`.

### schedule_create(...)
Create and activate a background schedule. It runs as the agent active in this turn (Default Agent or the active Custom Agent).
Required fields:
- `schedule_name` (string): a short human-readable name.
- `task_prompt` (string): the instructions the agent executes on every run (max 20,000 chars).
- `cadence` (enum): `one_time`, `every_x`, `daily`, `weekly`, `monthly`, `custom_cron`.
- `timezone` (string): an IANA timezone, e.g. `Asia/Calcutta`, `UTC`, `America/New_York`.

Cadence-specific fields:
- `one_time`: `date` (`YYYY-MM-DD`) and `time` (`HH:MM`), both in the schedule's timezone, in the future.
- `every_x`: `interval` (integer) and `interval_unit` (`minutes`, `hours`, `days`). Range: 1–525,600 minutes (one year).
- `daily`: `time` (`HH:MM`).
- `weekly`: `weekdays` (array of `monday`…`sunday`) and `time`.
- `monthly`: `day_of_month` (1–31) and `time`.
- `custom_cron`: `cron_expression` (5 fields) and `timezone`.

Optional window: `start_date` and `end_date` (`YYYY-MM-DD`). End must be after start.

Returns the full schedule description including `schedule_id`, `status`, `next_run_at`, and a confirmation message. Save the `schedule_id` for later calls.

### schedule_list(status?)
List schedules. `status` is optional: `active` (includes running), `paused`, or `all` (default). Returns `count` and `schedules[]` with `schedule_id`, `schedule_name`, `status`, `cadence`, `next_run_at`, `last_run_at`, `last_status`, `timezone`.

### schedule_get(schedule_id)
Get complete details of one schedule. `schedule_id` is required. A wrong id returns `schedule_not_found` with a list of valid ids.

### schedule_update(schedule_id, prompt)
Change ONLY the task prompt of an existing schedule. `schedule_id` and `prompt` are required. Timing, cadence, timezone, and other settings cannot be changed through tools — the user must edit those in the Schedules page. Updating the prompt does not affect the next run.

### schedule_on(schedule_id)
Turn on a paused schedule; its next run is recomputed. A completed one-time schedule cannot be made to fire again.

### schedule_off(schedule_id)
Pause an active schedule. Its next run is cleared; it can be resumed later with `schedule_on`.

### schedule_run_now(schedule_id)
Run a task immediately without waiting for its next scheduled time. Returns right away with a `run_id` while execution continues in the background — do NOT wait for it or claim it finished. Check the execution history later for the outcome. Fails with `schedule_busy` if a run is already in progress.

### schedule_delete(schedule_id)
Permanently delete a schedule and all of its run history. Only when the user explicitly asks.

## Cron format
`custom_cron` uses 5 space-separated fields: `minute hour day-of-month month day-of-week`.
- Supports `*`, comma lists (`1,15,30`), ranges (`1-5`), steps (`*/15`, `0-30/5`), month names (`JAN`-`DEC`), and weekday names (`SUN`-`SAT`).
- `7` normalizes to Sunday (`0`). There is no seconds field and no `@daily`-style macros.
- Examples: `*/15 * * * *` (every 15 minutes), `0 9 * * 1-5` (9 AM weekdays), `30 2 1 * *` (2:30 AM on the 1st).

## Timezones and time
- All wall-clock fields (`date`, `time`, `start_date`, `end_date`) are interpreted in the schedule's IANA timezone. Stored timestamps are UTC.
- An invalid timezone returns `invalid_timezone`. If the user gives no timezone, ask, or use a clearly stated reasonable default rather than silently guessing.
- DST transitions are handled by the scheduler; next-run computation looks up to about a year ahead.

## Lifecycle and results
- Statuses: `active`, `running`, `paused`, `completed` (one-time finished), `failed`.
- Runs execute as a normal agent turn with the schedule prompt as the user message, using a dedicated ephemeral session. Timeouts are 30 minutes; output is capped at 50,000 characters.
- API keys are resolved from current Settings at run time, not snapshotted.
- Results are stored in the schedule's run history (Schedules page in the UI). There is no push/notification delivery of results — tell the user where to find them.
- A one-time schedule auto-disables after it runs; a schedule with an end date stops after that date.

## Workflow

1. Clarify what should run, when, in which timezone, and whether it is one-time or recurring. Ask only if a missing detail would change the schedule materially.
2. Choose the simplest cadence that expresses the intent (prefer `daily`/`weekly` over raw cron when possible).
3. Call `schedule_create` with all required fields for that cadence.
4. Confirm the returned `next_run_at` and repeat the schedule back to the user in plain language.
5. For changes, use `schedule_list`/`schedule_get` to find the id, then the appropriate tool. Only the prompt can be edited via tools.
6. Delete only on explicit user request.

## Caveats

- Never invent a `schedule_id` — discover it with `schedule_list` or `schedule_get`.
- `schedule_run_now` is fire-and-forget; do not report success or failure of the run itself until you inspect history.
- A task prompt should be self-contained: the scheduled run has no access to the current chat context, only the prompt you write.
- Only the prompt is editable with agent tools; users change timing in the UI. Say so if the user asks you to change a schedule's time.
- Keep prompts within 20,000 characters and names within 100 characters.
