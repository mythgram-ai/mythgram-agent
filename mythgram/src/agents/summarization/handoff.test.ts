import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { StoredMessage } from "../../services/sessionStore.js";
import type { Provider, StreamDelta } from "../providers/types.js";
import { clearHandoffJobs, executeHandoff, markResumed } from "./handoff.js";

const SUMMARY_TEXT =
  "Goal: build a landing page. Completed: hero section in index.html, verified by build. " +
  "Decisions: Tailwind for styling. Remaining: add pricing section and deploy.";

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
    { role: "user", content: "Build a landing page" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "file_write", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "call_1", name: "file_write", content: "wrote index.html" },
    { role: "user", content: "Add a hero section now" },
  ];
}

describe("summarization handoff lifecycle", () => {
  it("runs PAUSING→PAUSED→SUMMARIZING→VALIDATED→REPLACED and resumes with approved inputs only", async () => {
    clearHandoffJobs();
    const events: string[] = [];
    const provider = fakeProvider([{ text: SUMMARY_TEXT }]);
    const messages = baseMessages();
    const before = JSON.stringify(messages);

    const outcome = await executeHandoff({
      chatId: "chat1",
      messages,
      systemPrompt: "ACTIVE SYSTEM PROMPT",
      memoryActive: true,
      knowledgeActive: false,
      provider,
      model: "m",
      apiKey: "k",
      send: (event) => events.push(event),
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.state, "CONTEXT_REPLACED");
    assert.ok(outcome.summary && outcome.summary.length > 0);
    assert.equal(outcome.latestUserInput, "Add a hero section now");
    assert.ok(outcome.replacement && outcome.replacement.length === 1);
    const content = String(outcome.replacement[0]?.content ?? "");
    assert.ok(content.includes(outcome.summary!.slice(0, 20)));
    assert.ok(content.includes("Add a hero section now"));
    assert.ok(!content.includes("wrote index.html") || content.includes(outcome.summary!.slice(0, 10)));
    // Old history is not restored: only one continuation message.
    assert.ok(!JSON.stringify(outcome.replacement).includes("file_write"));

    // Required lifecycle events in order (no generic "completed" shortcut).
    const order = [
      "summary_execution_started",
      "main_agent_pause_initiated",
      "main_agent_paused",
      "summary_output_chunk",
      "summary_generation_ended",
      "summary_agent_run_completed",
      "final_summary_received",
      "final_summary_validated",
      "context_replacement_started",
      "main_agent_context_replaced",
    ];
    let cursor = -1;
    for (const name of order) {
      const idx = events.indexOf(name);
      assert.ok(idx > cursor, `expected ${name} after position ${cursor}`);
      cursor = idx;
    }

    // Original input untouched until the caller commits replacement.
    assert.equal(JSON.stringify(messages), before);

    markResumed(outcome.handoff, (event) => events.push(event));
    assert.ok(events.includes("main_agent_execution_resumed"));
  });

  it("never marks success on stream close without a final summary", async () => {
    clearHandoffJobs();
    const provider = fakeProvider([]);
    const outcome = await executeHandoff({
      chatId: "chat2",
      messages: baseMessages(),
      systemPrompt: "SYS",
      memoryActive: false,
      knowledgeActive: false,
      provider,
      model: "m",
      apiKey: "k",
    });
    assert.equal(outcome.ok, false);
    assert.ok(outcome.state === "SUMMARY_INCOMPLETE" || outcome.state === "SUMMARY_FAILED");
    assert.equal(outcome.replacement, undefined);
  });

  it("never marks success on empty or provider-error output; original preserved", async () => {
    clearHandoffJobs();
    const empty = await executeHandoff({
      chatId: "chat3",
      messages: baseMessages(),
      systemPrompt: "SYS",
      memoryActive: false,
      knowledgeActive: false,
      provider: fakeProvider([{ text: "  " }]),
      model: "m",
      apiKey: "k",
    });
    assert.equal(empty.ok, false);

    clearHandoffJobs();
    const failed = await executeHandoff({
      chatId: "chat4",
      messages: baseMessages(),
      systemPrompt: "SYS",
      memoryActive: false,
      knowledgeActive: false,
      provider: fakeProvider([], new Error("provider down")),
      model: "m",
      apiKey: "k",
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.state, "SUMMARY_FAILED");
  });

  it("reports cancellation without replacement", async () => {
    clearHandoffJobs();
    const controller = new AbortController();
    controller.abort();
    const outcome = await executeHandoff({
      chatId: "chat5",
      messages: baseMessages(),
      systemPrompt: "SYS",
      memoryActive: false,
      knowledgeActive: false,
      provider: fakeProvider([{ text: SUMMARY_TEXT }]),
      model: "m",
      apiKey: "k",
      signal: controller.signal,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.state, "CANCELLED");
    assert.equal(outcome.replacement, undefined);
  });

  it("duplicate terminal handling cannot double-commit (state gate)", async () => {
    clearHandoffJobs();
    const events: string[] = [];
    const provider = fakeProvider([{ text: SUMMARY_TEXT }]);
    const outcome = await executeHandoff({
      chatId: "chat6",
      messages: baseMessages(),
      systemPrompt: "SYS",
      memoryActive: false,
      knowledgeActive: false,
      provider,
      model: "m",
      apiKey: "k",
      send: (event) => events.push(event),
    });
    assert.equal(outcome.ok, true);
    const replacedCount = events.filter((e) => e === "main_agent_context_replaced").length;
    assert.equal(replacedCount, 1);
    markResumed(outcome.handoff, (event) => events.push(event));
    markResumed(outcome.handoff, (event) => events.push(event));
    assert.equal(events.filter((e) => e === "main_agent_execution_resumed").length, 1);
  });
});
