import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { delegateTaskOrSendMessageTool } from "./delegate_task_or_send_message.js";
import type { ToolContext, TeamRuntime, TeamDeliveryResult } from "./types.js";

function fakeTeam(overrides: Partial<TeamRuntime> = {}): TeamRuntime {
  const calls: Array<{ messages: unknown; kind: string }> = [];
  const base: TeamRuntime = {
    selfId: "Elio",
    isLeader: true,
    leaderId: "Elio",
    sendMessageToTeamEnabled: false,
    listMembers: () => [],
    status: () => [],
    deliver: (messages, kind): TeamDeliveryResult => {
      calls.push({ messages, kind });
      return {
        ok: true,
        delivered: messages.map((m) => m.agent_id),
        unknown: [],
        message: `Delivered to ${messages.length} agent(s).`,
      };
    },
    ...overrides,
  };
  (base as unknown as { _calls: typeof calls })._calls = calls;
  return base;
}

function ctxFor(team?: TeamRuntime): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, team };
}

describe("delegate_task_or_send_message tool", () => {
  let registry: ToolRegistry;
  before(() => {
    registry = new ToolRegistry().registerAll([delegateTaskOrSendMessageTool]);
  });

  it("is registered as a native function schema with the messages array", () => {
    assert.ok(registry.has("delegate_task_or_send_message"));
    const schema = registry.schemas.find((s) => s.function.name === "delegate_task_or_send_message");
    assert.ok(schema);
    assert.equal(schema!.function.parameters.type, "object");
    const props = schema!.function.parameters.properties as Record<string, any>;
    assert.ok(props.messages, "messages property must be declared");
    assert.equal(props.messages.type, "array");
    assert.deepEqual(schema!.function.parameters.required, ["messages"]);
  });

  it("delivers messages to members when called by the leader", async () => {
    const team = fakeTeam();
    const result = await registry.execute(
      "delegate_task_or_send_message",
      { messages: [{ agent_id: "Niko", message: "Design the UI" }, { agent_id: "Arlo", message: "Build it" }] },
      ctxFor(team),
    );
    assert.equal(result.ok, true);
    const data = result.data as { delivered: string[]; message: string };
    assert.deepEqual(data.delivered, ["Niko", "Arlo"]);
    const calls = (team as unknown as { _calls: Array<{ kind: string }> })._calls;
    assert.equal(calls[0]!.kind, "delegate");
  });

  it("rejects a non-leader agent", async () => {
    const team = fakeTeam({ isLeader: false, selfId: "Niko" });
    const result = await registry.execute(
      "delegate_task_or_send_message",
      { messages: [{ agent_id: "Arlo", message: "hi" }] },
      ctxFor(team),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "leader_only");
  });

  it("rejects when no team runtime is present (single agent)", async () => {
    const result = await registry.execute(
      "delegate_task_or_send_message",
      { messages: [{ agent_id: "Arlo", message: "hi" }] },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_in_team");
  });

  it("rejects invalid arguments (empty messages)", async () => {
    const result = await registry.execute("delegate_task_or_send_message", { messages: [] }, ctxFor(fakeTeam()));
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_arguments");
  });

  it("surfaces a delivery budget error", async () => {
    const team = fakeTeam({
      deliver: () => ({
        ok: false,
        delivered: [],
        unknown: [],
        message: "budget",
        error: { code: "collaboration_budget_exceeded", message: "too many messages" },
      }),
    });
    const result = await registry.execute(
      "delegate_task_or_send_message",
      { messages: [{ agent_id: "Arlo", message: "hi" }] },
      ctxFor(team),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "collaboration_budget_exceeded");
  });
});
