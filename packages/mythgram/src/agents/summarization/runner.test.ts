import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Provider, StreamDelta } from "../providers/types.js";
import { runSummaryAgent } from "./runner.js";

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

describe("summary agent runner", () => {
  it("accumulates streamed chunks in order", async () => {
    const provider = fakeProvider([{ text: "Hello " }, { text: "world. " }, { text: "Done." }]);
    const seen: string[] = [];
    const outcome = await runSummaryAgent({
      provider,
      model: "m",
      apiKey: "k",
      systemPrompt: "sys",
      userMessage: "req",
      send: (event, data) => {
        if (event === "summary_chunk") seen.push(String(data.value));
      },
    });
    assert.equal(outcome.streamOk, true);
    assert.equal(outcome.text, "Hello world. Done.");
    assert.deepEqual(seen, ["Hello ", "world. ", "Done."]);
  });

  it("drops hidden reasoning and never exposes it", async () => {
    const provider = fakeProvider([{ reasoning: "secret thought" }, { text: "Final summary text here ok yes" }]);
    const seen: string[] = [];
    const outcome = await runSummaryAgent({
      provider,
      model: "m",
      apiKey: "k",
      systemPrompt: "sys",
      userMessage: "req",
      send: (event, data) => {
        if (event === "summary_chunk") seen.push(String(data.value));
      },
    });
    assert.equal(outcome.streamOk, true);
    assert.ok(!outcome.text.includes("secret thought"));
    assert.deepEqual(seen, ["Final summary text here ok yes"]);
  });

  it("reports provider errors as failure, never success", async () => {
    const provider = fakeProvider([], new Error("boom"));
    const outcome = await runSummaryAgent({
      provider,
      model: "m",
      apiKey: "k",
      systemPrompt: "sys",
      userMessage: "req",
    });
    assert.equal(outcome.streamOk, false);
    assert.equal(outcome.error, "boom");
  });

  it("reports explicit cancellation as aborted, never success", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = fakeProvider([{ text: "partial" }]);
    const outcome = await runSummaryAgent({
      provider,
      model: "m",
      apiKey: "k",
      systemPrompt: "sys",
      userMessage: "req",
      signal: controller.signal,
    });
    assert.equal(outcome.aborted, true);
    assert.equal(outcome.streamOk, false);
  });

  it("treats unexpected tool calls as incomplete, never success", async () => {
    const provider = fakeProvider([
      { toolCalls: [{ index: 0, id: "t1", function: { name: "file_list", arguments: "{}" } }] },
    ]);
    const outcome = await runSummaryAgent({
      provider,
      model: "m",
      apiKey: "k",
      systemPrompt: "sys",
      userMessage: "req",
    });
    assert.equal(outcome.streamOk, false);
    assert.match(outcome.error ?? "", /tool calls/);
  });

  it("captures final output even when finishReason arrives separately", async () => {
    const provider = fakeProvider([{ text: "A complete summary with enough length here." }, { finishReason: "stop" }]);
    const outcome = await runSummaryAgent({
      provider,
      model: "m",
      apiKey: "k",
      systemPrompt: "sys",
      userMessage: "req",
    });
    assert.equal(outcome.streamOk, true);
    assert.equal(outcome.finishReason, "stop");
    assert.ok(outcome.text.length > 0);
  });
});
