import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { sendMessageToTeamTool } from "./send_message_to_team.js";
import type { ToolContext, TeamRuntime, TeamDeliveryResult } from "./types.js";

function fakeTeam(overrides: Partial<TeamRuntime> = {}): TeamRuntime {
  return {
    selfId: "Niko",
    isLeader: false,
    leaderId: "Elio",
    sendMessageToTeamEnabled: true,
    listMembers: () => [],
    status: () => [],
    deliver: (messages): TeamDeliveryResult => ({
      ok: true,
      delivered: messages.map((m) => m.agent_id),
      unknown: [],
      message: `Delivered to ${messages.length}.`,
    }),
    ...overrides,
  };
}

function ctxFor(team?: TeamRuntime): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, team };
}

describe("send_message_to_team tool", () => {
  let registry: ToolRegistry;
  before(() => {
    registry = new ToolRegistry().registerAll([sendMessageToTeamTool]);
  });

  it("exposes a recipients array schema", () => {
    const schema = registry.schemas.find((s) => s.function.name === "send_message_to_team");
    assert.ok(schema);
    const props = schema!.function.parameters.properties as Record<string, any>;
    assert.equal(props.recipients.type, "array");
    assert.deepEqual(schema!.function.parameters.required, ["recipients"]);
  });

  it("delivers to teammates when enabled", async () => {
    const result = await registry.execute(
      "send_message_to_team",
      { recipients: [{ agent_id: "Arlo", message: "need the API contract" }] },
      ctxFor(fakeTeam()),
    );
    assert.equal(result.ok, true);
    const data = result.data as { from: string; delivered: string[] };
    assert.equal(data.from, "Niko");
    assert.deepEqual(data.delivered, ["Arlo"]);
  });

  it("is blocked when the tool is disabled", async () => {
    const result = await registry.execute(
      "send_message_to_team",
      { recipients: [{ agent_id: "Arlo", message: "hi" }] },
      ctxFor(fakeTeam({ sendMessageToTeamEnabled: false })),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "tool_disabled");
  });

  it("rejects self-messaging only", async () => {
    const result = await registry.execute(
      "send_message_to_team",
      { recipients: [{ agent_id: "Niko", message: "to myself" }] },
      ctxFor(fakeTeam()),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "no_valid_recipients");
  });

  it("rejects when not in a team", async () => {
    const result = await registry.execute(
      "send_message_to_team",
      { recipients: [{ agent_id: "Arlo", message: "hi" }] },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_in_team");
  });
});
