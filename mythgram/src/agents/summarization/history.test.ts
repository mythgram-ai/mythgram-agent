import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { StoredMessage } from "../../services/sessionStore.js";
import type { Provider, StreamDelta } from "../providers/types.js";
import {
  clearHandoffHistory,
  clearHandoffJobs,
  executeHandoff,
  getHandoffHistory,
} from "./handoff.js";

const SUMMARY_A =
  "Goal: build a landing page. Completed: hero section in index.html, verified by build. " +
  "Remaining: pricing section and deploy.";
const SUMMARY_B =
  "Goal continued: pricing section added to pricing.html with monthly and yearly tiers. " +
  "Verified by typecheck. Remaining: deploy to production and smoke-test.";

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
    { role: "user", content: "Add a hero section now" },
  ];
}

describe("multi-run handoffs in one session", () => {
  it("records each successful run and serves session history oldest-first", async () => {
    clearHandoffJobs();
    clearHandoffHistory();
    const first = await executeHandoff({
      chatId: "multi1",
      messages: baseMessages(),
      systemPrompt: "SYS",
      memoryActive: false,
      knowledgeActive: false,
      provider: fakeProvider([{ text: SUMMARY_A }]),
      model: "m",
      apiKey: "k",
    });
    assert.equal(first.ok, true);

    // Second run after context refills: new snapshot, new handoff id, same chat.
    const grown: StoredMessage[] = [
      { role: "user", content: `<context_summary>\n${SUMMARY_A}\n</context_summary>\n\nAdd a hero section now` },
      { role: "user", content: "Now add pricing" },
    ];
    const second = await executeHandoff({
      chatId: "multi1",
      messages: grown,
      systemPrompt: "SYS",
      memoryActive: false,
      knowledgeActive: false,
      provider: fakeProvider([{ text: SUMMARY_B }]),
      model: "m",
      apiKey: "k",
    });
    assert.equal(second.ok, true);
    assert.notEqual(first.handoff.handoffId, second.handoff.handoffId);

    const history = getHandoffHistory("multi1");
    assert.equal(history.length, 2);
    assert.equal(history[0]?.handoffId, first.handoff.handoffId);
    assert.equal(history[1]?.handoffId, second.handoff.handoffId);
    assert.equal(history[0]?.summary, SUMMARY_A);
    assert.equal(history[1]?.summary, SUMMARY_B);
    // Latest user input tracked per run.
    assert.equal(history[1]?.latestUserInput, "Now add pricing");
  });

  it("records failures in history without blocking later successful runs", async () => {
    clearHandoffJobs();
    clearHandoffHistory();
    const failed = await executeHandoff({
      chatId: "multi2",
      messages: baseMessages(),
      systemPrompt: "SYS",
      memoryActive: false,
      knowledgeActive: false,
      provider: fakeProvider([], new Error("provider down")),
      model: "m",
      apiKey: "k",
    });
    assert.equal(failed.ok, false);

    const recovered = await executeHandoff({
      chatId: "multi2",
      messages: baseMessages(),
      systemPrompt: "SYS",
      memoryActive: false,
      knowledgeActive: false,
      provider: fakeProvider([{ text: SUMMARY_A }]),
      model: "m",
      apiKey: "k",
    });
    assert.equal(recovered.ok, true);

    const history = getHandoffHistory("multi2");
    assert.equal(history.length, 2);
    assert.equal(history[0]?.state, "SUMMARY_FAILED");
    assert.equal(history[1]?.state, "CONTEXT_REPLACED");
  });

  it("bounds history per chat and scopes by chat id", async () => {
    clearHandoffJobs();
    clearHandoffHistory();
    for (let i = 0; i < 3; i += 1) {
      const outcome = await executeHandoff({
        chatId: "multi3",
        messages: baseMessages(),
        systemPrompt: "SYS",
        memoryActive: false,
        knowledgeActive: false,
        provider: fakeProvider([{ text: `${SUMMARY_A} run ${i}` }]),
        model: "m",
        apiKey: "k",
      });
      assert.equal(outcome.ok, true);
    }
    assert.equal(getHandoffHistory("multi3").length, 3);
    assert.equal(getHandoffHistory("other-chat").length, 0);
  });
});
