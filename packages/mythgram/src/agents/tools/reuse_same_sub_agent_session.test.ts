import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { reuseSameSubAgentSessionTool } from "./reuse_same_sub_agent_session.js";
import { fileReadTool } from "./fileRead.js";
import { createSubAgentRuntime } from "../subagents.js";
import { subAgentSessionStore } from "../subAgentSessionStore.js";
import type { AppConfig } from "../../config.js";
import type { Provider, StreamDelta } from "../providers/types.js";
import type { SubAgentDefinition, SubAgentRuntime, ToolContext } from "./types.js";

/**
 * A fake provider that echoes the last user message and records every request's full message array,
 * so a reuse call can be asserted to carry the prior conversation as context.
 */
function makeFakeProvider(): {
  provider: Provider;
  requests: Array<Array<Record<string, unknown>>>;
} {
  const requests: Array<Array<Record<string, unknown>>> = [];
  const provider = {
    metadata: { id: "fake", label: "Fake", defaultBaseUrl: "" },
    async listModels() {
      return [];
    },
    async *streamChatCompletion(opts: {
      messages: Array<Record<string, unknown>>;
    }): AsyncGenerator<StreamDelta, void, unknown> {
      requests.push(opts.messages);
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
  return { provider, requests };
}

const DEFINITIONS: SubAgentDefinition[] = [
  { name: "alpha", description: "Agent A", system_prompt: "You are alpha.", tools: [] },
];

async function makeHarness(chatId: string): Promise<{
  runtime: SubAgentRuntime;
  requests: Array<Array<Record<string, unknown>>>;
  events: Array<{ event: string; data: Record<string, unknown> }>;
  workspaceRoot: string;
}> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-reuse-"));
  const tools = new ToolRegistry().registerAll([fileReadTool]);
  const config = { workspaceRoot, shellTimeoutMs: 10_000 } as AppConfig;
  const { provider, requests } = makeFakeProvider();
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const runtime = createSubAgentRuntime({
    provider,
    tools,
    config,
    chatId,
    definitions: DEFINITIONS,
    model: "fake-model",
    apiKey: "key",
    send: (event, data) => events.push({ event, data }),
  });
  return { runtime, requests, events, workspaceRoot };
}

function ctxFor(workspaceRoot: string, runtime: SubAgentRuntime): ToolContext {
  return { workspaceRoot, shellTimeoutMs: 10_000, toolCallId: "reusetool", subAgents: runtime };
}

/* ------------------------------------------------------------------ tool wiring */

describe("reuse_same_sub_agent_session tool (registration & schema)", () => {
  let registry: ToolRegistry;
  before(() => {
    registry = new ToolRegistry().registerAll([reuseSameSubAgentSessionTool]);
  });

  it("is registered and exposed to the LLM as a native function tool", () => {
    assert.ok(registry.has("reuse_same_sub_agent_session"));
    const schema = registry.schemas.find((s) => s.function.name === "reuse_same_sub_agent_session");
    assert.ok(schema, "must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.session_id, "session_id property must be declared");
    assert.ok(props.prompt, "prompt property must be declared");
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual([...required].sort(), ["prompt", "session_id"]);
  });

  it("fails cleanly when the sub-agent runtime is unavailable", async () => {
    const result = await registry.execute(
      "reuse_same_sub_agent_session",
      { session_id: "1234567890", prompt: "hi" },
      { workspaceRoot: "/tmp", shellTimeoutMs: 1000 } as ToolContext,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "sub_agents_unavailable");
  });

  it("rejects missing session_id / prompt via schema validation", async () => {
    const result = await registry.execute("reuse_same_sub_agent_session", { session_id: "" }, {
      workspaceRoot: "/tmp",
      shellTimeoutMs: 1000,
    } as ToolContext);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_arguments");
  });

  it("produces a readable UI label", () => {
    assert.equal(
      registry.label("reuse_same_sub_agent_session", { session_id: "abc1234567", prompt: "x" }),
      "Reuse Sub-Agent Session: abc1234567",
    );
  });
});

/* ------------------------------------------------------------------ reuse behaviour */

describe("reuse_same_sub_agent_session tool (continues a real session)", () => {
  it("returns an error for an unknown session id", async () => {
    const chatId = "chat-reuse-unknown";
    subAgentSessionStore.clear(chatId);
    const { runtime, workspaceRoot } = await makeHarness(chatId);
    const registry = new ToolRegistry().registerAll([reuseSameSubAgentSessionTool]);
    const result = await registry.execute(
      "reuse_same_sub_agent_session",
      { session_id: "0000000000", prompt: "continue" },
      ctxFor(workspaceRoot, runtime),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "unknown_session");
  });

  it("continues an existing session with its preserved conversation context", async () => {
    const chatId = "chat-reuse-1";
    subAgentSessionStore.clear(chatId);
    const { runtime, requests, events, workspaceRoot } = await makeHarness(chatId);
    const ctx = ctxFor(workspaceRoot, runtime);

    // 1. Run a sub-agent so a session is created and stored.
    const first = await runtime.run(
      { agent: "alpha", task: "remember the code word BANANA", wait_for_output: true },
      ctx,
    );
    assert.equal(first.ok, true);
    const sessionId = (first.data as { session_id: string }).session_id;
    assert.equal(sessionId.length, 10);

    const requestsAfterFirst = requests.length;

    // 2. Reuse that session with a follow-up prompt.
    const registry = new ToolRegistry().registerAll([reuseSameSubAgentSessionTool]);
    const result = await registry.execute(
      "reuse_same_sub_agent_session",
      { session_id: sessionId, prompt: "what was the code word?" },
      ctx,
    );
    assert.equal(result.ok, true);
    const data = result.data as { reused: boolean; session_id: string; output: string };
    assert.equal(data.reused, true);
    assert.equal(data.session_id, sessionId);
    assert.match(data.output, /what was the code word\?/);

    // 3. The reuse request must have replayed the prior conversation as context: the very first
    // user turn ("remember the code word BANANA") is still present alongside the new prompt.
    const reuseRequest = requests[requestsAfterFirst]!;
    const userContents = reuseRequest
      .filter((m) => m.role === "user" && typeof m.content === "string")
      .map((m) => m.content as string);
    assert.ok(
      userContents.some((c) => c.includes("BANANA")),
      "reuse must carry the original conversation as context",
    );
    assert.ok(
      userContents.some((c) => c.includes("what was the code word?")),
      "reuse must include the new prompt",
    );

    // 4. The session store keeps growing the same transcript (not a fresh session).
    const record = subAgentSessionStore.get(chatId, sessionId);
    assert.ok(record);
    assert.equal(record!.status, "completed");
    assert.ok(record!.messages.length >= 3, "the transcript should include the continued turn");

    // 5. The continued run streamed sub_agent_* events stamped with the session id.
    const reuseStart = events.find(
      (e) => e.event === "sub_agent_start" && e.data.sub_session_id === sessionId && e.data.task === "what was the code word?",
    );
    assert.ok(reuseStart, "a sub_agent_start for the reuse must be emitted with the session id");
  });
});
