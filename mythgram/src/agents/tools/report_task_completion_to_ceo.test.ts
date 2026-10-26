import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { reportTaskCompletionToCeoTool } from "./report_task_completion_to_ceo.js";
import type { ToolContext, TeamRuntime, TeamDeliveryResult } from "./types.js";

function fakeTeam(overrides: Partial<TeamRuntime> = {}): TeamRuntime {
  const calls: string[] = [];
  const team: TeamRuntime = {
    selfId: "Elio",
    isLeader: true,
    leaderId: "Elio",
    sendMessageToTeamEnabled: false,
    listMembers: () => [],
    status: () => [],
    deliver: () => ({ ok: true, delivered: [], unknown: [], message: "sent" }),
    inCeoMode: true,
    ceoId: "Vera",
    reportToCeo: (summary: string): TeamDeliveryResult => {
      calls.push(summary);
      return { ok: true, delivered: ["Vera"], unknown: [], message: "sent" };
    },
    ...overrides,
  };
  (team as unknown as { _calls: string[] })._calls = calls;
  return team;
}

function ctxFor(team?: TeamRuntime): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, team };
}

describe("report_task_completion_to_ceo tool", () => {
  let registry: ToolRegistry;
  before(() => {
    registry = new ToolRegistry().registerAll([reportTaskCompletionToCeoTool]);
  });

  it("requires summary", () => {
    const schema = registry.schemas.find((s) => s.function.name === "report_task_completion_to_ceo");
    assert.ok(schema);
    assert.deepEqual(schema!.function.parameters.required, ["summary"]);
    assert.equal(schema!.function.parameters.additionalProperties, false);
  });

  it("delivers the completion summary to the CEO", async () => {
    const team = fakeTeam();
    const result = await registry.execute(
      "report_task_completion_to_ceo",
      { summary: "Dashboard shipped: built UI + API, tests pass." },
      ctxFor(team),
    );
    assert.equal(result.ok, true);
    const data = result.data as { from: string; to: string };
    assert.equal(data.from, "Elio");
    assert.equal(data.to, "Vera");
    const calls = (team as unknown as { _calls: string[] })._calls;
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /Dashboard shipped/);
  });

  it("rejects when not in a team", async () => {
    const result = await registry.execute(
      "report_task_completion_to_ceo",
      { summary: "done" },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_in_team");
  });

  it("rejects when the team is not operating under a CEO", async () => {
    const result = await registry.execute(
      "report_task_completion_to_ceo",
      { summary: "done" },
      ctxFor(fakeTeam({ inCeoMode: false, reportToCeo: undefined, ceoId: undefined })),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_in_ceo_mode");
  });

  it("rejects a member (only the team leader reports to the CEO)", async () => {
    const result = await registry.execute(
      "report_task_completion_to_ceo",
      { summary: "done" },
      ctxFor(fakeTeam({ isLeader: false, selfId: "Arlo" })),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "leader_only");
  });
});
