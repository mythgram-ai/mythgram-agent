import { describe, it, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isTtsConfigured,
  synthesizeSpeechFile,
  fetchTtsModels,
  fetchTtsVoices,
  ttsNotConfiguredResult,
  TTS_OUTPUT_DIR,
} from "./engine.js";
import { ttsStudioStatus } from "./providers/local.js";
import { allTtsProviders, getTtsProvider, TTS_PROVIDER_IDS } from "./registry.js";
import type { TtsToolsConfig } from "./types.js";

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gptloop-tts-engine-"));
}

describe("tts engine", () => {
  after(() => {
    mock.restoreAll();
  });

  it("exposes every supported provider", () => {
    assert.deepEqual(
      [...TTS_PROVIDER_IDS].sort(),
      [
        "azure_speech",
        "custom",
        "elevenlabs",
        "google",
        "gradium",
        "inworld",
        "kittenml",
        "local",
        "minimax",
        "openrouter",
        "volcengine",
        "xai",
        "xiaomi_mimo",
      ].sort(),
    );
    for (const provider of allTtsProviders()) {
      assert.equal(getTtsProvider(provider.id), provider);
      assert.ok(provider.label.length > 0);
      assert.ok(provider.instructions.length > 0);
    }
  });

  it("requires a base URL for the local and custom providers and a key for cloud providers", () => {
    assert.equal(isTtsConfigured(undefined), false);
    assert.equal(isTtsConfigured({}), false);
    assert.equal(isTtsConfigured({ provider: "local" }), false);
    assert.equal(isTtsConfigured({ provider: "local", baseUrl: " http://127.0.0.1:8000/v1 " }), true);
    assert.equal(isTtsConfigured({ provider: "custom", baseUrl: "http://localhost:9999" }), true);
    assert.equal(isTtsConfigured({ provider: "openrouter" }), false);
    assert.equal(isTtsConfigured({ provider: "openrouter", apiKey: "sk-or" }), true);
    assert.equal(isTtsConfigured({ provider: "azure_speech", apiKey: "k" }), false); // region missing
    assert.equal(
      isTtsConfigured({ provider: "azure_speech", apiKey: "k", azureRegion: "eastus" }),
      true,
    );
    assert.equal(isTtsConfigured({ provider: "unknown" as never }), false);
  });

  it("builds a clear not-configured error naming what is missing", () => {
    const none = ttsNotConfiguredResult(undefined);
    assert.equal(none.code, "tts_not_configured");
    assert.match(none.message, /no provider selected/i);
    const noKey = ttsNotConfiguredResult({ provider: "elevenlabs" });
    assert.match(noKey.message, /API key/i);
  });

  it("saves generated audio under .gptloop/tts with the right extension", async () => {
    const workspace = makeWorkspace();
    mock.method(globalThis, "fetch", async () => {
      return new Response(new Uint8Array([9, 9, 9]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    try {
      const config: TtsToolsConfig = {
        provider: "custom",
        baseUrl: "http://localhost:9999",
        model: "my-tts",
        voice: "alloy",
      };
      const file = await synthesizeSpeechFile(config, "  Hello world  ", workspace);
      assert.equal(path.dirname(file.absolute_path), path.join(workspace, TTS_OUTPUT_DIR));
      assert.match(file.name, /^speech_.*\.mp3$/);
      assert.equal(file.content_type, "audio/mpeg");
      assert.equal(file.size, 3);
      assert.equal(file.model, "my-tts");
      assert.equal(file.voice, "alloy");
      assert.equal(fs.readFileSync(file.absolute_path).length, 3);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("rejects empty and oversized text before calling the provider", async () => {
    const workspace = makeWorkspace();
    let fetchCalls = 0;
    mock.method(globalThis, "fetch", async () => {
      fetchCalls += 1;
      return new Response(new Uint8Array([1]), { status: 200 });
    });
    try {
      const config: TtsToolsConfig = { provider: "custom", baseUrl: "http://localhost:9999" };
      await assert.rejects(
        () => synthesizeSpeechFile(config, "   ", workspace),
        /No speech text provided/,
      );
      await assert.rejects(
        () => synthesizeSpeechFile(config, "x".repeat(60_001), workspace),
        /too long/,
      );
      assert.equal(fetchCalls, 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("normalizes a bare TTS Studio origin to its /v1 speech root", async () => {
    const workspace = makeWorkspace();
    const calls: string[] = [];
    mock.method(globalThis, "fetch", async (input: unknown) => {
      calls.push(String(input));
      return new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    });
    try {
      await synthesizeSpeechFile(
        { provider: "local", baseUrl: "http://127.0.0.1:8000" },
        "Hi",
        workspace,
      );
      assert.equal(calls[0], "http://127.0.0.1:8000/v1/audio/speech");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("reads the TTS Studio service-info endpoint for the local status check", async () => {
    mock.method(globalThis, "fetch", async () => {
      return new Response(
        JSON.stringify({ status: "ok", service: "TTS Studio", auth_required: false }),
        { status: 200 },
      );
    });
    const ok = await ttsStudioStatus({ baseUrl: "http://127.0.0.1:8000/v1" });
    assert.equal(ok.reachable, true);
    assert.equal(ok.info?.service, "TTS Studio");

    mock.method(globalThis, "fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    const down = await ttsStudioStatus({ baseUrl: "http://127.0.0.1:8000/v1" });
    assert.equal(down.reachable, false);
    assert.match(down.error ?? "", /ECONNREFUSED/);
  });

  it("fetches live model and voice catalogs from providers that expose them", async () => {
    mock.method(globalThis, "fetch", async (input: unknown) => {
      const url = String(input);
      if (url.includes("openrouter.ai/api/v1/models")) {
        return new Response(
          JSON.stringify({ data: [{ id: "openai/gpt-4o-mini-tts", name: "GPT-4o Mini TTS" }] }),
          { status: 200 },
        );
      }
      if (url.includes("api.elevenlabs.io/v1/voices")) {
        return new Response(
          JSON.stringify({ voices: [{ voice_id: "v1", name: "Rachel", labels: { gender: "female" } }] }),
          { status: 200 },
        );
      }
      if (url.includes("api.elevenlabs.io/v1/models")) {
        return new Response(JSON.stringify([{ model_id: "eleven_multilingual_v2", name: "Multilingual v2" }]), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    });

    const models = await fetchTtsModels({ provider: "openrouter" });
    assert.deepEqual(models, [{ id: "openai/gpt-4o-mini-tts", label: "GPT-4o Mini TTS" }]);

    const voices = await fetchTtsVoices({ provider: "elevenlabs", apiKey: "key" });
    assert.deepEqual(voices, [
      { id: "v1", label: "Rachel", gender: "female", language: undefined, previewUrl: undefined },
    ]);

    // Providers without catalogs return empty lists, not errors.
    assert.deepEqual(await fetchTtsModels({ provider: "local" }), []);
    assert.deepEqual(await fetchTtsVoices({ provider: "volcengine", apiKey: "t" }), []);
  });
});
