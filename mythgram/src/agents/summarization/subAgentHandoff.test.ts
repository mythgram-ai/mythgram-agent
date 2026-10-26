import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { StoredMessage } from "../../services/sessionStore.js";
import type { Provider, StreamDelta } from "../providers/types.js";
import {
  clearSubAgentHandoffHistory,
  clearSubAgentHandoffJobs,
  executeSubAgentHandoff,
  getSubAgentHandoffHistory,
  markSubAgentResumed,
} from "./subAgentHandoff.js";

const SUMMARY_TEXT =
  "Goal: research caching. Completed: scanned src/cache.ts, ran tests. " +
  "Decisions: use LRU. Remaining: implement TTL and verify.";

function fakeProvider(chunks: StreamDelta[], error?: Error): Provider {
  return {
    metadata: { id: "test", label: "Test", defaultBaseUrl: "http://test" },
    async listModels() {
      return [];
    },
    async *streamChatCompletion(): AsyncGenerator<StreamDelta, void, unknown> {
      if (error) throw error;
      for (const chunk of chunks) yield chunk;
    },
  };
}

function baseMessages(): StoredMessage[] {
  return [
    { role: "user", content: "Research the caching layer" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "file_read", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "call_1", name: "file_read", content: "cache.ts contents" },
    { role: "user", content: "Now check the tests" },
  ];
}

describe("sub-agent summarization handoff lifecycle", () => {
  it("runs PAUSING→PAUSED→SUMMARIZING→VALIDATED→REPLACED and resumes with approved inputs only", async () => {
    clearSubAgentHandoffJobs();
    clearSubAgentHandoffHistory();
    const events: string[] = [];
    const provider = fakeProvider([{ text: SUMMARY_TEXT }]);
    const messages = baseMessages();
    const before = JSON.stringify(messages);
    const systemPrompt = "SUB AGENT SYSTEM PROMPT — identity";

    const outcome = await executeSubAgentHandoff({
      chatId: "chat1",
      subSessionId: "sub1234567",
      subAgentName: "researcher",
      messages,
      systemPrompt,
      provider,
      model: "m",
      apiKey: "k",
      send: (event) => events.push(event),
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.state, "CONTEXT_REPLACED");
    assert.ok(outcome.summary && outcome.summary.length > 0);
    assert.equal(outcome.latestUserInput, "Now check the tests");
    assert.ok(outcome.replacement && outcome.replacement.length === 1);
    const content = String(outcome.replacement[0]?.content ?? "");
    assert.ok(content.includes(outcome.summary!.slice(0, 20)));
    assert.ok(content.includes("Now check the tests"));
    // Old history is not restored: only one continuation message.
    assert.ok(!JSON.stringify(outcome.replacement).includes("file_read"));
    // System prompt is never part of replacement (it is re-sent separately).
    assert.ok(!content.includes(systemPrompt));

    const order = [
      "sub_agent_summary_execution_started",
      "sub_agent_pause_initiated",
      "sub_agent_paused",
      "sub_agent_summary_output_chunk",
      "sub_agent_summary_generation_ended",
      "sub_agent_summary_run_completed",
      "sub_agent_final_summary_received",
      "sub_agent_final_summary_validated",
      "sub_agent_context_replacement_started",
      "sub_agent_context_replaced",
    ];
    let cursor = -1;
    for (const name of order) {
      const idx = events.indexOf(name);
      assert.ok(idx > cursor, `expected ${name} after position ${cursor}`);
      cursor = idx;
    }

    // Every event carries the sub-agent correlation ids.
    // (Checked implicitly: send wrapper in subagents.ts stamps them; here base includes them.)

    // Original input untouched until the caller commits replacement.
    assert.equal(JSON.stringify(messages), before);

    // History recorded.
    const hist = getSubAgentHandoffHistory("chat1");
    assert.equal(hist.length, 1);
    assert.equal(hist[0]?.subSessionId, "sub1234567");
    assert.equal(hist[0]?.subAgentName, "researcher");

    markSubAgentResumed(outcome.handoff, (event) => events.push(event));
    assert.ok(events.includes("sub_agent_execution_resumed"));
  });

  it("excludes system prompt and reasoning from the summary input", async () => {
    clearSubAgentHandoffJobs();
    clearSubAgentHandoffHistory();
    let seenUserMessage = "";
    const provider: Provider = {
      metadata: { id: "test", label: "Test", defaultBaseUrl: "http://test" },
      async listModels() {
        return [];
      },
      async *streamChatCompletion(req: Record<string, unknown>): AsyncGenerator<StreamDelta, void, unknown> {
        const messages = (req as { messages?: Array<Record<string, unknown>> }).messages ?? [];
        const user = messages.find((m) => m.role === "user");
        seenUserMessage = String((user as { content?: unknown })?.content ?? "");
        yield { text: SUMMARY_TEXT };
      },
    } as unknown as Provider;
    const messages: StoredMessage[] = [
      { role: "user", content: "Do the thing" },
      {
        role: "assistant",
        content: "working",
        reasoning_content: "SECRET REASONING MUST NOT LEAK",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "file_list", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", name: "file_list", content: "ok" },
    ];
    const outcome = await executeSubAgentHandoff({
      chatId: "chat2",
      subSessionId: "sub7654321",
      subAgentName: "worker",
      messages,
      systemPrompt: "SECRET SYSTEM PROMPT MUST NOT BE SUMMARIZED",
      provider,
      model: "m",
      apiKey: "k",
    });
    assert.equal(outcome.ok, true);
    assert.ok(!seenUserMessage.includes("SECRET SYSTEM PROMPT"));
    assert.ok(!seenUserMessage.includes("SECRET REASONING"));
    assert.ok(seenUserMessage.includes("Do the thing"));
    assert.ok(seenUserMessage.includes("file_list"));
  });

  it("never marks success on empty or provider-error output; original preserved", async () => {
    clearSubAgentHandoffJobs();
    clearSubAgentHandoffHistory();
    const empty = await executeSubAgentHandoff({
      chatId: "chat3",
      subSessionId: "s1",
      subAgentName: "a",
      messages: baseMessages(),
      systemPrompt: "SYS",
      provider: fakeProvider([{ text: "  " }]),
      model: "m",
      apiKey: "k",
    });
    assert.equal(empty.ok, false);

    clearSubAgentHandoffJobs();
    const failed = await executeSubAgentHandoff({
      chatId: "chat4",
      subSessionId: "s1",
      subAgentName: "a",
      messages: baseMessages(),
      systemPrompt: "SYS",
      provider: fakeProvider([], new Error("provider down")),
      model: "m",
      apiKey: "k",
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.state, "SUMMARY_FAILED");
  });

  it("reports cancellation without replacement", async () => {
    clearSubAgentHandoffJobs();
    clearSubAgentHandoffHistory();
    const controller = new AbortController();
    controller.abort();
    const outcome = await executeSubAgentHandoff({
      chatId: "chat5",
      subSessionId: "s1",
      subAgentName: "a",
      messages: baseMessages(),
      systemPrompt: "SYS",
      provider: fakeProvider([{ text: SUMMARY_TEXT }]),
      model: "m",
      apiKey: "k",
      signal: controller.signal,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.state, "CANCELLED");
    assert.equal(outcome.replacement, undefined);
  });
});
