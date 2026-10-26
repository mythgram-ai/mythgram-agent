import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { listSubAgentSessionsTool } from "./list_sub_agent_sessions.js";
import { fileReadTool } from "./fileRead.js";
import { createSubAgentRuntime } from "../subagents.js";
import { subAgentSessionStore } from "../subAgentSessionStore.js";
import type { AppConfig } from "../../config.js";
import type { Provider, StreamDelta } from "../providers/types.js";
import type { SubAgentDefinition, SubAgentRuntime, ToolContext } from "./types.js";

/** A deterministic fake provider whose completion echoes the last user message as a final answer. */
function makeFakeProvider(): Provider {
  return {
    metadata: { id: "fake", label: "Fake", defaultBaseUrl: "" },
    async listModels() {
      return [];
    },
    async *streamChatCompletion(opts: {
      messages: Array<Record<string, unknown>>;
    }): AsyncGenerator<StreamDelta, void, unknown> {
      let user = "";
      for (let i = opts.messages.length - 1; i >= 0; i--) {
        const m = opts.messages[i]!;
        if (m.role === "user" && typeof m.content === "string") {
          user = m.content;
          break;
        }
      }
      yield { text: `RESULT:${user}` };
    },
  } as unknown as Provider;
}

const DEFINITIONS: SubAgentDefinition[] = [
  { name: "alpha", description: "Agent A", system_prompt: "You are alpha.", tools: [] },
  { name: "beta", description: "Agent B", system_prompt: "You are beta.", tools: [] },
];

async function makeRuntime(chatId: string): Promise<{ runtime: SubAgentRuntime; workspaceRoot: string }> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-listsess-"));
  const tools = new ToolRegistry().registerAll([fileReadTool]);
  const config = { workspaceRoot, shellTimeoutMs: 10_000 } as AppConfig;
  const runtime = createSubAgentRuntime({
    provider: makeFakeProvider(),
    tools,
    config,
    chatId,
    definitions: DEFINITIONS,
    model: "fake-model",
    apiKey: "key",
    send: () => {},
  });
  return { runtime, workspaceRoot };
}

function ctxFor(workspaceRoot: string, runtime: SubAgentRuntime): ToolContext {
  return { workspaceRoot, shellTimeoutMs: 10_000, toolCallId: "tool1", subAgents: runtime };
}

describe("list_sub_agent_sessions tool (registration & schema)", () => {
  let registry: ToolRegistry;
  before(() => {
    registry = new ToolRegistry().registerAll([listSubAgentSessionsTool]);
  });

  it("is registered and exposed to the LLM as a native function tool", () => {
    assert.ok(registry.has("list_sub_agent_sessions"));
    const schema = registry.schemas.find((s) => s.function.name === "list_sub_agent_sessions");
    assert.ok(schema, "must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
  });

  it("fails cleanly when the sub-agent runtime is unavailable", async () => {
    const result = await registry.execute("list_sub_agent_sessions", {}, {
      workspaceRoot: "/tmp",
      shellTimeoutMs: 1000,
    } as ToolContext);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "sub_agents_unavailable");
  });

  it("reports zero sessions before any sub-agent has run", async () => {
    const chatId = "chat-empty";
    subAgentSessionStore.clear(chatId);
    const { runtime, workspaceRoot } = await makeRuntime(chatId);
    const registry = new ToolRegistry().registerAll([listSubAgentSessionsTool]);
    const viaTool = await registry.execute("list_sub_agent_sessions", {}, ctxFor(workspaceRoot, runtime));
    assert.equal(viaTool.ok, true);
    assert.equal((viaTool.data as { count: number }).count, 0);
    assert.match((viaTool.data as { message: string }).message, /No sub-agent sessions/);
  });
});

describe("list_sub_agent_sessions tool (lists real sessions)", () => {
  it("lists every session created by call_sub_agent with id, agent, and status", async () => {
    const chatId = "chat-list-1";
    subAgentSessionStore.clear(chatId);
    const { runtime, workspaceRoot } = await makeRuntime(chatId);
    const ctx = ctxFor(workspaceRoot, runtime);

    // Run two sub-agents so two sessions exist.
    await runtime.run({ agent: "alpha", task: "first task", wait_for_output: true }, ctx);
    await runtime.run({ agent: "beta", task: "second task", wait_for_output: true }, ctx);

    const registry = new ToolRegistry().registerAll([listSubAgentSessionsTool]);
    const result = await registry.execute("list_sub_agent_sessions", {}, ctx);
    assert.equal(result.ok, true);
    const data = result.data as {
      count: number;
      sessions: Array<{ session_id: string; agent: string; status: string }>;
    };
    assert.equal(data.count, 2);
    assert.deepEqual(
      data.sessions.map((s) => s.agent),
      ["alpha", "beta"],
    );
    // Every session id is the 10-character sub-agent session id and completed successfully.
    for (const s of data.sessions) {
      assert.equal(s.session_id.length, 10);
      assert.equal(s.status, "completed");
    }
  });
});
