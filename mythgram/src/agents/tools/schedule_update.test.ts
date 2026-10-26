import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../../database/schema.js";
import { SchedulesRepo } from "../../database/repositories/schedulesRepo.js";
import { ScheduleRunsRepo } from "../../database/repositories/scheduleRunsRepo.js";
import { ScheduleStore } from "../../cron/store.js";
import { ToolRegistry } from "./registry.js";
import { scheduleUpdateTool } from "./schedule_update.js";
import { scheduleCreateTool } from "./schedule_create.js";
import { createScheduleRuntime } from "./scheduleRuntime.js";
import type { ToolContext } from "./types.js";

function makeStore(): ScheduleStore {
  const db = new Database(":memory:");
  applySchema(db);
  return new ScheduleStore(new SchedulesRepo(db), new ScheduleRunsRepo(db));
}

describe("schedule_update tool", () => {
  let registry: ToolRegistry;
  let store: ScheduleStore;

  before(() => {
    registry = new ToolRegistry().registerAll([scheduleUpdateTool, scheduleCreateTool]);
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

  async function create(prompt: string): Promise<string> {
    const result = await registry.execute(
      "schedule_create",
      {
        schedule_name: "Editable",
        task_prompt: prompt,
        cadence: "daily",
        time: "09:00",
        timezone: "UTC",
      },
      ctx(),
    );
    assert.equal(result.ok, true);
    return (result.data as { schedule_id: string }).schedule_id;
  }

  it("is registered with schedule_id and prompt required", () => {
    assert.ok(registry.has("schedule_update"));
    const schema = registry.schemas.find((s) => s.function.name === "schedule_update");
    assert.ok(schema, "schedule_update must appear in the OpenAI tools array");
    const params = schema!.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    assert.ok(params.properties.schedule_id);
    assert.ok(params.properties.prompt);
    assert.deepEqual(params.required, ["schedule_id", "prompt"]);
  });

  it("updates the prompt without affecting the next run", async () => {
    const id = await create("Original prompt.");
    const before = store.getView(id);
    assert.ok(before);
    assert.ok(typeof before.nextRunAt === "number");

    const result = await registry.execute(
      "schedule_update",
      { schedule_id: id, prompt: "Revised prompt with new instructions." },
      ctx(),
    );
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.schedule_id, id);

    const after = store.getView(id);
    assert.ok(after);
    assert.equal(after.prompt, "Revised prompt with new instructions.");
    // Timing, cadence, and timezone are untouched.
    assert.equal(after.nextRunAt, before.nextRunAt);
    assert.equal(after.kind, before.kind);
    assert.equal(after.time, before.time);
    assert.equal(after.timezone, before.timezone);
    assert.equal((data.next_run_at as number), before.nextRunAt);
  });

  it("rejects an empty prompt", async () => {
    const id = await create("Keep me.");
    const result = await registry.execute(
      "schedule_update",
      { schedule_id: id, prompt: "   " },
      ctx(),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "prompt_required");
    assert.equal(store.get(id)?.prompt, "Keep me.");
  });

  it("returns schedule_not_found for an unknown id", async () => {
    const result = await registry.execute(
      "schedule_update",
      { schedule_id: "nope-not-real-01", prompt: "New prompt." },
      ctx(),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedule_not_found");
  });

  it("rejects malformed arguments via schema validation", async () => {
    const result = await registry.execute("schedule_update", { schedule_id: "x" }, ctx());
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("reports schedules_unavailable without a runtime", async () => {
    const ctx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute(
      "schedule_update",
      { schedule_id: "x", prompt: "y" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "schedules_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      scheduleUpdateTool.label({ schedule_id: "abc123", prompt: "Do work." }),
      "Update schedule: abc123",
    );
  });
});
