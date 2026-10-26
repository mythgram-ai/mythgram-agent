import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../../database/schema.js";
import { SchedulesRepo } from "../../database/repositories/schedulesRepo.js";
import { ScheduleRunsRepo } from "../../database/repositories/scheduleRunsRepo.js";
import { ScheduleStore } from "../../cron/store.js";
import type { ScheduleScheduler } from "../../cron/scheduler.js";
import { ToolRegistry } from "./registry.js";
import { scheduleRunNowTool } from "./schedule_run_now.js";
import { scheduleCreateTool } from "./schedule_create.js";
import { createScheduleRuntime } from "./scheduleRuntime.js";
import type { ToolContext } from "./types.js";

function makeStore(): ScheduleStore {
  const db = new Database(":memory:");
  applySchema(db);
  return new ScheduleStore(new SchedulesRepo(db), new ScheduleRunsRepo(db));
}

describe("schedule_run_now tool", () => {
  let registry: ToolRegistry;
  let store: ScheduleStore;
  let ranIds: string[];

  before(() => {
    registry = new ToolRegistry().registerAll([scheduleRunNowTool, scheduleCreateTool]);
    store = makeStore();
    ranIds = [];
  });

  function fakeScheduler(result: string | null): ScheduleScheduler {
    return {
      runNow: async (id: string) => {
        ranIds.push(id);
        return result;
      },
    } as unknown as ScheduleScheduler;
  }

  function ctx(scheduler: ScheduleScheduler | null): ToolContext {
    return {
      workspaceRoot: "/workspace",
      shellTimeoutMs: 10_000,
      schedules: createScheduleRuntime({
        store,
        scheduler,
        agent: { type: "default", provider: "openrouter", model: "m" },
      }),
    };
  }

  async function create(name: string): Promise<string> {
    const result = await registry.execute(
      "schedule_create",
      {
        schedule_name: name,
        task_prompt: "Do work.",
        cadence: "daily",
        time: "09:00",
        timezone: "UTC",
      },
      ctx(fakeScheduler("run-id-never-used")),
    );
    assert.equal(result.ok, true);
    return (result.data as { schedule_id: string }).schedule_id;
  }

  it("is registered with schedule_id required", () => {
    assert.ok(registry.has("schedule_run_now"));
    const schema = registry.schemas.find((s) => s.function.name === "schedule_run_now");
    assert.ok(schema, "schedule_run_now must appear in the OpenAI tools array");
    const params = schema!.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    assert.ok(params.properties.schedule_id);
    assert.deepEqual(params.required, ["schedule_id"]);
  });

  it("executes the schedule immediately and returns the run id", async () => {
    const id = await create("Urgent");
    const result = await registry.execute(
      "schedule_run_now",
      { schedule_id: id },
      ctx(fakeScheduler("runAb12Cd34Ef")),
    );
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.schedule_id, id);
    assert.equal(data.run_id, "runAb12Cd34Ef");
    assert.deepEqual(ranIds.slice(-1), [id]);
  });

  it("reports schedule_busy when the scheduler cannot run it", async () => {
    const id = await create("Busy");
    const result = await registry.execute(
      "schedule_run_now",
      { schedule_id: id },
      ctx(fakeScheduler(null)),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedule_busy");
  });

  it("reports scheduler_unavailable without a scheduler", async () => {
    const id = await create("No runner");
    const result = await registry.execute("schedule_run_now", { schedule_id: id }, ctx(null));
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "scheduler_unavailable");
  });

  it("returns schedule_not_found for an unknown id", async () => {
    const result = await registry.execute(
      "schedule_run_now",
      { schedule_id: "missing-01" },
      ctx(fakeScheduler("run-id")),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedule_not_found");
  });

  it("reports schedules_unavailable without a runtime", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("schedule_run_now", { schedule_id: "x" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedules_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(scheduleRunNowTool.label({ schedule_id: "abc" }), "Run schedule now: abc");
  });
});
