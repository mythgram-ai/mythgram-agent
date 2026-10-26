import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { messageTeamLeaderTool } from "./message_team_leader.js";
import type { ToolContext, TeamRuntime } from "./types.js";

function fakeTeam(overrides: Partial<TeamRuntime> = {}): TeamRuntime {
  const calls: Array<{ agent_id: string; message: string }> = [];
  const team: TeamRuntime = {
    selfId: "Niko",
    isLeader: false,
    leaderId: "Elio",
    sendMessageToTeamEnabled: false,
    listMembers: () => [],
    status: () => [],
    deliver: (messages) => {
      calls.push(...messages);
      return { ok: true, delivered: messages.map((m) => m.agent_id), unknown: [], message: "sent" };
    },
    ...overrides,
  };
  (team as unknown as { _calls: typeof calls })._calls = calls;
  return team;
}

function ctxFor(team?: TeamRuntime): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, team };
}

describe("message_team_leader tool", () => {
  let registry: ToolRegistry;
  before(() => {
    registry = new ToolRegistry().registerAll([messageTeamLeaderTool]);
  });

  it("requires my_name and message", () => {
    const schema = registry.schemas.find((s) => s.function.name === "message_team_leader");
    assert.ok(schema);
    assert.deepEqual(schema!.function.parameters.required, ["my_name", "message"]);
  });

  it("delivers the report to the leader, framed with the caller id", async () => {
    const team = fakeTeam();
    const result = await registry.execute(
      "message_team_leader",
      { my_name: "Niko", message: "Design complete, see index.html" },
      ctxFor(team),
    );
    assert.equal(result.ok, true);
    const data = result.data as { from: string; to: string };
    assert.equal(data.from, "Niko");
    assert.equal(data.to, "Elio");
    const calls = (team as unknown as { _calls: Array<{ agent_id: string; message: string }> })._calls;
    assert.equal(calls[0]!.agent_id, "Elio");
    assert.match(calls[0]!.message, /From team member "Niko"/);
    assert.match(calls[0]!.message, /Design complete/);
  });

  it("rejects the leader calling it", async () => {
    const result = await registry.execute(
      "message_team_leader",
      { my_name: "Elio", message: "hi" },
      ctxFor(fakeTeam({ isLeader: true, selfId: "Elio" })),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "members_only");
  });

  it("rejects when not in a team", async () => {
    const result = await registry.execute(
      "message_team_leader",
      { my_name: "Niko", message: "hi" },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_in_team");
  });
});
