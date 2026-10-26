import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../../database/schema.js";
import { SchedulesRepo } from "../../database/repositories/schedulesRepo.js";
import { ScheduleRunsRepo } from "../../database/repositories/scheduleRunsRepo.js";
import { ScheduleStore } from "../../cron/store.js";
import { ToolRegistry } from "./registry.js";
import { scheduleCreateTool } from "./schedule_create.js";
import { scheduleGetTool } from "./schedule_get.js";
import { createScheduleRuntime } from "./scheduleRuntime.js";
import type { ToolContext } from "./types.js";

function makeStore(): ScheduleStore {
  const db = new Database(":memory:");
  applySchema(db);
  return new ScheduleStore(new SchedulesRepo(db), new ScheduleRunsRepo(db));
}

describe("schedule_create tool", () => {
  let registry: ToolRegistry;
  let store: ScheduleStore;

  before(() => {
    registry = new ToolRegistry().registerAll([scheduleCreateTool, scheduleGetTool]);
    store = makeStore();
  });

  function ctxFor(agent?: { type: "default" | "custom"; customAgentId?: string | null }): ToolContext {
    return {
      workspaceRoot: "/workspace",
      shellTimeoutMs: 10_000,
      schedules: createScheduleRuntime({
        store,
        scheduler: null,
        agent: { type: "default", provider: "openrouter", model: "test-model", ...agent },
      }),
    };
  }

  it("is registered and selectable by the LLM alongside existing tools", () => {
    assert.ok(registry.has("schedule_create"));
    const schema = registry.schemas.find((s) => s.function.name === "schedule_create");
    assert.ok(schema, "schedule_create must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    const params = schema!.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    assert.equal(params.type, "object");
    for (const key of ["schedule_name", "task_prompt", "cadence", "timezone"]) {
      assert.ok(params.properties[key], `${key} property must be declared`);
    }
    assert.deepEqual(params.required, ["schedule_name", "task_prompt", "cadence", "timezone"]);
  });

  it("creates a daily schedule activated by default with a computed next run", async () => {
    const result = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Morning brief",
        task_prompt: "Summarize overnight events.",
        cadence: "daily",
        time: "09:00",
        timezone: "UTC",
      },
      ctxFor(),
    );
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.ok(typeof data.schedule_id === "string" && data.schedule_id.length > 0);
    assert.equal(data.schedule_name, "Morning brief");
    assert.equal(data.status, "active");
    assert.equal(data.enabled, true);
    assert.equal(data.cadence, "daily");
    assert.ok(typeof data.next_run_at === "number" && (data.next_run_at as number) > Date.now());
  });

  it("creates a one_time schedule from a future date and time", async () => {
    const result = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Launch",
        task_prompt: "Run the launch checklist.",
        cadence: "one_time",
        date: "2030-06-15",
        time: "12:30",
        timezone: "UTC",
      },
      ctxFor(),
    );
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.cadence, "one_time");
    assert.equal(data.date, "2030-06-15");
    assert.equal(data.time, "12:30");
    assert.ok(typeof data.next_run_at === "number");
  });

  it("creates an every_x schedule converting the unit to minutes", async () => {
    const result = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Heartbeat",
        task_prompt: "Ping the service.",
        cadence: "every_x",
        interval: 2,
        interval_unit: "hours",
        timezone: "UTC",
      },
      ctxFor(),
    );
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.interval, 2);
    assert.equal(data.interval_unit, "hours");
  });

  it("creates weekly and monthly and custom_cron schedules", async () => {
    const weekly = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Weekly sync",
        task_prompt: "Sync the board.",
        cadence: "weekly",
        time: "10:00",
        weekdays: ["monday", "friday"],
        timezone: "UTC",
      },
      ctxFor(),
    );
    assert.equal(weekly.ok, true);
    assert.deepEqual((weekly.data as Record<string, unknown>).weekdays, ["monday", "friday"]);

    const monthly = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Monthly report",
        task_prompt: "Build the report.",
        cadence: "monthly",
        time: "08:00",
        day_of_month: 1,
        timezone: "UTC",
      },
      ctxFor(),
    );
    assert.equal(monthly.ok, true);
    assert.equal((monthly.data as Record<string, unknown>).day_of_month, 1);

    const cron = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Cron job",
        task_prompt: "Do the thing.",
        cadence: "custom_cron",
        cron_expression: "0 9 * * 1-5",
        timezone: "Asia/Calcutta",
      },
      ctxFor(),
    );
    assert.equal(cron.ok, true);
    assert.equal((cron.data as Record<string, unknown>).cron_expression, "0 9 * * 1-5");
  });

  it("runs created schedules as the active agent (default or custom)", async () => {
    const custom = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Custom run",
        task_prompt: "Custom work.",
        cadence: "daily",
        time: "09:00",
        timezone: "UTC",
      },
      ctxFor({ type: "custom", customAgentId: "agent123456789012" }),
    );
    assert.equal(custom.ok, true);
    const data = custom.data as Record<string, unknown>;
    assert.equal(data.agent_type, "custom");
    assert.equal(data.provider, "openrouter");
    assert.equal(data.model, "test-model");

    const fetched = await registry.execute(
      "schedule_get",
      { schedule_id: data.schedule_id },
      ctxFor(),
    );
    assert.equal(fetched.ok, true);
    assert.equal((fetched.data as Record<string, unknown>).agent_type, "custom");
  });

  it("rejects a one_time schedule in the past", async () => {
    const result = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Past",
        task_prompt: "Too late.",
        cadence: "one_time",
        date: "2000-01-01",
        time: "00:00",
        timezone: "UTC",
      },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "date_in_past");
  });

  it("rejects missing cadence fields with clear errors", async () => {
    const daily = await registry.execute(
      "schedule_create",
      {
        schedule_name: "No time",
        task_prompt: "x",
        cadence: "daily",
        timezone: "UTC",
      },
      ctxFor(),
    );
    assert.equal(daily.ok, false);
    assert.equal((daily.error as { code: string }).code, "time_required");

    const weekly = await registry.execute(
      "schedule_create",
      {
        schedule_name: "No days",
        task_prompt: "x",
        cadence: "weekly",
        time: "09:00",
        timezone: "UTC",
      },
      ctxFor(),
    );
    assert.equal(weekly.ok, false);
    assert.equal((weekly.error as { code: string }).code, "weekdays_required");

    const every = await registry.execute(
      "schedule_create",
      {
        schedule_name: "No interval",
        task_prompt: "x",
        cadence: "every_x",
        timezone: "UTC",
      },
      ctxFor(),
    );
    assert.equal(every.ok, false);
    assert.equal((every.error as { code: string }).code, "interval_required");
  });

  it("rejects an unknown timezone and an invalid cron expression", async () => {
    const tz = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Bad tz",
        task_prompt: "x",
        cadence: "daily",
        time: "09:00",
        timezone: "Mars/Olympus",
      },
      ctxFor(),
    );
    assert.equal(tz.ok, false);
    assert.equal((tz.error as { code: string }).code, "invalid_timezone");

    const cron = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Bad cron",
        task_prompt: "x",
        cadence: "custom_cron",
        cron_expression: "bogus",
        timezone: "UTC",
      },
      ctxFor(),
    );
    assert.equal(cron.ok, false);
    assert.equal((cron.error as { code: string }).code, "invalid_cron");
  });

  it("rejects malformed arguments via schema validation", async () => {
    const missing = await registry.execute("schedule_create", {} as Record<string, unknown>, ctxFor());
    assert.equal(missing.ok, false);
    assert.equal((missing.error as { code: string }).code, "invalid_arguments");

    const badCadence = await registry.execute(
      "schedule_create",
      { schedule_name: "x", task_prompt: "y", cadence: "yearly", timezone: "UTC" },
      ctxFor(),
    );
    assert.equal(badCadence.ok, false);
    assert.equal((badCadence.error as { code: string }).code, "invalid_arguments");
  });

  it("reports schedules_unavailable without a runtime", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute(
      "schedule_create",
      { schedule_name: "x", task_prompt: "y", cadence: "daily", time: "09:00", timezone: "UTC" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedules_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      scheduleCreateTool.label({
        schedule_name: "Morning brief",
        task_prompt: "x",
        cadence: "daily",
        timezone: "UTC",
      }),
      "Create schedule: Morning brief",
    );
  });
});
