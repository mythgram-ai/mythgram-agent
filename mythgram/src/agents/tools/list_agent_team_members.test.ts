import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { listAgentTeamMembersTool } from "./list_agent_team_members.js";
import type { ToolContext, TeamRuntime, TeamMemberInfo } from "./types.js";

function fakeTeam(overrides: Partial<TeamRuntime> = {}): TeamRuntime {
  const members: TeamMemberInfo[] = [
    { agent_id: "Elio", role: "leader", description: "team head" },
    { agent_id: "Niko", role: "member", description: "designer" },
  ];
  return {
    selfId: "Niko",
    isLeader: false,
    leaderId: "Elio",
    sendMessageToTeamEnabled: false,
    listMembers: () => members,
    status: () => [],
    deliver: () => ({ ok: true, delivered: [], unknown: [], message: "" }),
    ...overrides,
  };
}

function ctxFor(team?: TeamRuntime): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, team };
}

describe("list_agent_team_members tool", () => {
  let registry: ToolRegistry;
  before(() => {
    registry = new ToolRegistry().registerAll([listAgentTeamMembersTool]);
  });

  it("is registered with an empty object schema", () => {
    const schema = registry.schemas.find((s) => s.function.name === "list_agent_team_members");
    assert.ok(schema);
    assert.equal(schema!.function.parameters.type, "object");
  });

  it("lists members with name/role/description", async () => {
    const result = await registry.execute("list_agent_team_members", {}, ctxFor(fakeTeam()));
    assert.equal(result.ok, true);
    const data = result.data as { count: number; members: TeamMemberInfo[]; leader: string; self: string };
    assert.equal(data.count, 2);
    assert.equal(data.leader, "Elio");
    assert.equal(data.self, "Niko");
    assert.equal(data.members[1]!.description, "designer");
  });

  it("rejects when not in a team", async () => {
    const result = await registry.execute("list_agent_team_members", {}, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_in_team");
  });
});
