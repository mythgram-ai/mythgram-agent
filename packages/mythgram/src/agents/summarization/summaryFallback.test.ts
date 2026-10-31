import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleProvider } from "../providers/base.js";
import { ollamaCloudProvider } from "../providers/ollamaCloud.js";
import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  Provider,
  StreamDelta,
} from "../providers/types.js";
import { runSummaryAgent } from "./runner.js";

const SUMMARY = "Goal: ship checkout. Done: cart path traced and fixed. Next: document the fix.";

function baseProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    metadata: { id: "test", label: "Test", defaultBaseUrl: "http://test" },
    async listModels() {
      return [];
    },
    async *streamChatCompletion(): AsyncGenerator<StreamDelta, void, unknown> {
      // default: an empty but finished stream (non-SSE-shaped servers yield nothing)
      yield { finishReason: "stop" };
    },
    ...overrides,
  };
}

function nonStreamingOk(text: string): ChatCompletionResult {
  return { text, reasoning: "", toolCalls: [], finishReason: "stop" };
}

function summaryRequest(provider: Provider, send: (event: string, data: Record<string, unknown>) => void = () => {}) {
  return {
    provider,
    model: "any-model",
    apiKey: "k",
    systemPrompt: "SYS",
    userMessage: "Summarize this",
    send,
  };
}

describe("summary agent provider fallback (non-GPT / non-SSE servers)", () => {
  it("falls back to non-streaming when the stream throws (strict-server 400)", async () => {
    const chunks: string[] = [];
    const provider = baseProvider({
      async *streamChatCompletion(): AsyncGenerator<StreamDelta, void, unknown> {
        throw new Error("Test API error 400: bad stream_options");
      },
      async chatCompletion(_options: ChatCompletionOptions): Promise<ChatCompletionResult> {
        return nonStreamingOk(SUMMARY);
      },
    });
    const outcome = await runSummaryAgent(
      summaryRequest(provider, (event, data) => {
        if (event === "summary_chunk") chunks.push(String(data.value));
      }),
    );
    assert.equal(outcome.streamOk, true);
    assert.equal(outcome.aborted, false);
    assert.equal(outcome.text, SUMMARY);
    assert.deepEqual(chunks, [SUMMARY]);
  });

  it("falls back when the stream finishes with no usable text", async () => {
    const provider = baseProvider({
      async chatCompletion(): Promise<ChatCompletionResult> {
        return nonStreamingOk(SUMMARY);
      },
    });
    const outcome = await runSummaryAgent(summaryRequest(provider));
    assert.equal(outcome.streamOk, true);
    assert.equal(outcome.text, SUMMARY);
  });

  it("reports provider_error when both streaming and fallback fail", async () => {
    const provider = baseProvider({
      async *streamChatCompletion(): AsyncGenerator<StreamDelta, void, unknown> {
        throw new Error("stream down");
      },
      async chatCompletion(): Promise<ChatCompletionResult> {
        throw new Error("non-stream down");
      },
    });
    const outcome = await runSummaryAgent(summaryRequest(provider));
    assert.equal(outcome.streamOk, false);
    assert.equal(outcome.aborted, false);
    assert.equal(outcome.error, "non-stream down");
  });

  it("keeps the legacy failure verbatim when the provider has no non-streaming path", async () => {
    const { chatCompletion: _dropped, ...legacy } = baseProvider({
      async *streamChatCompletion(): AsyncGenerator<StreamDelta, void, unknown> {
        throw new Error("stream down");
      },
    });
    void _dropped;
    const outcome = await runSummaryAgent(summaryRequest(legacy as Provider));
    assert.equal(outcome.streamOk, false);
    assert.equal(outcome.error, "stream down");
  });

  it("reports incomplete when the fallback itself returns tool calls", async () => {
    const provider = baseProvider({
      async chatCompletion(): Promise<ChatCompletionResult> {
        return {
          text: "",
          reasoning: "",
          toolCalls: [{ id: "1", type: "function", function: { name: "grep", arguments: "{}" } }],
          finishReason: "tool_calls",
        };
      },
    });
    const outcome = await runSummaryAgent(summaryRequest(provider));
    assert.equal(outcome.streamOk, false);
    assert.match(outcome.error ?? "", /tool calls/);
  });

  it("still succeeds from streaming alone without touching the fallback", async () => {
    let fallbackCalls = 0;
    const provider = baseProvider({
      async *streamChatCompletion(): AsyncGenerator<StreamDelta, void, unknown> {
        yield { text: SUMMARY };
      },
      async chatCompletion(): Promise<ChatCompletionResult> {
        fallbackCalls += 1;
        return nonStreamingOk("should never be used");
      },
    });
    const outcome = await runSummaryAgent(summaryRequest(provider));
    assert.equal(outcome.streamOk, true);
    assert.equal(outcome.text, SUMMARY);
    assert.equal(fallbackCalls, 0);
  });
});

/** Probe exposing the protected chunk parser for shape-tolerance tests. */
class ProbeProvider extends OpenAICompatibleProvider {
  public probe(event: Record<string, unknown>) {
    return this.parseChunk(event);
  }
}

describe("streaming chunk tolerance for non-OpenAI shapes", () => {
  const probe = new ProbeProvider({ id: "p", label: "P", defaultBaseUrl: "http://x" });

  it("reads full message objects when chunks carry message instead of delta", () => {
    const delta = probe.probe({
      choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
    });
    assert.equal(delta?.text, "hello");
    assert.equal(delta?.finishReason, "stop");
  });

  it("reads camelCase finishReason", () => {
    const delta = probe.probe({ choices: [{ delta: {}, finishReason: "length" }] });
    assert.equal(delta?.finishReason, "length");
  });

  it("reads Anthropic-style text deltas when no choices are present", () => {
    const delta = probe.probe({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "world" },
    });
    assert.equal(delta?.text, "world");
  });

  it("still ignores events with no usable content", () => {
    assert.equal(probe.probe({}), null);
    assert.equal(probe.probe({ choices: [{ delta: {} }] }), null);
  });
});

describe("base non-streaming completion with strict-server retry", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchOnce(responses: Response[]): { calls: Array<Record<string, unknown>>; urls: string[] } {
    const calls: Array<Record<string, unknown>> = [];
    const urls: string[] = [];
    let i = 0;
    globalThis.fetch = (async (url: string, init?: { body?: string }) => {
      urls.push(url);
      calls.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      const response = responses[Math.min(i++, responses.length - 1)]!;
      return response;
    }) as unknown as typeof fetch;
    return { calls, urls };
  }

  const json = (payload: unknown, status = 200): Response =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });

  const options: ChatCompletionOptions = {
    apiKey: "k",
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    effort: "high",
  };

  it("parses a standard non-streaming payload", async () => {
    mockFetchOnce([
      json({ choices: [{ message: { content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 5 } }),
    ]);
    const provider = new OpenAICompatibleProvider({ id: "t", label: "T", defaultBaseUrl: "https://x/v1" });
    const result = await provider.chatCompletion({ ...options, effort: undefined });
    assert.equal(result.text, "done");
    assert.equal(result.finishReason, "stop");
    assert.equal(result.usage?.prompt_tokens, 5);
    assert.deepEqual(result.toolCalls, []);
  });

  it("retries once with a minimal body after a strict-server 400", async () => {
    const { calls } = mockFetchOnce([
      new Response("bad fields", { status: 400 }),
      json({ choices: [{ message: { content: "recovered" }, finish_reason: "stop" }] }),
    ]);
    const provider = new OpenAICompatibleProvider({ id: "t", label: "T", defaultBaseUrl: "https://x/v1" });
    const result = await provider.chatCompletion(options);
    assert.equal(result.text, "recovered");
    assert.equal(calls.length, 2);
    // First attempt carries the subclass body (reasoning effort included).
    assert.equal((calls[0] as Record<string, unknown>).reasoning_effort, "high");
    // Retry is minimal: no streaming extras, no effort, no parallel_tool_calls.
    const retry = calls[1] as Record<string, unknown>;
    assert.equal(retry.model, "m");
    assert.ok(!("stream_options" in retry));
    assert.ok(!("reasoning_effort" in retry));
    assert.ok(!("parallel_tool_calls" in retry));
  });

  it("throws provider errors surfaced with HTTP 200", async () => {
    mockFetchOnce([json({ error: { message: "overloaded" } })]);
    const provider = new OpenAICompatibleProvider({ id: "t", label: "T", defaultBaseUrl: "https://x/v1" });
    await assert.rejects(() => provider.chatCompletion({ ...options, effort: undefined }), /overloaded/);
  });

  it("Ollama Cloud non-streaming parses the /api/chat object", async () => {
    const { calls, urls } = mockFetchOnce([
      json({
        message: { content: "all set" },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 12,
        eval_count: 3,
      }),
    ]);
    const result = await ollamaCloudProvider.chatCompletion!({
      ...options,
      effort: undefined,
      baseUrl: "https://ollama.com/api/v1",
    });
    assert.equal(result.text, "all set");
    assert.equal(result.finishReason, "stop");
    assert.equal(result.usage?.prompt_tokens, 12);
    assert.equal(result.usage?.completion_tokens, 3);
    assert.ok(urls[0]?.endsWith("/api/chat"));
    assert.equal((calls[0] as Record<string, unknown>).stream, false);
  });
});
