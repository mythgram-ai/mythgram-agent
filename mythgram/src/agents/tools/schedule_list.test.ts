import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../../database/schema.js";
import { SchedulesRepo } from "../../database/repositories/schedulesRepo.js";
import { ScheduleRunsRepo } from "../../database/repositories/scheduleRunsRepo.js";
import { ScheduleStore } from "../../cron/store.js";
import { ToolRegistry } from "./registry.js";
import { scheduleListTool } from "./schedule_list.js";
import { scheduleCreateTool } from "./schedule_create.js";
import { createScheduleRuntime } from "./scheduleRuntime.js";
import type { ToolContext } from "./types.js";

function makeStore(): ScheduleStore {
  const db = new Database(":memory:");
  applySchema(db);
  return new ScheduleStore(new SchedulesRepo(db), new ScheduleRunsRepo(db));
}

describe("schedule_list tool", () => {
  let registry: ToolRegistry;
  let store: ScheduleStore;

  before(() => {
    registry = new ToolRegistry().registerAll([scheduleListTool, scheduleCreateTool]);
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

  it("is registered with an optional status filter", () => {
    assert.ok(registry.has("schedule_list"));
    const schema = registry.schemas.find((s) => s.function.name === "schedule_list");
    assert.ok(schema, "schedule_list must appear in the OpenAI tools array");
    const params = schema!.function.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    assert.ok(params.properties.status, "status property must be declared");
    assert.ok(!params.required || params.required.length === 0, "status must be optional");
  });

  it("lists an empty store and points at schedule_create", async () => {
    const result = await registry.execute("schedule_list", {}, ctx());
    assert.equal(result.ok, true);
    const data = result.data as { status: string; count: number; schedules: unknown[]; message: string };
    assert.equal(data.status, "all");
    assert.equal(data.count, 0);
    assert.deepEqual(data.schedules, []);
    assert.ok(data.message.includes("schedule_create"));
  });

  it("filters by active, paused, and all", async () => {
    const first = await create("Active one");
    const second = await create("To pause");
    assert.notEqual(first, second);

    // Pause the second schedule directly through the store.
    const paused = store.setEnabled(second, false);
    assert.ok(paused);

    const active = await registry.execute("schedule_list", { status: "active" }, ctx());
    assert.equal(active.ok, true);
    const activeIds = ((active.data as { schedules: Array<{ schedule_id: string }> }).schedules).map(
      (s) => s.schedule_id,
    );
    assert.ok(activeIds.includes(first));
    assert.ok(!activeIds.includes(second));

    const pausedList = await registry.execute("schedule_list", { status: "paused" }, ctx());
    assert.equal(pausedList.ok, true);
    const pausedIds = (
      (pausedList.data as { schedules: Array<{ schedule_id: string }> }).schedules
    ).map((s) => s.schedule_id);
    assert.ok(pausedIds.includes(second));
    assert.ok(!pausedIds.includes(first));

    const all = await registry.execute("schedule_list", { status: "all" }, ctx());
    assert.equal(all.ok, true);
    assert.ok(((all.data as { count: number }).count) >= 2);
  });

  it("returns each schedule id so the other tools can use it", async () => {
    const result = await registry.execute("schedule_list", {}, ctx());
    assert.equal(result.ok, true);
    for (const row of (result.data as { schedules: Array<Record<string, unknown>> }).schedules) {
      assert.ok(typeof row.schedule_id === "string" && (row.schedule_id as string).length > 0);
      assert.ok(typeof row.schedule_name === "string");
      assert.ok(typeof row.status === "string");
      assert.ok(typeof row.cadence === "string");
    }
  });

  it("rejects an unknown status via schema validation", async () => {
    const result = await registry.execute("schedule_list", { status: "snoozed" }, ctx());
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("reports schedules_unavailable without a runtime", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("schedule_list", {}, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedules_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(scheduleListTool.label({}), "List schedules");
  });
});
