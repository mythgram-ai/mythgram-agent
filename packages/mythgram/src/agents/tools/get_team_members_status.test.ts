import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { getTeamMembersStatusTool } from "./get_team_members_status.js";
import type { ToolContext, TeamRuntime, TeamMemberStatus } from "./types.js";

function fakeTeam(overrides: Partial<TeamRuntime> = {}): TeamRuntime {
  return {
    selfId: "Elio",
    isLeader: true,
    leaderId: "Elio",
    sendMessageToTeamEnabled: false,
    listMembers: () => [],
    status: (ids): TeamMemberStatus[] =>
      ids
        .filter((id) => id === "Niko")
        .map((id) => ({
          agent_id: id,
          role: "member",
          description: "designer",
          status: "working",
          queued_messages: 2,
        })),
    deliver: () => ({ ok: true, delivered: [], unknown: [], message: "" }),
    ...overrides,
  };
}

function ctxFor(team?: TeamRuntime): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, team };
}

describe("get_team_members_status tool", () => {
  let registry: ToolRegistry;
  before(() => {
    registry = new ToolRegistry().registerAll([getTeamMembersStatusTool]);
  });

  it("exposes an agent_ids array schema", () => {
    const schema = registry.schemas.find((s) => s.function.name === "get_team_members_status");
    assert.ok(schema);
    const props = schema!.function.parameters.properties as Record<string, any>;
    assert.equal(props.agent_ids.type, "array");
    assert.deepEqual(schema!.function.parameters.required, ["agent_ids"]);
  });

  it("returns statuses for known agents and reports unknown ones", async () => {
    const result = await registry.execute(
      "get_team_members_status",
      { agent_ids: ["Niko", "Ghost"] },
      ctxFor(fakeTeam()),
    );
    assert.equal(result.ok, true);
    const data = result.data as { statuses: TeamMemberStatus[]; unknown: string[] };
    assert.equal(data.statuses.length, 1);
    assert.equal(data.statuses[0]!.status, "working");
    assert.deepEqual(data.unknown, ["Ghost"]);
  });

  it("rejects a non-leader", async () => {
    const result = await registry.execute(
      "get_team_members_status",
      { agent_ids: ["Niko"] },
      ctxFor(fakeTeam({ isLeader: false })),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "leader_only");
  });

  it("rejects when not in a team", async () => {
    const result = await registry.execute("get_team_members_status", { agent_ids: ["Niko"] }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_in_team");
  });
});
