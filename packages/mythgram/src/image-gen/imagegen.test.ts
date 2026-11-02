import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../database/schema.js";
import { AppStateRepo } from "../database/repositories/appStateRepo.js";
import { normalizeImageProvider, IMAGE_BUILTIN_KINDS } from "./types.js";
import { ImageStore } from "./store.js";
import { ImageManager } from "./manager.js";
import { buildImageProvider } from "./registry.js";
import { OpenRouterImageProvider } from "./providers/openrouter.js";
import { GeminiImageProvider } from "./providers/gemini.js";
import { MiniMaxImageProvider } from "./providers/minimax.js";
import { ClipdropImageProvider } from "./providers/clipdrop.js";
import { PollinationsImageProvider } from "./providers/pollinations.js";
import { NvidiaImageProvider } from "./providers/nvidia.js";
import { CustomImageProvider } from "./providers/custom.js";

/** Build an in-memory app-state repository (the pattern every manager test uses). */
function testRepo(): AppStateRepo {
  const db = new Database(":memory:");
  applySchema(db);
  return new AppStateRepo(db);
}

/** A fetch stub that records requests and answers from a router function. */
function stubFetch(
  handler: (url: string, init: RequestInit) => Response,
): { fetchFn: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = ((input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(handler(url, init ?? {}));
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const pngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02];
const imageResponse = (bytes: number[] = pngBytes): Response =>
  new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "image/png" },
  });

const b64 = Buffer.from(pngBytes).toString("base64");

describe("image-gen — provider normalization", () => {
  it("rejects unknown kinds and accepts known ones", () => {
    assert.equal(normalizeImageProvider({ kind: "not-a-provider" }, { id: "x", now: 1 }), null);
    assert.equal(normalizeImageProvider(null, { id: "x", now: 1 }), null);
    const config = normalizeImageProvider(
      { kind: "openrouter", api_key: "sk-1", base_url: "https://x/v1/", aspect_ratio: "16:9" },
      { id: "x", now: 1 },
    );
    assert.equal(config!.apiKey, "sk-1");
    assert.equal(config!.baseUrl, "https://x/v1");
    assert.equal(config!.aspectRatio, "16:9");
  });

  it("drops unknown aspect ratios and Content-Type headers", () => {
    const config = normalizeImageProvider(
      {
        kind: "custom",
        aspect_ratio: "7:5",
        headers: [{ key: "Content-Type", value: "x" }, { key: "X-Org", value: "1" }],
      },
      { id: "x", now: 1 },
    );
    assert.equal(config!.aspectRatio, "1:1");
    assert.deepEqual(config!.headers, [{ key: "X-Org", value: "1" }]);
  });
});

describe("image-gen — persistent store (SQLite app_state)", () => {
  let store: ImageStore;

  beforeEach(() => {
    store = new ImageStore(testRepo());
  });

  it("seeds one config per built-in provider, idempotently", () => {
    store.ensureBuiltins();
    store.ensureBuiltins();
    const list = store.list();
    assert.equal(list.length, IMAGE_BUILTIN_KINDS.length);
    assert.ok(list.some((c) => c.id === "openrouter"));
    assert.ok(list.some((c) => c.id === "pollinations"));
    assert.equal(store.getByKind("openrouter")!.baseUrl, "https://openrouter.ai/api/v1");
  });

  it("treats a present-but-empty apiKey as a clear and an absent one as keep", () => {
    store.ensureBuiltins();
    store.update("openrouter", { apiKey: "sk-secret" });
    assert.equal(store.get("openrouter")!.apiKey, "sk-secret");
    store.update("openrouter", { model: "m2" });
    assert.equal(store.get("openrouter")!.apiKey, "sk-secret");
    store.update("openrouter", { apiKey: "" });
    assert.equal(store.get("openrouter")!.apiKey, "");
  });

  it("creates and deletes custom providers but refuses to delete built-ins", () => {
    store.ensureBuiltins();
    const base = IMAGE_BUILTIN_KINDS.length;
    const custom = store.createCustom({ name: "Local", baseUrl: "http://localhost:8880/v1", models: ["sdxl"] });
    assert.ok(custom.id.startsWith("img_"));
    assert.equal(store.list().length, base + 1);
    assert.equal(store.delete("openrouter"), false);
    assert.equal(store.delete(custom.id), true);
    assert.equal(store.list().length, base);
  });

  it("requires a base URL for a custom provider", () => {
    assert.throws(() => store.createCustom({ name: "Nope" }), /base URL/);
  });
});

describe("image-gen — registry", () => {
  it("materializes the adapter matching each kind", () => {
    const repo = testRepo();
    const store = new ImageStore(repo);
    store.ensureBuiltins();
    assert.ok(buildImageProvider(store.get("openrouter")!) instanceof OpenRouterImageProvider);
    assert.ok(buildImageProvider(store.get("gemini")!) instanceof GeminiImageProvider);
    assert.ok(buildImageProvider(store.get("minimax")!) instanceof MiniMaxImageProvider);
    assert.ok(buildImageProvider(store.get("clipdrop")!) instanceof ClipdropImageProvider);
    assert.ok(buildImageProvider(store.get("pollinations")!) instanceof PollinationsImageProvider);
    assert.ok(buildImageProvider(store.get("nvidia")!) instanceof NvidiaImageProvider);
  });
});

describe("image-gen — provider adapters", () => {
  it("OpenRouter lists image models and returns base64 images", async () => {
    const provider = new OpenRouterImageProvider({
      fetchFn: stubFetch((url) => {
        if (url.endsWith("/images/models")) {
          return jsonResponse({ data: [{ id: "google/gemini-2.5-flash-image", name: "Gemini" }] });
        }
        return jsonResponse({ data: [{ b64_json: b64, media_type: "image/png" }] });
      }).fetchFn,
    });
    const models = await provider.listModels({ apiKey: "k" });
    assert.deepEqual(models.map((m) => m.id), ["google/gemini-2.5-flash-image"]);
    const result = await provider.generate({ apiKey: "k", model: models[0]!.id, prompt: "hi", aspectRatio: "16:9" });
    assert.equal(result.format, "png");
    assert.deepEqual([...result.bytes], pngBytes);
  });

  it("OpenRouter sends the aspect ratio and model in the body", async () => {
    const stub = stubFetch(() => jsonResponse({ data: [{ b64_json: b64 }] }));
    const provider = new OpenRouterImageProvider({ fetchFn: stub.fetchFn });
    await provider.generate({ apiKey: "k", model: "m", prompt: "p", aspectRatio: "9:16" });
    const body = JSON.parse(String(stub.calls[0]!.init.body));
    assert.equal(body.model, "m");
    assert.equal(body.aspect_ratio, "9:16");
  });

  it("MiniMax calls /v1/image_generation and decodes base64", async () => {
    const stub = stubFetch(() =>
      jsonResponse({ data: { image_base64: [b64] }, base_resp: { status_code: 0 } }),
    );
    const provider = new MiniMaxImageProvider({ fetchFn: stub.fetchFn });
    const result = await provider.generate({ apiKey: "k", model: "image-01", prompt: "p", aspectRatio: "4:3" });
    assert.ok(stub.calls[0]!.url.endsWith("/v1/image_generation"));
    const body = JSON.parse(String(stub.calls[0]!.init.body));
    assert.equal(body.aspect_ratio, "4:3");
    assert.equal(body.response_format, "base64");
    assert.deepEqual([...result.bytes], pngBytes);
  });

  it("MiniMax surfaces base_resp errors", async () => {
    const provider = new MiniMaxImageProvider({
      fetchFn: stubFetch(() =>
        jsonResponse({ data: null, base_resp: { status_code: 1026, status_msg: "sensitive content" } }),
      ).fetchFn,
    });
    await assert.rejects(
      () => provider.generate({ apiKey: "k", model: "image-01", prompt: "p" }),
      /sensitive content/,
    );
  });

  it("Gemini Imagen uses :predict and reads bytesBase64Encoded", async () => {
    const stub = stubFetch(() => jsonResponse({ predictions: [{ bytesBase64Encoded: b64, mimeType: "image/png" }] }));
    const provider = new GeminiImageProvider({ fetchFn: stub.fetchFn });
    const result = await provider.generate({
      apiKey: "k",
      model: "imagen-4.0-generate-001",
      prompt: "p",
      aspectRatio: "1:1",
    });
    assert.ok(stub.calls[0]!.url.includes(":predict"));
    assert.deepEqual([...result.bytes], pngBytes);
  });

  it("Gemini image models use :generateContent and read inlineData", async () => {
    const stub = stubFetch(() =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType: "image/png", data: b64 } }] } }],
      }),
    );
    const provider = new GeminiImageProvider({ fetchFn: stub.fetchFn });
    const result = await provider.generate({
      apiKey: "k",
      model: "gemini-2.5-flash-image",
      prompt: "p",
    });
    assert.ok(stub.calls[0]!.url.includes(":generateContent"));
    assert.deepEqual([...result.bytes], pngBytes);
  });

  it("Clipdrop posts multipart and returns image bytes", async () => {
    const stub = stubFetch(() => imageResponse());
    const provider = new ClipdropImageProvider({ fetchFn: stub.fetchFn });
    const result = await provider.generate({ apiKey: "k", model: "", prompt: "p" });
    assert.ok(stub.calls[0]!.url.endsWith("/text-to-image/v1"));
    assert.equal((stub.calls[0]!.init.headers as Record<string, string>)["x-api-key"], "k");
    assert.deepEqual([...result.bytes], pngBytes);
  });

  it("Pollinations builds a GET url with dimensions and no key", async () => {
    const stub = stubFetch(() => imageResponse());
    const provider = new PollinationsImageProvider({ fetchFn: stub.fetchFn });
    await provider.generate({ apiKey: "", model: "flux", prompt: "a cat", aspectRatio: "16:9" });
    const url = stub.calls[0]!.url;
    assert.ok(url.startsWith("https://image.pollinations.ai/prompt/"));
    assert.ok(url.includes("width=768"));
    assert.ok(url.includes("height=432"));
    assert.ok(url.includes("model=flux"));
  });

  it("NVIDIA sends the model in the URL path", async () => {
    const stub = stubFetch(() => jsonResponse({ data: [{ b64_json: b64 }] }));
    const provider = new NvidiaImageProvider({ fetchFn: stub.fetchFn });
    const result = await provider.generate({
      apiKey: "nvapi-x",
      model: "black-forest-labs/flux.1-dev",
      prompt: "p",
    });
    assert.ok(
      stub.calls[0]!.url.endsWith("/v1/genai/black-forest-labs/flux.1-dev"),
      stub.calls[0]!.url,
    );
    assert.deepEqual([...result.bytes], pngBytes);
  });

  it("Custom provider posts to /images/generations with the configured headers", async () => {
    const stub = stubFetch(() => jsonResponse({ data: [{ b64_json: b64 }] }));
    const provider = new CustomImageProvider({
      id: "c",
      name: "Custom",
      baseUrl: "http://localhost:8880/v1",
      headers: { "X-Org": "1" },
      fetchFn: stub.fetchFn,
    });
    await provider.generate({ apiKey: "", model: "sdxl", prompt: "p" });
    assert.ok(stub.calls[0]!.url.endsWith("/images/generations"));
    assert.equal((stub.calls[0]!.init.headers as Record<string, string>)["X-Org"], "1");
  });
});

describe("image-gen — manager end to end", () => {
  let repo: AppStateRepo;
  let stub: ReturnType<typeof stubFetch>;
  let manager: ImageManager;

  beforeEach(() => {
    repo = testRepo();
    stub = stubFetch((url) => {
      if (url.includes("/images/models")) {
        return jsonResponse({ data: [{ id: "google/gemini-2.5-flash-image" }] });
      }
      if (url.includes("pollinations.ai")) return imageResponse();
      return jsonResponse({ data: [{ b64_json: b64, media_type: "image/png" }] });
    });
    manager = new ImageManager({ appState: repo, fetchFn: stub.fetchFn });
  });

  it("generates via an explicitly configured provider and returns base64", async () => {
    manager.update("openrouter", { apiKey: "sk-1", model: "google/gemini-2.5-flash-image" });
    const result = await manager.generate("openrouter", { prompt: "a cat", aspectRatio: "1:1" });
    assert.equal(result.providerId, "openrouter");
    assert.equal(result.providerName, "OpenRouter");
    assert.equal(result.format, "png");
    assert.equal(result.base64, b64);
    assert.equal(result.bytes, pngBytes.length);
    assert.ok(result.filename.endsWith(".png"));
  });

  it("auto-selects the keyless Pollinations provider when no keyed provider exists", async () => {
    stub.calls.length = 0;
    // Update the stub to serve binary images (Pollinations returns raw bytes).
    const selected = manager.selectProvider();
    assert.equal(selected?.id, "pollinations");
    const result = await manager.generateAuto({ prompt: "cat" });
    assert.equal(result.providerId, "pollinations");
    assert.equal(result.base64, b64);
  });

  it("throws a typed error when nothing is configured (custom-only disabled)", async () => {
    const appState = testRepo();
    // Seed only a disabled set: construct a manager then disable every provider.
    const m = new ImageManager({ appState });
    for (const provider of m.listPublic()) m.update(provider.id, { enabled: false });
    await assert.rejects(() => m.generateAuto({ prompt: "cat" }), /No image generation provider/);
  });

  it("reads and writes the agent image config", () => {
    assert.deepEqual(manager.getAgentConfig(), { providerId: "", model: "", aspectRatio: "1:1" });
    manager.updateAgentConfig({ providerId: "openrouter", aspectRatio: "16:9" });
    const config = manager.getAgentConfig();
    assert.equal(config.providerId, "openrouter");
    assert.equal(config.aspectRatio, "16:9");
  });
});
