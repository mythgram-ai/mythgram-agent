import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { StoredMessage } from "../../services/sessionStore.js";
import type { Provider, StreamDelta } from "../providers/types.js";
import {
  clearHandoffHistory,
  clearHandoffJobs,
  executeHandoff,
  getCustomHandoffHistory,
  getHandoffHistory,
  markResumed,
} from "./handoff.js";

const SUMMARY_CUSTOM =
  "Custom goal: research pricing tiers. Completed: collected three competitor plans with URLs. " +
  "Remaining: draft the comparison table for the custom agent's next step.";

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
    { role: "user", content: "Research competitor pricing" },
    { role: "user", content: "Summarize the three tiers" },
  ];
}

describe("custom-agent context summarization handoff", () => {
  it("compacts a custom agent turn exactly like the main agent (replacement + resume)", async () => {
    clearHandoffJobs();
    clearHandoffHistory();
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const outcome = await executeHandoff({
      chatId: "custom1",
      messages: baseMessages(),
      systemPrompt: "You are a custom research agent.",
      memoryActive: false,
      knowledgeActive: false,
      agent: "custom",
      customAgentId: "agent123456789012",
      customAgentName: "Researcher",
      provider: fakeProvider([{ text: SUMMARY_CUSTOM }]),
      model: "m",
      apiKey: "k",
      send: (event, data) => {
        events.push({ event, data });
      },
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.handoff.agent, "custom");
    assert.equal(outcome.handoff.customAgentId, "agent123456789012");
    assert.equal(outcome.handoff.customAgentName, "Researcher");
    assert.ok(outcome.replacement && outcome.replacement.length === 1);
    const content = String(outcome.replacement[0]?.content ?? "");
    assert.ok(content.includes("<context_summary>"));
    assert.ok(content.includes(SUMMARY_CUSTOM.trim().slice(0, 20)));

    // Lifecycle events carry the custom agent tag (backward-compatible main names kept).
    const started = events.find((e) => e.event === "summary_execution_started");
    assert.equal(started?.data.agent, "custom");
    assert.equal(started?.data.custom_agent_id, "agent123456789012");
    // Custom mirror events are emitted alongside the main names.
    assert.ok(events.some((e) => e.event === "custom_agent_paused"));
    assert.ok(events.some((e) => e.event === "custom_agent_context_replaced"));

    markResumed(outcome.handoff, (event, data) => {
      events.push({ event, data });
    });
    assert.ok(events.some((e) => e.event === "custom_agent_execution_resumed"));
  });

  it("tags history with the custom agent and serves a custom-only view", async () => {
    clearHandoffJobs();
    clearHandoffHistory();
    const main = await executeHandoff({
      chatId: "custom2",
      messages: baseMessages(),
      systemPrompt: "SYS",
      memoryActive: false,
      knowledgeActive: false,
      provider: fakeProvider([{ text: SUMMARY_CUSTOM }]),
      model: "m",
      apiKey: "k",
    });
    assert.equal(main.ok, true);

    const custom = await executeHandoff({
      chatId: "custom2",
      messages: baseMessages(),
      systemPrompt: "Custom SYS",
      memoryActive: false,
      knowledgeActive: false,
      agent: "custom",
      customAgentId: "agent999999999999",
      customAgentName: "Writer",
      provider: fakeProvider([{ text: SUMMARY_CUSTOM }]),
      model: "m",
      apiKey: "k",
    });
    assert.equal(custom.ok, true);

    const all = getHandoffHistory("custom2");
    assert.equal(all.length, 2);
    assert.equal(all[0]?.agent, "main");
    assert.equal(all[1]?.agent, "custom");
    assert.equal(all[1]?.customAgentId, "agent999999999999");
    assert.equal(all[1]?.customAgentName, "Writer");

    const onlyCustom = getCustomHandoffHistory("custom2");
    assert.equal(onlyCustom.length, 1);
    assert.equal(onlyCustom[0]?.handoffId, custom.handoff.handoffId);
  });

  it("defaults to main when no agent is supplied (backward compatible)", async () => {
    clearHandoffJobs();
    clearHandoffHistory();
    const outcome = await executeHandoff({
      chatId: "custom3",
      messages: baseMessages(),
      systemPrompt: "SYS",
      memoryActive: false,
      knowledgeActive: false,
      provider: fakeProvider([{ text: SUMMARY_CUSTOM }]),
      model: "m",
      apiKey: "k",
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.handoff.agent ?? "main", "main");
    const history = getHandoffHistory("custom3");
    assert.equal(history[0]?.agent, "main");
    assert.equal(getCustomHandoffHistory("custom3").length, 0);
  });
});
