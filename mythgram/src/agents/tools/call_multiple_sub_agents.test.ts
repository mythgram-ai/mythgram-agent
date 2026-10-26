import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { callMultipleSubAgentsTool } from "./call_multiple_sub_agents.js";
import { callSubAgentTool } from "./call_sub_agent.js";
import { listSubAgentsTool } from "./list_sub_agents.js";
import { fileReadTool } from "./fileRead.js";
import { createSubAgentRuntime } from "../subagents.js";
import type { AppConfig } from "../../config.js";
import type { Provider, StreamDelta } from "../providers/types.js";
import type { StoredMessage } from "../../services/sessionStore.js";
import type { SubAgentDefinition, SubAgentRuntime, ToolContext } from "./types.js";

/* ------------------------------------------------------------------ helpers */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Extract the last user message content (string) from a provider messages array. */
function lastUserContent(messages: Array<Record<string, unknown>>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

/**
 * A deterministic fake provider: every streamed completion returns a single final answer (no tool
 * calls) whose text echoes the sub-agent's task, so each run's output is uniquely identifiable.
 * Records every request it receives for assertions about what each sub-agent was handed.
 */
function makeFakeProvider(): { provider: Provider; calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  const provider = {
    metadata: { id: "fake", label: "Fake", defaultBaseUrl: "" },
    async listModels() {
      return [];
    },
    async *streamChatCompletion(opts: {
      messages: Array<Record<string, unknown>>;
    }): AsyncGenerator<StreamDelta, void, unknown> {
      const system =
        opts.messages.find((m) => m.role === "system")?.content;
      const user = lastUserContent(opts.messages);
      calls.push({ system: typeof system === "string" ? system : "", user });
      yield { text: `RESULT:${user}` };
    },
  } as unknown as Provider;
  return { provider, calls };
}

const DEFINITIONS: SubAgentDefinition[] = [
  { name: "alpha", description: "Agent A", system_prompt: "You are alpha.", tools: [] },
  { name: "beta", description: "Agent B", system_prompt: "You are beta.", tools: [] },
  { name: "gamma", description: "Agent C (disabled)", system_prompt: "You are gamma.", tools: [], enabled: false },
];

interface Harness {
  runtime: SubAgentRuntime;
  events: Array<{ event: string; data: Record<string, unknown> }>;
  calls: Array<{ system: string; user: string }>;
  workspaceRoot: string;
}

async function makeHarness(context: StoredMessage[] = []): Promise<Harness> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-multi-"));
  const tools = new ToolRegistry().registerAll([fileReadTool]);
  const config = { workspaceRoot, shellTimeoutMs: 10_000 } as AppConfig;
  const { provider, calls } = makeFakeProvider();
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const runtime = createSubAgentRuntime({
    provider,
    tools,
    config,
    chatId: "chat1",
    definitions: DEFINITIONS,
    model: "fake-model",
    apiKey: "key",
    send: (event, data) => events.push({ event, data }),
    getConversationContext: () => context,
  });
  return { runtime, events, calls, workspaceRoot };
}

function ctxFor(workspaceRoot: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot,
    shellTimeoutMs: 10_000,
    toolCallId: "parenttool",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ tool wiring */

describe("call_multiple_sub_agents tool (registration & schema)", () => {
  let registry: ToolRegistry;
  before(() => {
    registry = new ToolRegistry().registerAll([
      callSubAgentTool,
      callMultipleSubAgentsTool,
      listSubAgentsTool,
    ]);
  });

  it("is registered and exposed to the LLM as a native function tool", () => {
    assert.ok(registry.has("call_multiple_sub_agents"));
    const schema = registry.schemas.find((s) => s.function.name === "call_multiple_sub_agents");
    assert.ok(schema, "must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.agents, "agents property must be declared");
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required, ["agents"]);
  });

  it("declares the per-agent item shape (agent + prompt required)", () => {
    const schema = registry.schemas.find((s) => s.function.name === "call_multiple_sub_agents")!;
    const agents = (schema.function.parameters.properties as Record<string, any>).agents;
    assert.equal(agents.type, "array");
    const item = agents.items;
    assert.equal(item.type, "object");
    assert.ok(item.properties.agent);
    assert.ok(item.properties.prompt);
    assert.ok(item.properties.wait_for_output);
    assert.ok(item.properties.send_my_output);
    assert.deepEqual([...item.required].sort(), ["agent", "prompt"]);
  });

  it("validates args and defaults wait_for_output=true / send_my_output=false", () => {
    const parsed = callMultipleSubAgentsTool.schema.parse({
      agents: [{ agent: "alpha", prompt: "do it" }],
    });
    assert.equal(parsed.agents[0]!.wait_for_output, true);
    assert.equal(parsed.agents[0]!.send_my_output, false);
  });

  it("rejects an empty agents array via schema validation", async () => {
    const result = await registry.execute("call_multiple_sub_agents", { agents: [] }, {
      workspaceRoot: "/tmp",
      shellTimeoutMs: 1000,
    } as ToolContext);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("exposes a clear UI label listing the agents", () => {
    const label = callMultipleSubAgentsTool.label({
      agents: [
        { agent: "alpha", prompt: "a", wait_for_output: true, send_my_output: false },
        { agent: "beta", prompt: "b", wait_for_output: true, send_my_output: false },
      ],
    });
    assert.match(label, /Sub-Agents \(2\)/);
    assert.match(label, /alpha/);
    assert.match(label, /beta/);
  });

  it("fails cleanly when the sub-agent runtime is unavailable", async () => {
    const result = await callMultipleSubAgentsTool.execute(
      { agents: [{ agent: "alpha", prompt: "x", wait_for_output: true, send_my_output: false }] },
      { workspaceRoot: "/tmp", shellTimeoutMs: 1000 } as ToolContext,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "sub_agents_unavailable");
  });

  it("delegates to runMany with the mapped agents", async () => {
    const captured: Array<{ agents: unknown }> = [];
    const fakeRuntime = {
      runMany: async (params: { agents: unknown }) => {
        captured.push(params);
        return { ok: true, data: { count: 1 } };
      },
    } as unknown as SubAgentRuntime;
    const result = await callMultipleSubAgentsTool.execute(
      {
        agents: [
          { agent: "alpha", prompt: "task-a", wait_for_output: true, send_my_output: false },
          { agent: "beta", prompt: "task-b", wait_for_output: false, send_my_output: true },
        ],
      },
      { workspaceRoot: "/tmp", shellTimeoutMs: 1000, subAgents: fakeRuntime } as ToolContext,
    );
    assert.equal(result.ok, true);
    assert.equal(captured.length, 1);
    const agents = (captured[0]!.agents as any[]);
    assert.equal(agents.length, 2);
    assert.deepEqual(agents[0], {
      agent: "alpha",
      prompt: "task-a",
      wait_for_output: true,
      send_my_output: false,
    });
    assert.equal(agents[1].wait_for_output, false);
    assert.equal(agents[1].send_my_output, true);
  });
});

/* ------------------------------------------------------------------ runMany behaviour */

describe("call_multiple_sub_agents runMany (concurrent execution)", () => {
  const created: string[] = [];
  after(async () => {
    for (const dir of created) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("runs several sub-agents, waiting for foreground and detaching background ones", async () => {
    const h = await makeHarness();
    created.push(h.workspaceRoot);
    const result = await h.runtime.runMany(
      {
        agents: [
          { agent: "alpha", prompt: "task-a" }, // defaults => foreground
          { agent: "beta", prompt: "task-b", wait_for_output: false }, // background
        ],
      },
      ctxFor(h.workspaceRoot),
    );

    assert.equal(result.ok, true);
    const data = result.data as {
      count: number;
      waited_for: number;
      running_in_background: number;
      failed: number;
      agents: any[];
      parent_tool_id: string;
    };
    assert.equal(data.count, 2);
    assert.equal(data.waited_for, 1);
    assert.equal(data.running_in_background, 1);
    assert.equal(data.failed, 0);
    assert.equal(data.parent_tool_id, "parenttool");

    const alpha = data.agents.find((a) => a.agent === "alpha");
    const beta = data.agents.find((a) => a.agent === "beta");
    assert.ok(alpha && beta);
    // Foreground alpha returns its output inline.
    assert.equal(alpha.ok, true);
    assert.equal(alpha.wait_for_output, true);
    assert.match(String(alpha.output), /task-a/);
    // Background beta returns immediately with an output file path (no inline output).
    assert.equal(beta.ok, true);
    assert.equal(beta.wait_for_output, false);
    assert.equal(beta.background, true);
    assert.match(String(beta.output_file), /\.mythgram\/sub-agent\/.*\.md$/);
  });

  it("gives each sub-agent its own unique 10-character session id", async () => {
    const h = await makeHarness();
    created.push(h.workspaceRoot);
    const result = await h.runtime.runMany(
      {
        agents: [
          { agent: "alpha", prompt: "a" },
          { agent: "beta", prompt: "b" },
        ],
      },
      ctxFor(h.workspaceRoot),
    );
    const agents = (result.data as { agents: any[] }).agents;
    const ids = agents.map((a) => a.session_id as string);
    assert.equal(ids.length, 2);
    for (const id of ids) assert.match(id, /^[0-9A-Za-z]{10}$/);
    assert.notEqual(ids[0], ids[1], "session ids must be unique per sub-agent");
  });

  it("streams a batch-start event plus per-child sub_agent_* events stamped with parent_tool_id", async () => {
    const h = await makeHarness();
    created.push(h.workspaceRoot);
    await h.runtime.runMany(
      {
        agents: [
          { agent: "alpha", prompt: "a" },
          { agent: "beta", prompt: "b" },
        ],
      },
      ctxFor(h.workspaceRoot),
    );

    const start = h.events.find((e) => e.event === "multi_sub_agents_start");
    assert.ok(start, "must emit a multi_sub_agents_start event");
    assert.equal(start!.data.id, "parenttool");
    assert.equal(start!.data.count, 2);
    const listed = start!.data.agents as any[];
    assert.equal(listed.length, 2);
    // Each listed child carries a distinct child id derived from the parent tool id.
    assert.deepEqual(
      listed.map((c) => c.id),
      ["parenttool::0", "parenttool::1"],
    );

    // Every sub_agent_* event must carry the parent_tool_id so the UI nests it in the batch block.
    const subEvents = h.events.filter((e) => e.event.startsWith("sub_agent_"));
    assert.ok(subEvents.length > 0);
    for (const e of subEvents) {
      assert.equal(e.data.parent_tool_id, "parenttool", `${e.event} must carry parent_tool_id`);
      assert.match(String(e.data.id), /^parenttool::\d+$/);
      assert.match(String(e.data.sub_session_id), /^[0-9A-Za-z]{10}$/);
    }

    // Both children produced a start and a done.
    const starts = subEvents.filter((e) => e.event === "sub_agent_start");
    const dones = subEvents.filter((e) => e.event === "sub_agent_done");
    assert.equal(starts.length, 2);
    assert.equal(dones.length, 2);
  });

  it("reports per-entry errors for unknown/disabled agents without failing the whole batch", async () => {
    const h = await makeHarness();
    created.push(h.workspaceRoot);
    const result = await h.runtime.runMany(
      {
        agents: [
          { agent: "alpha", prompt: "a" }, // valid
          { agent: "ghost", prompt: "b" }, // unknown
          { agent: "gamma", prompt: "c" }, // disabled
          { agent: "alpha", prompt: "   " }, // empty prompt
        ],
      },
      ctxFor(h.workspaceRoot),
    );

    assert.equal(result.ok, true, "the batch call itself succeeds even with bad entries");
    const data = result.data as { count: number; failed: number; agents: any[] };
    assert.equal(data.count, 4);
    assert.equal(data.failed, 3);

    const valid = data.agents.find((a) => a.agent === "alpha" && a.ok === true);
    assert.ok(valid, "the valid alpha entry still runs and succeeds");

    const ghost = data.agents.find((a) => a.agent === "ghost");
    assert.equal(ghost.ok, false);
    assert.match(String(ghost.error), /Unknown or disabled/);

    const gamma = data.agents.find((a) => a.agent === "gamma");
    assert.equal(gamma.ok, false);

    const emptyPrompt = data.agents.find((a) => a.ok === false && /non-empty prompt/i.test(a.error));
    assert.ok(emptyPrompt, "empty prompt entry is reported as an error");

    // A failed entry still surfaces start + done(error) events so its UI block appears.
    const errorDone = h.events.find(
      (e) => e.event === "sub_agent_done" && e.data.ok === false && e.data.id === "parenttool::1",
    );
    assert.ok(errorDone, "unknown agent emits an error done event");
  });

  it("shares the main conversation with a sub-agent only when send_my_output=true", async () => {
    const context: StoredMessage[] = [
      { role: "user", content: "Please build a login screen." },
      { role: "assistant", content: "Working on the login screen now." },
    ];
    const h = await makeHarness(context);
    created.push(h.workspaceRoot);
    await h.runtime.runMany(
      {
        agents: [
          { agent: "alpha", prompt: "shared", send_my_output: true },
          { agent: "beta", prompt: "isolated", send_my_output: false },
        ],
      },
      ctxFor(h.workspaceRoot),
    );

    const shared = h.calls.find((c) => c.user.includes("shared"));
    const isolated = h.calls.find((c) => c.user.includes("isolated"));
    assert.ok(shared && isolated);
    // The shared sub-agent's user message includes the main conversation context block.
    assert.match(shared!.user, /Main agent conversation context/);
    assert.match(shared!.user, /login screen/);
    // The isolated sub-agent sees only its own prompt.
    assert.doesNotMatch(isolated!.user, /Main agent conversation context/);
  });

  it("fails cleanly when given no agents", async () => {
    const h = await makeHarness();
    created.push(h.workspaceRoot);
    const result = await h.runtime.runMany({ agents: [] }, ctxFor(h.workspaceRoot));
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "no_sub_agents");
  });

  it("writes each background sub-agent's output to its own file", async () => {
    const h = await makeHarness();
    created.push(h.workspaceRoot);
    const result = await h.runtime.runMany(
      { agents: [{ agent: "alpha", prompt: "bg-task", wait_for_output: false }] },
      ctxFor(h.workspaceRoot),
    );
    const entry = (result.data as { agents: any[] }).agents[0]!;
    const rel = String(entry.output_file);
    // Give the detached run a moment to finish writing its final report.
    await sleep(50);
    const abs = path.join(h.workspaceRoot, rel);
    const content = await fs.readFile(abs, "utf8");
    assert.match(content, /Sub-agent: alpha/);
  });
});
