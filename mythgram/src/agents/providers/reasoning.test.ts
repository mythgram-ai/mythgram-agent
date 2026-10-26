import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  EFFORT_PRESETS,
  normalizeEffort,
  reasoningEffortValue,
  applyReasoningEffort,
  openRouterEffort,
} from "./reasoning.js";
import { OpenAICompatibleProvider } from "./base.js";
import { openRouterProvider } from "./openrouter.js";
import { cohereProvider } from "./cohere.js";
import type { ChatCompletionOptions, Provider } from "./types.js";

describe("reasoning effort helpers", () => {
  it("exposes the four presets in order", () => {
    assert.deepEqual([...EFFORT_PRESETS], ["low", "medium", "high", "max"]);
  });

  it("normalizeEffort lower-cases presets and trims", () => {
    assert.equal(normalizeEffort("HIGH"), "high");
    assert.equal(normalizeEffort("  Medium "), "medium");
    assert.equal(normalizeEffort("low"), "low");
    assert.equal(normalizeEffort("max"), "max");
  });

  it("normalizeEffort forwards custom strings verbatim (trimmed)", () => {
    assert.equal(normalizeEffort("  minimal "), "minimal");
    assert.equal(normalizeEffort("xhigh"), "xhigh");
  });

  it("normalizeEffort returns undefined for empty / non-string input", () => {
    assert.equal(normalizeEffort(""), undefined);
    assert.equal(normalizeEffort("   "), undefined);
    assert.equal(normalizeEffort(undefined), undefined);
    assert.equal(normalizeEffort(null), undefined);
    assert.equal(normalizeEffort(42), undefined);
  });

  it("reasoningEffortValue aliases max -> high, passes the rest through", () => {
    assert.equal(reasoningEffortValue("max"), "high");
    assert.equal(reasoningEffortValue("high"), "high");
    assert.equal(reasoningEffortValue("medium"), "medium");
    assert.equal(reasoningEffortValue("low"), "low");
    assert.equal(reasoningEffortValue("minimal"), "minimal");
  });

  it("applyReasoningEffort sets the flat field and no-ops when empty", () => {
    assert.deepEqual(applyReasoningEffort({ a: 1 }, "high"), { a: 1, reasoning_effort: "high" });
    assert.deepEqual(applyReasoningEffort({ a: 1 }, "max"), { a: 1, reasoning_effort: "high" });
    assert.deepEqual(applyReasoningEffort({ a: 1 }, "xhigh"), { a: 1, reasoning_effort: "xhigh" });
    assert.deepEqual(applyReasoningEffort({ a: 1 }, ""), { a: 1 });
    assert.deepEqual(applyReasoningEffort({ a: 1 }, undefined), { a: 1 });
  });

  it("openRouterEffort builds the nested object, aliasing max", () => {
    assert.deepEqual(openRouterEffort("medium"), { effort: "medium" });
    assert.deepEqual(openRouterEffort("max"), { effort: "high" });
    assert.equal(openRouterEffort(""), undefined);
    assert.equal(openRouterEffort(undefined), undefined);
  });
});

/**
 * Capture the exact JSON body a provider puts on the wire by mocking `fetch`.
 * Drives `streamChatCompletion` to completion against a minimal SSE stream.
 */
function mockFetchCapture(): { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    calls.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  return { calls };
}

async function drain(provider: Provider, options: ChatCompletionOptions): Promise<void> {
  for await (const _delta of provider.streamChatCompletion(options)) {
    // consume the stream to completion
  }
}

const baseOptions: ChatCompletionOptions = {
  apiKey: "k",
  model: "some-model",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
};

describe("provider request bodies carry effort + temperature", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("OpenAI-compatible base sends reasoning_effort and temperature", async () => {
    const { calls } = mockFetchCapture();
    const provider = new OpenAICompatibleProvider({
      id: "t",
      label: "T",
      defaultBaseUrl: "https://example.com/v1",
    });
    await drain(provider, { ...baseOptions, temperature: 0.9, effort: "high" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].reasoning_effort, "high");
    assert.equal(calls[0].temperature, 0.9);
  });

  it("base aliases max -> high and defaults temperature to 0.2", async () => {
    const { calls } = mockFetchCapture();
    const provider = new OpenAICompatibleProvider({
      id: "t",
      label: "T",
      defaultBaseUrl: "https://example.com/v1",
    });
    await drain(provider, { ...baseOptions, effort: "max" });
    assert.equal(calls[0].reasoning_effort, "high");
    assert.equal(calls[0].temperature, 0.2);
  });

  it("base omits reasoning_effort when no effort is set (unsupported models run normally)", async () => {
    const { calls } = mockFetchCapture();
    const provider = new OpenAICompatibleProvider({
      id: "t",
      label: "T",
      defaultBaseUrl: "https://example.com/v1",
    });
    await drain(provider, { ...baseOptions, temperature: 0.5 });
    assert.equal("reasoning_effort" in calls[0], false);
    assert.equal(calls[0].temperature, 0.5);
  });

  it("OpenRouter uses the nested reasoning object, not the flat field", async () => {
    const { calls } = mockFetchCapture();
    await drain(openRouterProvider, { ...baseOptions, effort: "max", temperature: 0.3 });
    assert.equal("reasoning_effort" in calls[0], false);
    assert.deepEqual(calls[0].reasoning, { effort: "high" });
    assert.equal(calls[0].temperature, 0.3);
  });

  it("OpenRouter omits reasoning entirely when no effort is set", async () => {
    const { calls } = mockFetchCapture();
    await drain(openRouterProvider, { ...baseOptions });
    assert.equal("reasoning" in calls[0], false);
    assert.equal("reasoning_effort" in calls[0], false);
  });

  it("Cohere forwards reasoning_effort on its trimmed body", async () => {
    const { calls } = mockFetchCapture();
    await drain(cohereProvider, { ...baseOptions, effort: "medium" });
    assert.equal(calls[0].reasoning_effort, "medium");
    // Cohere never sends parallel_tool_calls.
    assert.equal("parallel_tool_calls" in calls[0], false);
  });
});
