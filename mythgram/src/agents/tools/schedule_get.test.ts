import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../../database/schema.js";
import { SchedulesRepo } from "../../database/repositories/schedulesRepo.js";
import { ScheduleRunsRepo } from "../../database/repositories/scheduleRunsRepo.js";
import { ScheduleStore } from "../../cron/store.js";
import { ToolRegistry } from "./registry.js";
import { scheduleGetTool } from "./schedule_get.js";
import { scheduleCreateTool } from "./schedule_create.js";
import { createScheduleRuntime } from "./scheduleRuntime.js";
import type { ToolContext } from "./types.js";

function makeStore(): ScheduleStore {
  const db = new Database(":memory:");
  applySchema(db);
  return new ScheduleStore(new SchedulesRepo(db), new ScheduleRunsRepo(db));
}

describe("schedule_get tool", () => {
  let registry: ToolRegistry;
  let store: ScheduleStore;

  before(() => {
    registry = new ToolRegistry().registerAll([scheduleGetTool, scheduleCreateTool]);
    store = makeStore();
  });

  function ctx(): ToolContext {
    return {
      workspaceRoot: "/workspace",
      shellTimeoutMs: 10_000,
      schedules: createScheduleRuntime({
        store,
        scheduler: null,
        agent: { type: "default", provider: "openrouter", model: "m" },
      }),
    };
  }

  it("is registered with schedule_id required", () => {
    assert.ok(registry.has("schedule_get"));
    const schema = registry.schemas.find((s) => s.function.name === "schedule_get");
    assert.ok(schema, "schedule_get must appear in the OpenAI tools array");
    const params = schema!.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    assert.ok(params.properties.schedule_id);
    assert.deepEqual(params.required, ["schedule_id"]);
  });

  it("returns complete details including the next run", async () => {
    const created = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Detailed",
        task_prompt: "Inspect me.",
        cadence: "weekly",
        time: "10:30",
        weekdays: ["wednesday"],
        timezone: "UTC",
      },
      ctx(),
    );
    assert.equal(created.ok, true);
    const id = (created.data as { schedule_id: string }).schedule_id;

    const result = await registry.execute("schedule_get", { schedule_id: id }, ctx());
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.schedule_id, id);
    assert.equal(data.schedule_name, "Detailed");
    assert.equal(data.task_prompt, "Inspect me.");
    assert.equal(data.cadence, "weekly");
    assert.equal(data.status, "active");
    assert.equal(data.enabled, true);
    assert.equal(data.time, "10:30");
    assert.deepEqual(data.weekdays, ["wednesday"]);
    assert.equal(data.timezone, "UTC");
    assert.ok(typeof data.next_run_at === "number" && (data.next_run_at as number) > Date.now());
    assert.equal(data.agent_type, "default");
  });

  it("returns schedule_not_found for an unknown id", async () => {
    const result = await registry.execute("schedule_get", { schedule_id: "missing-01" }, ctx());
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedule_not_found");
  });

  it("reports schedules_unavailable without a runtime", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("schedule_get", { schedule_id: "x" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedules_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(scheduleGetTool.label({ schedule_id: "abc" }), "Get schedule: abc");
  });
});
