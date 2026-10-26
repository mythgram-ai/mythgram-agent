import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { listTeamsTool } from "./list_teams.js";
import type { ToolContext, CeoRuntime, CeoTeamInfo } from "./types.js";

const TEAMS: CeoTeamInfo[] = [
  {
    team_id: "t1",
    team_name: "Frontend Team",
    team_leader: "frontend_leader",
    members: [
      { name: "ui_agent", description: "Designs and builds user interfaces." },
      { name: "react_agent", description: "Develops React components and features." },
    ],
  },
  {
    team_id: "t2",
    team_name: "Backend Team",
    team_leader: "backend_leader",
    members: [{ name: "api_agent", description: "Builds and maintains APIs." }],
  },
];

function fakeCeo(teams: CeoTeamInfo[] = TEAMS): CeoRuntime {
  return {
    selfId: "Vera",
    listTeams: () => teams,
    assignTasks: () => ({ ok: true, delivered: [], unknown: [], message: "" }),
  };
}

function ctxFor(ceo?: CeoRuntime): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, ceo };
}

describe("list_teams tool", () => {
  let registry: ToolRegistry;
  before(() => {
    registry = new ToolRegistry().registerAll([listTeamsTool]);
  });

  it("takes no parameters", () => {
    const schema = registry.schemas.find((s) => s.function.name === "list_teams");
    assert.ok(schema);
    assert.equal(schema!.function.parameters.additionalProperties, false);
  });

  it("lists teams with leaders and members (name + description)", async () => {
    const result = await registry.execute("list_teams", {}, ctxFor(fakeCeo()));
    assert.equal(result.ok, true);
    const data = result.data as {
      count: number;
      teams: Array<{ team_name: string; team_leader: string; members: Array<{ name: string }> }>;
    };
    assert.equal(data.count, 2);
    assert.equal(data.teams[0]!.team_name, "Frontend Team");
    assert.equal(data.teams[0]!.team_leader, "frontend_leader");
    assert.equal(data.teams[0]!.members.length, 2);
    assert.equal(data.teams[0]!.members[0]!.name, "ui_agent");
  });

  it("rejects when not the CEO", async () => {
    const result = await registry.execute("list_teams", {}, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_ceo");
  });
});
