import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { assignTasksToTeamsTool } from "./assign_tasks_to_teams.js";
import type { ToolContext, CeoRuntime, TeamDeliveryResult, CeoTeamInfo } from "./types.js";

function fakeCeo(overrides: Partial<CeoRuntime> = {}): CeoRuntime {
  const calls: Array<{ team_leader: string; prompt: string }> = [];
  const ceo: CeoRuntime = {
    selfId: "Vera",
    listTeams: (): CeoTeamInfo[] => [],
    assignTasks: (tasks): TeamDeliveryResult => {
      calls.push(...tasks);
      return {
        ok: true,
        delivered: tasks.map((t) => t.team_leader),
        unknown: [],
        message: "sent",
      };
    },
    ...overrides,
  };
  (ceo as unknown as { _calls: typeof calls })._calls = calls;
  return ceo;
}

function ctxFor(ceo?: CeoRuntime): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, ceo };
}

describe("assign_tasks_to_teams tool", () => {
  let registry: ToolRegistry;
  before(() => {
    registry = new ToolRegistry().registerAll([assignTasksToTeamsTool]);
  });

  it("requires a non-empty tasks array with team_leader + prompt", () => {
    const schema = registry.schemas.find((s) => s.function.name === "assign_tasks_to_teams");
    assert.ok(schema);
    assert.deepEqual(schema!.function.parameters.required, ["tasks"]);
  });

  it("assigns tasks to multiple team leaders in one call", async () => {
    const ceo = fakeCeo();
    const result = await registry.execute(
      "assign_tasks_to_teams",
      {
        tasks: [
          { team_leader: "frontend_leader", prompt: "Build the dashboard UI." },
          { team_leader: "backend_leader", prompt: "Build the dashboard API." },
        ],
      },
      ctxFor(ceo),
    );
    assert.equal(result.ok, true);
    const data = result.data as { delivered: string[] };
    assert.deepEqual(data.delivered, ["frontend_leader", "backend_leader"]);
    const calls = (ceo as unknown as { _calls: Array<{ team_leader: string }> })._calls;
    assert.equal(calls.length, 2);
  });

  it("rejects when not the CEO", async () => {
    const result = await registry.execute(
      "assign_tasks_to_teams",
      { tasks: [{ team_leader: "x", prompt: "y" }] },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_ceo");
  });

  it("surfaces a delivery failure (all unknown leaders)", async () => {
    const ceo = fakeCeo({
      assignTasks: () => ({
        ok: false,
        delivered: [],
        unknown: ["ghost"],
        message: "none",
        error: { code: "no_valid_targets", message: "No matching team leader for: ghost." },
      }),
    });
    const result = await registry.execute(
      "assign_tasks_to_teams",
      { tasks: [{ team_leader: "ghost", prompt: "y" }] },
      ctxFor(ceo),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "no_valid_targets");
  });
});
