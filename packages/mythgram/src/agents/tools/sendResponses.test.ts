import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import {
  CHANNEL_ONLY_TOOLS,
  buildChannelSystemSection,
  sendResponsesTool,
} from "./sendResponses.js";
import type { ChannelToolContext, ToolContext } from "./types.js";

function ctxFor(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: "/tmp",
    shellTimeoutMs: 10_000,
    ...overrides,
  };
}

function channelCtx(sent: string[]): ChannelToolContext {
  return {
    kind: "telegram",
    channelId: "ch_test",
    channelName: "Test channel",
    userKey: "tg:1",
    userLabel: "Tester",
    sendMessage: async (text: string) => {
      sent.push(text);
    },
    sendFiles: async () => ({ delivered: 0, errors: [] }),
  };
}

describe("send_responses tool", () => {
  let registry: ToolRegistry;

  before(() => {
    registry = new ToolRegistry().registerAll([sendResponsesTool]);
  });

  it("is registered and exposed to the LLM as a native function schema", () => {
    assert.ok(registry.has("send_responses"));
    assert.deepEqual([...CHANNEL_ONLY_TOOLS], ["send_responses"]);
    const schema = registry.schemas.find((s) => s.function.name === "send_responses");
    assert.ok(schema, "send_responses must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    const props = schema!.function.parameters.properties as Record<string, any>;
    assert.ok(props.message, "message property must be declared");
    assert.equal(props.message.type, "string");
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required, ["message"]);
  });

  it("sends the message through the channel context", async () => {
    const sent: string[] = [];
    const result = await registry.execute(
      "send_responses",
      { message: "Hello from the agent." },
      ctxFor({ channel: channelCtx(sent) }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(sent, ["Hello from the agent."]);
    const data = result.data as { delivered: boolean };
    assert.equal(data.delivered, true);
  });

  it("refuses to run outside a messaging channel", async () => {
    const result = await registry.execute(
      "send_responses",
      { message: "Hello." },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "channel_only");
  });

  it("rejects an empty message", async () => {
    const sent: string[] = [];
    const result = await registry.execute(
      "send_responses",
      { message: "   " },
      ctxFor({ channel: channelCtx(sent) }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "empty_message");
    assert.deepEqual(sent, []);
  });

  it("reports channel send failures without throwing", async () => {
    const failing: ChannelToolContext = {
      ...channelCtx([]),
      sendMessage: async () => {
        throw new Error("network down");
      },
    };
    const result = await registry.execute(
      "send_responses",
      { message: "Hello." },
      ctxFor({ channel: failing }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "channel_send_failed");
  });

  it("builds a channel system section naming the channel and the rules", () => {
    const section = buildChannelSystemSection({
      kind: "discord",
      channelName: "Ops",
      userLabel: "Ada",
    });
    assert.match(section, /Discord/);
    assert.match(section, /Ops/);
    assert.match(section, /send_responses/);
    assert.match(section, /ask_question_to_user/);
    assert.match(section, /submit_plan/);
    assert.match(section, /attach_files/);
  });
});
