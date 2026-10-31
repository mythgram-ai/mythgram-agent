import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../../database/schema.js";
import { SchedulesRepo } from "../../database/repositories/schedulesRepo.js";
import { ScheduleRunsRepo } from "../../database/repositories/scheduleRunsRepo.js";
import { ScheduleStore } from "../../cron/store.js";
import { ToolRegistry } from "./registry.js";
import { scheduleDeleteTool } from "./schedule_delete.js";
import { scheduleCreateTool } from "./schedule_create.js";
import { scheduleListTool } from "./schedule_list.js";
import { createScheduleRuntime } from "./scheduleRuntime.js";
import type { ToolContext } from "./types.js";

function makeStore(): ScheduleStore {
  const db = new Database(":memory:");
  applySchema(db);
  return new ScheduleStore(new SchedulesRepo(db), new ScheduleRunsRepo(db));
}

describe("schedule_delete tool", () => {
  let registry: ToolRegistry;
  let store: ScheduleStore;

  before(() => {
    registry = new ToolRegistry().registerAll([
      scheduleDeleteTool,
      scheduleCreateTool,
      scheduleListTool,
    ]);
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
      ctx(),
    );
    assert.equal(result.ok, true);
    return (result.data as { schedule_id: string }).schedule_id;
  }

  it("is registered with schedule_id required", () => {
    assert.ok(registry.has("schedule_delete"));
    const schema = registry.schemas.find((s) => s.function.name === "schedule_delete");
    assert.ok(schema, "schedule_delete must appear in the OpenAI tools array");
    const params = schema!.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    assert.ok(params.properties.schedule_id);
    assert.deepEqual(params.required, ["schedule_id"]);
  });

  it("permanently deletes a schedule so it disappears from the list", async () => {
    const id = await create("Temporary");
    const result = await registry.execute("schedule_delete", { schedule_id: id }, ctx());
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.schedule_id, id);
    assert.equal(data.deleted, true);

    assert.equal(store.get(id), null);
    const listed = await registry.execute("schedule_list", { status: "all" }, ctx());
    const ids = ((listed.data as { schedules: Array<{ schedule_id: string }> }).schedules).map(
      (s) => s.schedule_id,
    );
    assert.ok(!ids.includes(id));
  });

  it("returns schedule_not_found for an unknown id", async () => {
    const result = await registry.execute("schedule_delete", { schedule_id: "missing-01" }, ctx());
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedule_not_found");
  });

  it("reports schedules_unavailable without a runtime", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("schedule_delete", { schedule_id: "x" }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedules_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(scheduleDeleteTool.label({ schedule_id: "abc" }), "Delete schedule: abc");
  });
});
