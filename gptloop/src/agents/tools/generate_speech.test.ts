import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateSpeechTool } from "./generate_speech.js";
import { createToolRegistry } from "./index.js";
import type { ToolContext } from "./types.js";

function baseCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { workspaceRoot: "/tmp", shellTimeoutMs: 10_000, ...overrides };
}

interface CallLog {
  url: string;
  init?: RequestInit;
}

/** Create a throwaway workspace directory for file-writing tests. */
function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gptloop-tts-"));
}

describe("generate_speech tool", () => {
  let registry: ReturnType<typeof createToolRegistry>;

  before(() => {
    registry = createToolRegistry();
  });

  after(() => {
    mock.restoreAll();
  });

  it("is registered in the default tool registry and discoverable by the LLM", () => {
    assert.equal(registry.has("generate_speech"), true);
    const schemas = registry.schemas;
    const schema = schemas.find((s) => s.function.name === "generate_speech");
    assert.ok(schema, "generate_speech schema missing from registry");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.name, "generate_speech");
    assert.match(schema!.function.description, /spoken audio|speech/i);
    const params = schema!.function.parameters as Record<string, unknown>;
    assert.equal(params.type, "object");
    const properties = params.properties as Record<string, unknown>;
    assert.ok(properties.speech, "speech property missing");
    assert.equal((params.required as string[]).includes("speech"), true);
    assert.equal((params.additionalProperties ?? true), false);
  });

  it("returns a clear structured error when no TTS provider is connected", async () => {
    const result = await registry.execute("generate_speech", { speech: "Hello" }, baseCtx());
    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string };
    assert.equal(error.code, "tts_not_configured");
    assert.match(error.message, /TTS panel/i);
  });

  it("rejects an empty speech argument with a structured error (no crash)", async () => {
    const ctx = baseCtx({ tts: { provider: "local", baseUrl: "http://127.0.0.1:8000/v1" } });
    const result = await registry.execute("generate_speech", { speech: "   " }, ctx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "missing_speech");
  });

  it("rejects missing and extra arguments via the strict zod schema", async () => {
    const ctx = baseCtx({ tts: { provider: "local", baseUrl: "http://127.0.0.1:8000/v1" } });
    const missing = await registry.execute("generate_speech", {}, ctx);
    assert.equal(missing.ok, false);
    assert.equal((missing.error as { code: string }).code, "invalid_arguments");
    const extra = await registry.execute("generate_speech", { speech: "hi", voice: "alloy" }, ctx);
    assert.equal(extra.ok, false);
    assert.equal((extra.error as { code: string }).code, "invalid_arguments");
  });

  it("reports a clear error for a cloud provider without an API key", async () => {
    const ctx = baseCtx({ tts: { provider: "elevenlabs" } });
    const result = await registry.execute("generate_speech", { speech: "Hello" }, ctx);
    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string };
    assert.equal(error.code, "tts_failed");
    assert.match(error.message, /API key/i);
  });

  it("synthesizes through the local TTS Studio provider, saves the file, and emits the SSE event", async () => {
    const workspace = makeWorkspace();
    const calls: CallLog[] = [];
    mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      });
    });
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const ctx = baseCtx({
      workspaceRoot: workspace,
      tts: { provider: "local", baseUrl: "http://127.0.0.1:8000/v1" },
      emit: (event, data) => {
        events.push({ event, data });
      },
      toolCallId: "call_1",
      chatId: "chat_1",
    });

    try {
      const result = await registry.execute("generate_speech", { speech: "Hello there" }, ctx);
      assert.equal(result.ok, true);
      const data = result.data as {
        file: { name: string; path: string; absolute_path: string; size: number; content_type: string };
        provider: string;
      };
      assert.match(data.file.name, /^speech_.*\.mp3$/);
      assert.equal(data.file.size, 4);
      assert.equal(data.file.content_type, "audio/mpeg");
      assert.match(data.file.path, /^\.gptloop\/tts\//);
      assert.equal(data.provider, "local");

      // Exactly one OpenAI-compatible speech request with the plain text input.
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, "http://127.0.0.1:8000/v1/audio/speech");
      const body = JSON.parse(String(calls[0]!.init?.body)) as { input?: string };
      assert.equal(body.input, "Hello there");

      // The audio file really exists on disk in the workspace.
      assert.equal(fs.existsSync(data.file.absolute_path), true);

      // The SSE event for the live UI player was emitted with the tool-call id.
      assert.equal(events.length, 1);
      assert.equal(events[0]!.event, "generate_speech");
      const eventFile = events[0]!.data.file as { path: string };
      assert.equal(eventFile.path, data.file.path);
      assert.equal(events[0]!.data.tool_call_id, "call_1");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("surfaces provider HTTP failures as a structured tts_failed error", async () => {
    const workspace = makeWorkspace();
    mock.method(globalThis, "fetch", async () => {
      return new Response(
        JSON.stringify({ error: { message: "model_not_configured" } }),
        { status: 400 },
      );
    });
    const ctx = baseCtx({
      workspaceRoot: workspace,
      tts: { provider: "local", baseUrl: "http://127.0.0.1:8000/v1" },
    });
    try {
      const result = await registry.execute("generate_speech", { speech: "Hello" }, ctx);
      assert.equal(result.ok, false);
      const error = result.error as { code: string; message: string };
      assert.equal(error.code, "tts_failed");
      assert.match(error.message, /model_not_configured/i);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("exposes the exported tool as the same object the registry holds", () => {
    assert.equal(registry.get("generate_speech"), generateSpeechTool);
  });
});
