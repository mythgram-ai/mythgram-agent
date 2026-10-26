import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../../database/schema.js";
import { SchedulesRepo } from "../../database/repositories/schedulesRepo.js";
import { ScheduleRunsRepo } from "../../database/repositories/scheduleRunsRepo.js";
import { ScheduleStore } from "../../cron/store.js";
import { ToolRegistry } from "./registry.js";
import { scheduleOnTool } from "./schedule_on.js";
import { scheduleCreateTool } from "./schedule_create.js";
import { createScheduleRuntime } from "./scheduleRuntime.js";
import type { ToolContext } from "./types.js";

function makeStore(): ScheduleStore {
  const db = new Database(":memory:");
  applySchema(db);
  return new ScheduleStore(new SchedulesRepo(db), new ScheduleRunsRepo(db));
}

describe("schedule_on tool", () => {
  let registry: ToolRegistry;
  let store: ScheduleStore;

  before(() => {
    registry = new ToolRegistry().registerAll([scheduleOnTool, scheduleCreateTool]);
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

  async function createPaused(name: string): Promise<string> {
    const created = await registry.execute(
      "schedule_create",
      {
        schedule_name: name,
        task_prompt: "Do work.",
        cadence: "daily",
        time: "09:00",
        timezone: "UTC",
      },
      ctx(),
    );
    assert.equal(created.ok, true);
    const id = (created.data as { schedule_id: string }).schedule_id;
    assert.ok(store.setEnabled(id, false));
    return id;
  }

  it("is registered with schedule_id required", () => {
    assert.ok(registry.has("schedule_on"));
    const schema = registry.schemas.find((s) => s.function.name === "schedule_on");
    assert.ok(schema, "schedule_on must appear in the OpenAI tools array");
    const params = schema!.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    assert.ok(params.properties.schedule_id);
    assert.deepEqual(params.required, ["schedule_id"]);
  });

  it("turns a paused schedule back on with a recomputed next run", async () => {
    const id = await createPaused("Reactivatable");
    const result = await registry.execute("schedule_on", { schedule_id: id }, ctx());
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.schedule_id, id);
    assert.equal(data.status, "active");
    assert.ok(typeof data.next_run_at === "number");

    const view = store.getView(id);
    assert.ok(view?.enabled);
  });

  it("is idempotent when the schedule is already on", async () => {
    const id = await createPaused("Steady");
    await registry.execute("schedule_on", { schedule_id: id }, ctx());
    const again = await registry.execute("schedule_on", { schedule_id: id }, ctx());
    assert.equal(again.ok, true);
    assert.ok(String((again.data as { message: string }).message).includes("already on"));
  });

  it("returns schedule_not_found for an unknown id", async () => {
    const result = await registry.execute("schedule_on", { schedule_id: "missing-01" }, ctx());
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedule_not_found");
  });

  it("reports schedules_unavailable without a runtime", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("schedule_on", { schedule_id: "x" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedules_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(scheduleOnTool.label({ schedule_id: "abc" }), "Turn on schedule: abc");
  });
});
