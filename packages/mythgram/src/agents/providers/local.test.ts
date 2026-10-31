import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_PROVIDER_ID,
  LMSTUDIO_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_BASE_URL,
  isLocalProviderId,
  localProvider,
  normalizeLocalBaseUrl,
} from "./local.js";
import { createProviderRegistry } from "./registry.js";
import type { ChatCompletionOptions } from "./types.js";

describe("local running models provider", () => {
  it("is registered with a stable id and localhost default", () => {
    const registry = createProviderRegistry();
    assert.ok(registry.has(LOCAL_PROVIDER_ID));
    assert.equal(localProvider.metadata.defaultBaseUrl, OLLAMA_DEFAULT_BASE_URL);
    assert.ok(isLocalProviderId("local"));
    assert.equal(isLocalProviderId("openrouter"), false);
  });

  it("normalizes bare hosts to their OpenAI /v1 endpoint", () => {
    assert.equal(
      normalizeLocalBaseUrl("http://localhost:11434", OLLAMA_DEFAULT_BASE_URL),
      "http://localhost:11434/v1",
    );
    assert.equal(
      normalizeLocalBaseUrl("http://localhost:11434/", OLLAMA_DEFAULT_BASE_URL),
      "http://localhost:11434/v1",
    );
    assert.equal(
      normalizeLocalBaseUrl("http://localhost:1234/v1", OLLAMA_DEFAULT_BASE_URL),
      "http://localhost:1234/v1",
    );
    assert.equal(
      normalizeLocalBaseUrl("http://192.168.1.10:1234/v1", OLLAMA_DEFAULT_BASE_URL),
      "http://192.168.1.10:1234/v1",
    );
    assert.equal(
      normalizeLocalBaseUrl("https://models.example.com/openai/v1", OLLAMA_DEFAULT_BASE_URL),
      "https://models.example.com/openai/v1",
    );
    assert.equal(normalizeLocalBaseUrl("", OLLAMA_DEFAULT_BASE_URL), OLLAMA_DEFAULT_BASE_URL);
    assert.equal(
      normalizeLocalBaseUrl(undefined, LMSTUDIO_DEFAULT_BASE_URL),
      LMSTUDIO_DEFAULT_BASE_URL,
    );
  });

  it("omits Authorization when no key is configured (local servers need none)", () => {
    const headers = (localProvider as unknown as { headers: (k: string) => Record<string, string> }).headers("");
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers["Content-Type"], "application/json");
    const authed = (localProvider as unknown as { headers: (k: string) => Record<string, string> }).headers("secret");
    assert.equal(authed.Authorization, "Bearer secret");
  });
});

describe("local provider request bodies", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchCapture(): { calls: Array<Record<string, unknown>>; urls: string[] } {
    const calls: Array<Record<string, unknown>> = [];
    const urls: string[] = [];
    globalThis.fetch = (async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
      urls.push(String(url));
      calls.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    return { calls, urls };
  }

  const baseOptions: ChatCompletionOptions = {
    apiKey: "",
    model: "llama3.1",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
  };

  it("targets the normalized local URL without auth headers", async () => {
    const { urls } = mockFetchCapture();
    for await (const _delta of localProvider.streamChatCompletion({
      ...baseOptions,
      baseUrl: "http://localhost:11434",
    })) {
      // consume
    }
    assert.equal(urls.length, 1);
    assert.ok(urls[0]!.startsWith("http://localhost:11434/v1/chat/completions"));
  });

  it("strips reasoning_effort so strict local servers do not 400", async () => {
    const { calls } = mockFetchCapture();
    for await (const _delta of localProvider.streamChatCompletion({
      ...baseOptions,
      effort: "high",
      temperature: 0.6,
    })) {
      // consume
    }
    assert.equal(calls.length, 1);
    assert.equal("reasoning_effort" in calls[0]!, false);
    assert.equal(calls[0]!.temperature, 0.6);
  });

  it("lists models without an API key and explains an unreachable server", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;
    await assert.rejects(
      localProvider.listModels("", "http://localhost:11434/v1"),
      /could not reach the local model server/i,
    );
  });
});
