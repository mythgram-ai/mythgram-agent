import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CustomOpenAIProvider, buildCustomProvider, isCustomProviderId } from "./custom.js";

describe("custom OpenAI-compatible provider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(payload: unknown, status = 200): Array<{ url: string; headers: Record<string, string> }> {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return calls;
  }

  it("fetches <base>/models without an API key and merges custom headers", async () => {
    const calls = mockFetch({ data: [{ id: "alpha" }, { id: "beta" }] });
    const provider = new CustomOpenAIProvider({
      id: "custom_test",
      name: "Test",
      model: "",
      baseUrl: "https://api.example.com/v1/",
      headers: { "X-Org": "acme" },
    });
    const models = await provider.listModels("");
    assert.deepEqual(models.map((m) => m.id), ["alpha", "beta"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://api.example.com/v1/models");
    assert.equal(calls[0]!.headers.Authorization, undefined);
    assert.equal(calls[0]!.headers["X-Org"], "acme");
  });

  it("uses an absolute model fetch URL override and bearer auth", async () => {
    const calls = mockFetch([{ id: "gamma" }]);
    const provider = new CustomOpenAIProvider({
      id: "custom_test",
      name: "Test",
      model: "",
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret",
      modelsUrl: "https://catalog.example.com/models?all=1",
    });
    const models = await provider.listModels("secret");
    assert.deepEqual(models.map((m) => m.id), ["gamma"]);
    assert.equal(calls[0]!.url, "https://catalog.example.com/models?all=1");
    assert.equal(calls[0]!.headers.Authorization, "Bearer secret");
  });

  it("resolves a relative model fetch URL against the base URL", async () => {
    const calls = mockFetch({ data: [] });
    const provider = new CustomOpenAIProvider({
      id: "custom_test",
      name: "Test",
      model: "",
      baseUrl: "https://api.example.com/v1",
      modelsUrl: "catalog/models",
    });
    await provider.listModels("");
    assert.equal(calls[0]!.url, "https://api.example.com/v1/catalog/models");
  });

  it("rejects non-http model fetch URLs", async () => {
    const provider = new CustomOpenAIProvider({
      id: "custom_test",
      name: "Test",
      model: "",
      baseUrl: "https://api.example.com/v1",
      modelsUrl: "file:///etc/passwd",
    });
    await assert.rejects(provider.listModels(""), /http or https/i);
  });

  it("falls back to the OpenAI default base URL when none is set", async () => {
    const calls = mockFetch({ data: [] });
    const provider = new CustomOpenAIProvider({
      id: "custom_test",
      name: "Test",
      model: "",
      baseUrl: "",
    });
    await provider.listModels("");
    assert.equal(calls[0]!.url, "https://api.openai.com/v1/models");
  });

  it("surfaces provider HTTP failures", async () => {
    mockFetch({ error: "nope" }, 401);
    const provider = new CustomOpenAIProvider({
      id: "custom_test",
      name: "Test",
      model: "",
      baseUrl: "https://api.example.com/v1",
    });
    await assert.rejects(provider.listModels(""), /models error 401/i);
  });

  it("drops non-string modelsUrl values defensively", () => {
    const provider = buildCustomProvider({ id: "custom_x", modelsUrl: 123 });
    assert.ok(provider instanceof CustomOpenAIProvider);
  });

  it("recognizes custom-prefixed ids", () => {
    assert.equal(isCustomProviderId("custom_abc"), true);
    assert.equal(isCustomProviderId("openrouter"), false);
  });
});