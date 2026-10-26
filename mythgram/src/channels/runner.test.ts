import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { ProviderRegistry } from "../agents/providers/registry.js";
import { OpenAICompatibleProvider } from "../agents/providers/base.js";
import type { Provider, StreamDelta } from "../agents/providers/types.js";
import { createToolRegistry } from "../agents/tools/index.js";
import { AgentRunner } from "../agents/agent.js";
import { CustomAgentManager, CustomAgentRunner } from "../agents/customagent/index.js";
import { MainAgentPromptManager } from "../agents/mainagentprompt/index.js";
import { PlanApprovalStore } from "../services/planApprovalStore.js";
import { QuestionStore } from "../services/questionStore.js";
import { MythgramDatabase } from "../database/index.js";
import { ChannelStore } from "./store.js";
import { ChannelTurnRunner } from "./runner.js";
import type {
  ChannelConnection,
  ChannelIncoming,
  ChannelSender,
  ChannelTarget,
} from "./types.js";

const config = {
  port: 0,
  workspaceRoot: "",
  maxIterations: 1000,
  corsOrigins: "*",
  shellTimeoutMs: 10_000,
  planApprovalTimeoutMs: 60_000,
  questionTimeoutMs: 180_000,
  searchProvider: "duckduckgo",
  fetchProvider: "builtin",
  tavilyApiKey: "",
  exaApiKey: "",
  serpapiApiKey: "",
  firecrawlApiKey: "",
  composioApiKey: "",
  visionModelPatterns: [],
  textOnlyModelPatterns: [],
  memoryAgentEnabled: true,
  memoryAgentInterval: 3,
} as AppConfig;

/** Scripted provider: each invocation yields the deltas the script returns. */
class ScriptedProvider extends OpenAICompatibleProvider implements Provider {
  calls = 0;
  constructor(
    private readonly script: (
      messages: Array<Record<string, unknown>>,
      call: number,
    ) => StreamDelta[] | Promise<StreamDelta[]>,
  ) {
    super({ id: "scripted", label: "Scripted", defaultBaseUrl: "http://localhost" });
  }
  override async *streamChatCompletion(opts: {
    messages: Array<Record<string, unknown>>;
  }): AsyncGenerator<StreamDelta, void, unknown> {
    const deltas = await this.script(opts.messages, this.calls++);
    for (const delta of deltas) yield delta;
  }
}

function toolCall(id: string, name: string, args: Record<string, unknown>): StreamDelta {
  return {
    toolCalls: [
      { index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } },
    ],
    finishReason: "tool_calls",
  };
}

function hasToolCall(msgs: Array<Record<string, unknown>>, tool: string): boolean {
  return msgs.some(
    (m) =>
      m.role === "assistant" &&
      Array.isArray(m.tool_calls) &&
      (m.tool_calls as Array<{ function?: { name?: string } }>).some(
        (t) => t.function?.name === tool,
      ),
  );
}

function lastToolResult(
  msgs: Array<Record<string, unknown>>,
  tool: string,
): Record<string, unknown> | null {
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i]!;
    if (m.role === "tool" && m.name === tool && typeof m.content === "string") {
      try {
        return JSON.parse(m.content as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface Fixture {
  dir: string;
  db: MythgramDatabase;
  runner: ChannelTurnRunner;
  connection: ChannelConnection;
  customAgents: CustomAgentManager;
}

function senderFor(): { sender: ChannelSender; texts: string[]; files: string[] } {
  const texts: string[] = [];
  const files: string[] = [];
  const sender: ChannelSender = {
    sendMessage: async (_target: ChannelTarget, text: string) => {
      texts.push(text);
    },
    sendFile: async (_target, file) => {
      files.push(file.filename);
    },
  };
  return { sender, texts, files };
}

function incoming(text: string): ChannelIncoming {
  return {
    userKey: "tg:42",
    userLabel: "Tester",
    target: { kind: "telegram", chatId: "99" },
    text,
    attachments: [],
    needsMention: false,
  };
}

async function waitFor(cond: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("channel turn runner", () => {
  let fixture: Fixture | null = null;

  const build = (
    script: (
      messages: Array<Record<string, unknown>>,
      call: number,
    ) => StreamDelta[] | Promise<StreamDelta[]>,
  ): Fixture => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "channels-test-"));
    const db = MythgramDatabase.open(dir);
    const cfg = { ...config, workspaceRoot: dir };
    const providers = new ProviderRegistry().registerAll([new ScriptedProvider(script)]);
    const tools = createToolRegistry();
    const planApprovals = new PlanApprovalStore();
    const askQuestions = new QuestionStore();
    const agent = new AgentRunner(providers, tools, cfg, planApprovals, askQuestions);
    const customAgents = new CustomAgentManager(db.appState);
    const customAgentRunner = new CustomAgentRunner(agent, tools, cfg);
    const mainAgentPrompts = new MainAgentPromptManager(db.appState);
    db.appState.set("settings", {
      provider: "scripted",
      model: "mock",
      apiKeys: { scripted: "k" },
    });
    const store = new ChannelStore(db.appState);
    const runner = new ChannelTurnRunner({
      providers,
      tools,
      config: cfg,
      db,
      store,
      agent,
      customAgentRunner,
      customAgents,
      mainAgentPrompts,
      planApprovals,
      planTimeoutMs: 5000,
    });
    const connection: ChannelConnection = {
      id: "ch_testchannel",
      kind: "telegram",
      name: "Test",
      token: "token",
      enabled: true,
      status: "connected",
      botName: "Bot",
      botId: "1",
      activeAgentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return { dir, db, runner, connection, customAgents };
  };

  beforeEach(() => {
    fixture = null;
  });

  afterEach(() => {
    try {
      fixture?.db.close();
    } catch {
      // ignore
    }
    if (fixture) fs.rmSync(fixture.dir, { recursive: true, force: true });
    fixture = null;
  });

  it("runs a turn and delivers the summary through send_responses", async () => {
    fixture = build((msgs) => {
      if (!hasToolCall(msgs, "send_responses")) {
        return [toolCall("c1", "send_responses", { message: "Task complete: all green." })];
      }
      return [{ text: "done" }];
    });
    const { sender, texts } = senderFor();
    await fixture.runner.handleIncoming(fixture.connection, sender, incoming("run the tests"));
    assert.ok(
      texts.some((t) => t.includes("Task complete: all green.")),
      `expected the summary in the channel, got: ${JSON.stringify(texts)}`,
    );
    // Transcript persisted for the next message.
    const chats = fixture.db.channelChats.listByChannel("ch_testchannel");
    assert.equal(chats.length, 1);
    const transcript = fixture.db.channelMessages.list(chats[0]!.id);
    assert.ok(transcript.some((m) => m.role === "user"));
  });

  it("nudges the model when it forgets send_responses, then delivers", async () => {
    fixture = build((msgs, call) => {
      if (call === 0) return [{ text: "I did the work silently." }];
      if (!hasToolCall(msgs, "send_responses")) {
        return [toolCall("c1", "send_responses", { message: "Late summary." })];
      }
      return [{ text: "done" }];
    });
    const { sender, texts } = senderFor();
    await fixture.runner.handleIncoming(fixture.connection, sender, incoming("do it"));
    assert.ok(
      texts.some((t) => t.includes("Late summary.")),
      `expected the nudged summary, got: ${JSON.stringify(texts)}`,
    );
    const chats = fixture.db.channelChats.listByChannel("ch_testchannel");
    const transcript = fixture.db.channelMessages.list(chats[0]!.id);
    assert.ok(
      transcript.some(
        (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("send_responses"),
      ),
      "expected the summary nudge in the transcript",
    );
  });

  it("switches agents with /@switch and reports structured errors", async () => {
    fixture = build(() => [{ text: "done" }]);
    const created = fixture.customAgents.create({
      name: "researcher",
      description: "Research specialist",
      systemPrompt: "You research.",
      selectedTools: [],
    });
    const { sender, texts } = senderFor();
    await fixture.runner.handleIncoming(fixture.connection, sender, incoming("/@switch researcher"));
    assert.ok(texts.some((t) => t.includes('switched to "researcher"')), JSON.stringify(texts));
    const chats = fixture.db.channelChats.listByChannel("ch_testchannel");
    assert.equal(chats[0]!.agentId, created.id);

    texts.length = 0;
    await fixture.runner.handleIncoming(fixture.connection, sender, incoming("/@switch nope"));
    assert.ok(texts.some((t) => t.includes('Unknown agent "nope"')), JSON.stringify(texts));

    texts.length = 0;
    await fixture.runner.handleIncoming(fixture.connection, sender, incoming("/@switch default"));
    assert.ok(texts.some((t) => t.includes("Default Agent")), JSON.stringify(texts));
    assert.equal(fixture.db.channelChats.get(chats[0]!.id)!.agentId, null);
  });

  it("starts a fresh chat with /@new-chat", async () => {
    fixture = build(() => [{ text: "done" }]);
    const { sender, texts } = senderFor();
    await fixture.runner.handleIncoming(fixture.connection, sender, incoming("first"));
    const before = fixture.db.channelChats.listByChannel("ch_testchannel");
    assert.equal(before.length, 1);
    texts.length = 0;
    await fixture.runner.handleIncoming(fixture.connection, sender, incoming("/@new-chat"));
    const after = fixture.db.channelChats.listByChannel("ch_testchannel");
    assert.equal(after.length, 2);
    assert.ok(texts.some((t) => t.includes("New chat started")), JSON.stringify(texts));
  });

  it("routes submit_plan through /@ok and /@no", async () => {
    fixture = build((msgs) => {
      if (!hasToolCall(msgs, "submit_plan")) {
        return [toolCall("p1", "submit_plan", { plan: "Step 1: do X." })];
      }
      const decision = lastToolResult(msgs, "submit_plan") as {
        data?: { decision?: string };
      } | null;
      if (decision?.data?.decision === "approved") {
        if (!hasToolCall(msgs, "send_responses")) {
          return [toolCall("c1", "send_responses", { message: "Approved — executing." })];
        }
        return [{ text: "done" }];
      }
      return [{ text: "waiting" }];
    });
    const { sender, texts } = senderFor();
    const turn = fixture.runner.handleIncoming(fixture.connection, sender, incoming("plan it"));
    await waitFor(() => texts.some((t) => t.includes("Step 1: do X.")));
    assert.ok(
      texts.some((t) => t.includes("/@ok") && t.includes("/@no")),
      `expected approval instructions, got: ${JSON.stringify(texts)}`,
    );
    await fixture.runner.handleIncoming(fixture.connection, sender, incoming("/@ok"));
    await turn;
    assert.ok(texts.some((t) => t.includes("Plan approved")), JSON.stringify(texts));
    assert.ok(texts.some((t) => t.includes("Approved — executing.")), JSON.stringify(texts));
  });

  it("tells the channel a task is already running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixture = build(async (msgs, call) => {
      // Park the FIRST provider invocation until the test releases it, so the
      // second message deterministically lands while the turn is still running.
      if (call === 0) await gate;
      if (!hasToolCall(msgs, "send_responses")) {
        return [toolCall("c1", "send_responses", { message: "Slow task done." })];
      }
      return [{ text: "done" }];
    });
    const { sender, texts } = senderFor();
    const first = fixture.runner.handleIncoming(fixture.connection, sender, incoming("slow please"));
    // Let the first turn start (it blocks inside the parked provider call).
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fixture.runner.handleIncoming(fixture.connection, sender, incoming("are you there?"));
    assert.ok(
      texts.some((t) => t.includes("already running")),
      `expected a busy status reply, got: ${JSON.stringify(texts)}`,
    );
    release();
    await first;
    assert.ok(texts.some((t) => t.includes("Slow task done.")), JSON.stringify(texts));
  });

  it("short-circuits ask_question_to_user on channel turns", async () => {
    fixture = build((msgs) => {
      if (!hasToolCall(msgs, "ask_question_to_user")) {
        return [toolCall("q1", "ask_question_to_user", {
          questions: [{ question: "Which color?", context: "Theme", options: ["red", "blue"] }],
        })];
      }
      const result = lastToolResult(msgs, "ask_question_to_user") as {
        data?: { decision?: string; message?: string };
      } | null;
      assert.equal(result?.data?.decision, "channel_unavailable");
      assert.match(result?.data?.message ?? "", /send_responses/);
      if (!hasToolCall(msgs, "send_responses")) {
        return [toolCall("c1", "send_responses", { message: "Which color do you prefer: red or blue?" })];
      }
      return [{ text: "done" }];
    });
    const { sender, texts } = senderFor();
    await fixture.runner.handleIncoming(fixture.connection, sender, incoming("theme my app"));
    assert.ok(
      texts.some((t) => t.includes("Which color")),
      JSON.stringify(texts),
    );
  });

  it("delivers attach_files output to the channel", async () => {
    fixture = build(() => [{ text: "done" }]);
    // Seed a real file in the workspace, then drive attach_files through the tool path.
    const notePath = path.join(fixture.dir, "note.txt");
    fs.writeFileSync(notePath, "hello");
    const tools = createToolRegistry();
    const sent: string[] = [];
    const files: string[] = [];
    const result = await tools.execute(
      "attach_files",
      { file_paths: [notePath] },
      {
        workspaceRoot: fixture.dir,
        shellTimeoutMs: 10_000,
        chatId: "chat",
        channel: {
          kind: "telegram",
          channelId: "ch_testchannel",
          channelName: "Test",
          userKey: "tg:42",
          userLabel: "Tester",
          sendMessage: async (text: string) => {
            sent.push(text);
          },
          sendFiles: async (items) => {
            for (const item of items) files.push(item.filename);
            return { delivered: items.length, errors: [] };
          },
        },
      },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(files, ["note.txt"]);
    const data = result.data as { channel_delivered?: number };
    assert.equal(data.channel_delivered, 1);
    void sent;
  });
});
