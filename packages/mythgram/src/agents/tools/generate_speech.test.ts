import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { generateSpeechTool } from "./generate_speech.js";
import { createToolRegistry } from "./index.js";
import type { SpeechRuntime, ToolContext } from "./types.js";

/** A tiny fake audio payload ("MYTH") so the tool can prove it decodes + writes bytes. */
const AUDIO_BASE64 = Buffer.from("MYTH").toString("base64");

function fakeRuntime(overrides: Partial<SpeechRuntime> = {}): SpeechRuntime {
  return {
    available: () => true,
    synthesize: async () => ({
      base64: AUDIO_BASE64,
      bytes: 4,
      format: "mp3",
      mime: "audio/mpeg",
      filename: "openrouter-speech-1700000000000.mp3",
      providerId: "openrouter",
      providerName: "OpenRouter",
      model: "openai/gpt-4o-mini-tts",
      voice: "alloy",
    }),
    ...overrides,
  };
}

function ctxFor(workspaceRoot: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot,
    shellTimeoutMs: 10_000,
    ...overrides,
  };
}

describe("generate_speech tool", () => {
  let registry: ToolRegistry;
  let workspace: string;

  before(async () => {
    registry = new ToolRegistry().registerAll([generateSpeechTool]);
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-generate-speech-"));
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("is registered and exposed to the LLM as a native function schema", () => {
    assert.ok(registry.has("generate_speech"));
    const schema = registry.schemas.find((s) => s.function.name === "generate_speech");
    assert.ok(schema, "generate_speech must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    assert.equal(
      schema!.function.description,
      "Generate spoken audio from text and save the generated audio file to the specified output directory.",
    );
    const props = schema!.function.parameters.properties as Record<string, any>;
    assert.ok(props.speech, "speech property must be declared");
    assert.ok(props.output_directory, "output_directory property must be declared");
    assert.equal(schema!.function.parameters.additionalProperties, false);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual([...required].sort(), ["output_directory", "speech"]);
  });

  it("is part of the agent's default tool registry", () => {
    const full = createToolRegistry();
    assert.ok(full.has("generate_speech"));
  });

  it("generates audio and saves it to the requested output directory", async () => {
    const ctx = ctxFor(workspace, { speech: fakeRuntime() });
    const result = await registry.execute(
      "generate_speech",
      { speech: "Hello world", output_directory: "audio-out" },
      ctx,
    );
    assert.equal(result.ok, true);
    const data = result.data as Record<string, any>;
    assert.equal(data.file_path, "audio-out/openrouter-speech-1700000000000.mp3");
    assert.equal(data.filename, "openrouter-speech-1700000000000.mp3");
    assert.equal(data.output_directory, "audio-out");
    assert.equal(data.bytes, 4);
    assert.equal(data.provider, "OpenRouter");
    assert.equal(data.model, "openai/gpt-4o-mini-tts");
    assert.equal(data.voice, "alloy");
    assert.equal(data.speech, "Hello world");

    const written = await fs.readFile(path.join(workspace, data.file_path));
    assert.equal(written.toString("utf8"), "MYTH");
  });

  it("creates nested output directories on demand", async () => {
    const ctx = ctxFor(workspace, { speech: fakeRuntime() });
    const result = await registry.execute(
      "generate_speech",
      { speech: "Nested", output_directory: "a/b/c" },
      ctx,
    );
    assert.equal(result.ok, true);
    const stat = await fs.stat(path.join(workspace, "a/b/c"));
    assert.ok(stat.isDirectory());
  });

  it("never overwrites an existing file with the same name", async () => {
    const ctx = ctxFor(workspace, { speech: fakeRuntime() });
    const first = await registry.execute(
      "generate_speech",
      { speech: "One", output_directory: "dup" },
      ctx,
    );
    const second = await registry.execute(
      "generate_speech",
      { speech: "Two", output_directory: "dup" },
      ctx,
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.notEqual((first.data as any).file_path, (second.data as any).file_path);
  });

  it("returns a clear error when no TTS provider is connected", async () => {
    const ctx = ctxFor(workspace, {
      speech: fakeRuntime({
        synthesize: async () => {
          throw new Error("No text-to-speech provider is connected.");
        },
      }),
    });
    const result = await registry.execute(
      "generate_speech",
      { speech: "Hi", output_directory: "out" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as any).code, "speech_generation_failed");
    assert.match((result.error as any).message, /No text-to-speech provider is connected/);
  });

  it("errors when the speech runtime is absent (e.g. TTS engine unavailable)", async () => {
    const ctx = ctxFor(workspace);
    const result = await registry.execute(
      "generate_speech",
      { speech: "Hi", output_directory: "out" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as any).code, "speech_unavailable");
  });

  it("rejects a path that escapes the workspace", async () => {
    const ctx = ctxFor(workspace, { speech: fakeRuntime() });
    const result = await registry.execute(
      "generate_speech",
      { speech: "Hi", output_directory: "../escape" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as any).code, "invalid_output_directory");
  });

  it("rejects empty speech before calling the provider", async () => {
    let called = false;
    const ctx = ctxFor(workspace, {
      speech: fakeRuntime({
        synthesize: async () => {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });
    const result = await registry.execute(
      "generate_speech",
      { speech: "   ", output_directory: "out" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as any).code, "empty_speech");
    assert.equal(called, false);
  });

  it("rejects empty audio returned by the provider", async () => {
    const ctx = ctxFor(workspace, {
      speech: fakeRuntime({
        synthesize: async () => ({
          base64: "",
          bytes: 0,
          format: "mp3",
          mime: "audio/mpeg",
          filename: "x.mp3",
          providerId: "x",
          providerName: "X",
          model: "m",
          voice: "v",
        }),
      }),
    });
    const result = await registry.execute(
      "generate_speech",
      { speech: "Hi", output_directory: "out" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as any).code, "speech_generation_failed");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      generateSpeechTool.label({ speech: "Hi", output_directory: "audio" }),
      "Generate speech: audio",
    );
  });
});
