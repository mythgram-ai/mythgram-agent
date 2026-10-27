import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../database/schema.js";
import { AppStateRepo } from "../database/repositories/appStateRepo.js";
import { normalizeTtsProvider, TTS_BUILTIN_KINDS } from "./types.js";
import { TtsStore } from "./store.js";
import { TtsManager } from "./manager.js";
import { OpenRouterTtsProvider } from "./providers/openrouter.js";
import { KittenMlTtsProvider } from "./providers/kittenml.js";
import { SarvamTtsProvider } from "./providers/sarvam.js";
import { MiniMaxTtsProvider } from "./providers/minimax.js";
import { GoogleTtsProvider } from "./providers/google.js";
import { ElevenLabsTtsProvider } from "./providers/elevenlabs.js";
import {
  LocalTtsProvider,
  LOCAL_TTS_DEFAULT_BASE_URL,
  normalizeLocalTtsBaseUrl,
} from "./providers/localtts.js";
import { LocalTtsInstallError, LocalTtsInstaller } from "./installer.js";
import os from "node:os";

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

const audioResponse = (bytes: number[]): Response =>
  new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "audio/mpeg", "x-model": "openai/gpt-4o-mini-tts" },
  });

describe("tts — provider normalization", () => {
  it("rejects unknown kinds", () => {
    assert.equal(normalizeTtsProvider({ kind: "not-a-provider" }, { id: "x", now: 1 }), null);
    assert.equal(normalizeTtsProvider(null, { id: "x", now: 1 }), null);
  });

  it("accepts both snake_case (wire) and camelCase (stored) field spellings", () => {
    const wire = normalizeTtsProvider(
      { kind: "openrouter", api_key: "sk-1", base_url: "https://x/v1/", models: ["a", "a", "b"] },
      { id: "x", now: 1 },
    );
    const stored = normalizeTtsProvider(
      { kind: "openrouter", apiKey: "sk-1", baseUrl: "https://x/v1/", models: ["a", "b"] },
      { id: "x", now: 1 },
    );
    assert.equal(wire!.apiKey, "sk-1");
    assert.equal(wire!.baseUrl, "https://x/v1");
    assert.deepEqual(wire!.models, ["a", "b"]);
    assert.equal(stored!.apiKey, "sk-1");
    assert.equal(stored!.baseUrl, "https://x/v1");
  });

  it("drops Content-Type headers and keeps custom ones", () => {
    const config = normalizeTtsProvider(
      { kind: "custom", headers: [{ key: "Content-Type", value: "x" }, { key: "X-Org", value: "1" }] },
      { id: "x", now: 1 },
    );
    assert.deepEqual(config!.headers, [{ key: "X-Org", value: "1" }]);
  });
});

describe("tts — persistent store (SQLite app_state)", () => {
  let store: TtsStore;

  beforeEach(() => {
    store = new TtsStore(testRepo());
  });

  it("seeds one config per built-in provider, idempotently", () => {
    store.ensureBuiltins();
    store.ensureBuiltins();
    const list = store.list();
    assert.equal(list.length, TTS_BUILTIN_KINDS.length);
    assert.ok(list.some((c) => c.id === "openrouter"));
    assert.ok(list.some((c) => c.id === "kittenml"));
    assert.equal(store.getByKind("openrouter")!.baseUrl, "https://openrouter.ai/api/v1");
  });

  it("treats a present-but-empty apiKey as a clear and an absent one as keep", () => {
    store.ensureBuiltins();
    store.update("openrouter", { apiKey: "sk-secret" });
    assert.equal(store.get("openrouter")!.apiKey, "sk-secret");
    // Absent keeps the stored key.
    store.update("openrouter", { model: "m2" });
    assert.equal(store.get("openrouter")!.apiKey, "sk-secret");
    // Present-but-empty clears it.
    store.update("openrouter", { apiKey: "" });
    assert.equal(store.get("openrouter")!.apiKey, "");
  });

  it("creates and deletes custom providers but refuses to delete built-ins", () => {
    store.ensureBuiltins();
    const base = TTS_BUILTIN_KINDS.length;
    const custom = store.createCustom({ name: "Local", baseUrl: "http://localhost:8880/v1", voices: ["alloy"] });
    assert.ok(custom.id.startsWith("tts_"));
    assert.equal(custom.baseUrl, "http://localhost:8880/v1");
    assert.equal(store.list().length, base + 1);
    assert.equal(store.delete("openrouter"), false);
    assert.equal(store.delete(custom.id), true);
    assert.equal(store.list().length, base);
  });

  it("requires a base URL for a custom provider", () => {
    assert.throws(() => store.createCustom({ name: "Nope" }), /base URL/);
  });
});

describe("tts — manager", () => {
  it("lists live models with their supported voices (OpenRouter)", async () => {
    const repo = testRepo();
    const { fetchFn, calls } = stubFetch((url) => {
      assert.match(url, /output_modalities=speech/);
      return jsonResponse({
        data: [{ id: "m1", name: "Model One", supported_voices: ["alpha", "beta"] }],
      });
    });
    const manager = new TtsManager({ appState: repo, openrouterApiKey: "sk", fetchFn });

    const models = await manager.listModels("openrouter");
    assert.equal(models.length, 1);
    assert.equal(models[0]!.id, "m1");
    assert.deepEqual(models[0]!.voices.map((v) => v.id), ["alpha", "beta"]);
    assert.equal(calls.length, 1);
  });

  it("synthesizes speech and returns base64 audio (OpenRouter)", async () => {
    const repo = testRepo();
    const { fetchFn, calls } = stubFetch(() => audioResponse([1, 2, 3, 4]));
    const manager = new TtsManager({ appState: repo, openrouterApiKey: "sk", fetchFn });

    const result = await manager.synthesize("openrouter", { text: "Hello world" });
    assert.equal(result.providerKind, "openrouter");
    assert.equal(result.model, "openai/gpt-4o-mini-tts");
    assert.equal(result.format, "mp3");
    assert.equal(Buffer.from(result.base64, "base64").toString("hex"), "01020304");
    assert.match(result.filename, /^openrouter-\d+\.mp3$/);

    const [call] = calls;
    assert.match(call!.url, /\/audio\/speech$/);
    const body = JSON.parse(String(call!.init.body));
    assert.equal(body.model, "openai/gpt-4o-mini-tts");
    assert.equal(body.input, "Hello world");
    assert.equal(body.voice, "alloy");
    assert.equal(body.response_format, "mp3");
  });

  it("uses the stored per-provider key over the env fallback", async () => {
    const repo = testRepo();
    const { fetchFn, calls } = stubFetch(() => audioResponse([9]));
    const manager = new TtsManager({ appState: repo, openrouterApiKey: "env-key", fetchFn });
    manager.update("openrouter", { apiKey: "stored-key" });

    await manager.synthesize("openrouter", { text: "hi" });
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer stored-key");
  });

  it("rejects empty text and unknown providers", async () => {
    const manager = new TtsManager({ appState: testRepo(), fetchFn: stubFetch(() => audioResponse([1])).fetchFn });
    await assert.rejects(() => manager.synthesize("openrouter", { text: "   " }), /Text is required/);
    await assert.rejects(() => manager.synthesize("nope", { text: "hi" }), /Unknown TTS provider/);
  });
});

describe("tts — KittenML provider", () => {
  it("falls back to the documented models when /models is unavailable", async () => {
    const { fetchFn } = stubFetch(() => jsonResponse({ error: { message: "forbidden" } }, 403));
    const provider = new KittenMlTtsProvider({ fetchFn });
    const models = await provider.listModels({ apiKey: "sk" });
    assert.equal(models.length, 4);
    assert.ok(models.some((m) => m.id === "kitten-tts-2-latest"));
  });

  it("lists live voices and falls back to the 0.8 catalog for 0.8 models", async () => {
    const { fetchFn } = stubFetch((url) => {
      // The 0.8 models have no voice listing: the endpoint rejects them.
      if (url.includes("kitten-tts-mini-0.8")) return jsonResponse({ error: "unsupported" }, 400);
      if (url.includes("/voices")) {
        return jsonResponse({ data: [{ id: "maeve_cozy_female_22", name: "Maeve", language: "en" }] });
      }
      return jsonResponse({}, 404);
    });
    const provider = new KittenMlTtsProvider({ fetchFn });

    const voices = await provider.listVoices({ apiKey: "sk" }, "kitten-tts-2-latest");
    assert.deepEqual(voices.map((v) => v.id), ["maeve_cozy_female_22"]);

    const eight = await provider.listVoices({ apiKey: "sk" }, "kitten-tts-mini-0.8");
    assert.equal(eight.length, 8);
    assert.ok(eight.some((v) => v.id === "Bella"));
  });
});

describe("tts — new provider adapters", () => {
  it("Sarvam AI decodes the base64 audios array and uses the subscription-key header", async () => {
    const { fetchFn, calls } = stubFetch(() =>
      jsonResponse({ audios: [Buffer.from([5, 6, 7]).toString("base64")] }),
    );
    const provider = new SarvamTtsProvider({ fetchFn });
    const result = await provider.synthesize({
      apiKey: "sk",
      model: "bulbul:v3",
      input: "namaste",
      voice: "shubh",
      language: "hi-IN",
      responseFormat: "wav",
    });
    assert.equal(Buffer.from(result.bytes).toString("hex"), "050607");
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers["api-subscription-key"], "sk");
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.language_code, "hi-IN");
    assert.equal(body.output_audio_codec, "wav");
  });

  it("MiniMax decodes hex audio and posts to /v1/t2a_v2", async () => {
    const { fetchFn, calls } = stubFetch(() => jsonResponse({ data: { audio: "0a0b0c" }, base_resp: { status_code: 0 } }));
    const provider = new MiniMaxTtsProvider({ fetchFn });
    const result = await provider.synthesize({
      apiKey: "sk",
      model: "speech-2.8-hd",
      input: "hi",
      voice: "English_expressive_narrator",
      responseFormat: "mp3",
    });
    assert.equal(Buffer.from(result.bytes).toString("hex"), "0a0b0c");
    assert.match(calls[0]!.url, /\/v1\/t2a_v2$/);
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer sk");
  });

  it("Google Cloud TTS decodes audioContent and sends a Bearer token", async () => {
    const { fetchFn, calls } = stubFetch(() =>
      jsonResponse({ audioContent: Buffer.from([9, 9]).toString("base64") }),
    );
    const provider = new GoogleTtsProvider({ fetchFn });
    const result = await provider.synthesize({
      apiKey: "token",
      model: "Neural2",
      input: "hello",
      voice: "en-US-Neural2-C",
      responseFormat: "mp3",
    });
    assert.equal(Buffer.from(result.bytes).toString("hex"), "0909");
    assert.match(calls[0]!.url, /\/v1\/text:synthesize$/);
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.voice.languageCode, "en-US");
    assert.equal(body.audioConfig.audioEncoding, "MP3");
  });

  it("ElevenLabs requires a voice id and puts it in the URL path", async () => {
    const { fetchFn, calls } = stubFetch(() => audioResponse([1, 2]));
    const provider = new ElevenLabsTtsProvider({ fetchFn });
    await assert.rejects(
      () => provider.synthesize({ apiKey: "sk", model: "eleven_multilingual_v2", input: "hi" }),
      /voice id is required/,
    );
    const result = await provider.synthesize({
      apiKey: "sk",
      model: "eleven_multilingual_v2",
      input: "hi",
      voice: "JBFqnCBsd6RMkjVDRZzb",
    });
    assert.equal(result.format, "mp3");
    assert.match(calls[0]!.url, /\/v1\/text-to-speech\/JBFqnCBsd6RMkjVDRZzb\?output_format=mp3_44100_128$/);
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers["xi-api-key"], "sk");
  });
});

describe("tts — local-tts provider", () => {
  const wavResponse = (bytes: number[]): Response =>
    new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": "audio/wav" },
    });

  it("normalizes server root, /v1 and full speech URLs to the /v1 base", () => {
    assert.equal(normalizeLocalTtsBaseUrl("http://localhost:7878"), "http://localhost:7878/v1");
    assert.equal(normalizeLocalTtsBaseUrl("http://localhost:7878/v1/"), "http://localhost:7878/v1");
    assert.equal(
      normalizeLocalTtsBaseUrl("http://localhost:7878/v1/audio/speech"),
      "http://localhost:7878/v1",
    );
    assert.equal(normalizeLocalTtsBaseUrl(""), LOCAL_TTS_DEFAULT_BASE_URL);
  });

  it("sends only input (no model or voice) when no options are set", async () => {
    const { fetchFn, calls } = stubFetch(() => wavResponse([1, 2, 3]));
    const provider = new LocalTtsProvider({ baseUrl: "http://localhost:7878", fetchFn });

    const result = await provider.synthesize({ apiKey: "", model: "", input: "Hello" });

    assert.equal(Buffer.from(result.bytes).toString("hex"), "010203");
    assert.equal(result.format, "wav");
    assert.equal(result.model, "");
    assert.equal(calls[0]!.url, "http://localhost:7878/v1/audio/speech");
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { input: "Hello" });
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, undefined);
  });

  it("adds a Bearer key and the chosen response format", async () => {
    const { fetchFn, calls } = stubFetch(() => wavResponse([4, 5]));
    const provider = new LocalTtsProvider({ baseUrl: "http://localhost:7878/v1", fetchFn });

    await provider.synthesize({ apiKey: "secret", model: "", input: "hi", responseFormat: "wav" });

    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer secret");
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
      input: "hi",
      response_format: "wav",
    });
  });

  it("synthesizes through the manager without requiring a model", async () => {
    const { fetchFn, calls } = stubFetch(() => wavResponse([7, 8, 9]));
    const manager = new TtsManager({ appState: testRepo(), fetchFn });

    const result = await manager.synthesize("localtts", { text: "Hello local" });

    assert.equal(result.providerKind, "localtts");
    assert.equal(result.model, "");
    assert.equal(result.format, "wav");
    assert.equal(Buffer.from(result.base64, "base64").toString("hex"), "070809");
    assert.match(result.filename, /^local-tts-\d+\.wav$/);
    assert.equal(calls[0]!.url, "http://localhost:7878/v1/audio/speech");
    assert.equal(JSON.parse(String(calls[0]!.init.body)).input, "Hello local");
  });
});

describe("tts — local-tts one-click installer", () => {
  const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

  async function waitForState(installer: LocalTtsInstaller, expected: string) {
    const deadline = Date.now() + 2000;
    let last = await installer.status();
    while (Date.now() < deadline) {
      last = await installer.status();
      if (last.state === expected) return last;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${expected}; last state was ${last.state}`);
  }

  it("rejects an unknown install method", () => {
    const manager = new TtsManager({ appState: testRepo(), fetchFn: okFetch });
    const installer = new LocalTtsInstaller({ manager, dataDir: os.tmpdir(), fetchFn: okFetch });
    assert.throws(
      () => installer.start("apt"),
      (error: unknown) => error instanceof LocalTtsInstallError && error.code === "invalid_method",
    );
  });

  it("short-circuits when local-tts is already running and configures the provider", async () => {
    const manager = new TtsManager({ appState: testRepo(), fetchFn: okFetch });
    const installer = new LocalTtsInstaller({ manager, dataDir: os.tmpdir(), fetchFn: okFetch });

    installer.start("pypi");
    const status = await waitForState(installer, "running");

    assert.equal(status.reachable, true);
    assert.equal(status.baseUrl, LOCAL_TTS_DEFAULT_BASE_URL);
    assert.equal(manager.get("localtts")!.baseUrl, LOCAL_TTS_DEFAULT_BASE_URL);
    assert.equal(manager.get("localtts")!.enabled, true);
  });

  it("refuses a second install while one is in flight", () => {
    const manager = new TtsManager({ appState: testRepo(), fetchFn: okFetch });
    const installer = new LocalTtsInstaller({ manager, dataDir: os.tmpdir(), fetchFn: okFetch });

    installer.start("docker");
    assert.throws(
      () => installer.start("pypi"),
      (error: unknown) => error instanceof LocalTtsInstallError && error.code === "install_in_progress",
    );
  });

  it("reports idle when the server cannot be reached", async () => {
    const failing = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const manager = new TtsManager({ appState: testRepo(), fetchFn: failing });
    const installer = new LocalTtsInstaller({ manager, dataDir: os.tmpdir(), fetchFn: failing });

    const status = await installer.status();
    assert.equal(status.state, "idle");
    assert.equal(status.reachable, false);
  });
});

describe("tts — OpenRouter provider URL", () => {
  it("requests the speech-output models endpoint", () => {
    const provider = new OpenRouterTtsProvider();
    const url = (provider as unknown as { modelsUrl: (b: string) => string }).modelsUrl(
      "https://openrouter.ai/api/v1",
    );
    assert.equal(url, "https://openrouter.ai/api/v1/models?output_modalities=speech");
  });
});
