import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { generateImageTool } from "./generate_image.js";
import { createToolRegistry } from "./index.js";
import type { ImageRuntime, ToolContext } from "./types.js";

/** A tiny fake image payload (PNG magic bytes) so the tool can prove it decodes + writes bytes. */
const IMAGE_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

function fakeRuntime(overrides: Partial<ImageRuntime> = {}): ImageRuntime {
  return {
    available: () => true,
    defaultAspectRatio: () => "1:1",
    generate: async () => ({
      base64: IMAGE_BASE64,
      bytes: 8,
      format: "png",
      mime: "image/png",
      filename: "openrouter-image-1700000000000.png",
      providerId: "openrouter",
      providerName: "OpenRouter",
      model: "google/gemini-2.5-flash-image",
      aspectRatio: "1:1",
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

describe("generate_image tool", () => {
  let registry: ToolRegistry;
  let workspace: string;

  before(async () => {
    registry = new ToolRegistry().registerAll([generateImageTool]);
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-generate-image-"));
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("is registered and exposed to the LLM as a native function schema", () => {
    assert.ok(registry.has("generate_image"));
    const schema = registry.schemas.find((s) => s.function.name === "generate_image");
    assert.ok(schema, "generate_image must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    assert.equal(
      schema!.function.description,
      "Generate an image from a text prompt and save it to the specified output path.",
    );
    const props = schema!.function.parameters.properties as Record<string, any>;
    assert.ok(props.prompt, "prompt property must be declared");
    assert.ok(props.output_path, "output_path property must be declared");
    assert.ok(props.aspect_ratio, "aspect_ratio property must be declared");
    assert.ok(props.wait_for_output, "wait_for_output property must be declared");
    assert.deepEqual(props.aspect_ratio.enum, ["1:1", "16:9", "9:16", "4:3", "3:4"]);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual([...required].sort(), ["output_path", "prompt"]);
  });

  it("is part of the agent's default tool registry", () => {
    const full = createToolRegistry();
    assert.ok(full.has("generate_image"));
  });

  it("generates an image and saves it to the requested output path", async () => {
    const ctx = ctxFor(workspace, { image: fakeRuntime() });
    const result = await registry.execute(
      "generate_image",
      { prompt: "a red panda astronaut", output_path: "images/cat.png" },
      ctx,
    );
    assert.equal(result.ok, true);
    const data = result.data as Record<string, any>;
    assert.equal(data.file_path, "images/cat.png");
    assert.equal(data.filename, "cat.png");
    assert.equal(data.output_directory, "images");
    assert.equal(data.bytes, 8);
    assert.equal(data.provider, "OpenRouter");
    assert.equal(data.model, "google/gemini-2.5-flash-image");
    assert.equal(data.aspect_ratio, "1:1");
    assert.equal(data.prompt, "a red panda astronaut");

    const written = await fs.readFile(path.join(workspace, "images/cat.png"));
    assert.deepEqual([...written], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("passes an explicit aspect ratio to the runtime", async () => {
    let seen: string | undefined;
    const ctx = ctxFor(workspace, {
      image: fakeRuntime({
        generate: async ({ aspectRatio }) => {
          seen = aspectRatio;
          return {
            base64: IMAGE_BASE64,
            bytes: 8,
            format: "png",
            mime: "image/png",
            filename: "x.png",
            providerId: "p",
            providerName: "P",
            model: "m",
            aspectRatio: aspectRatio ?? "1:1",
          };
        },
      }),
    });
    const result = await registry.execute(
      "generate_image",
      { prompt: "wide shot", output_path: "out/wide.png", aspect_ratio: "16:9" },
      ctx,
    );
    assert.equal(result.ok, true);
    assert.equal(seen, "16:9");
  });

  it("creates nested output directories on demand", async () => {
    const ctx = ctxFor(workspace, { image: fakeRuntime() });
    const result = await registry.execute(
      "generate_image",
      { prompt: "Nested", output_path: "a/b/c/pic.png" },
      ctx,
    );
    assert.equal(result.ok, true);
    const stat = await fs.stat(path.join(workspace, "a/b/c"));
    assert.ok(stat.isDirectory());
  });

  it("never overwrites an existing file with the same name", async () => {
    const ctx = ctxFor(workspace, { image: fakeRuntime() });
    const first = await registry.execute(
      "generate_image",
      { prompt: "One", output_path: "dup/pic.png" },
      ctx,
    );
    const second = await registry.execute(
      "generate_image",
      { prompt: "Two", output_path: "dup/pic.png" },
      ctx,
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.notEqual((first.data as any).file_path, (second.data as any).file_path);
  });

  it("returns a background handle when wait_for_output is false", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ctx = ctxFor(workspace, {
      image: fakeRuntime({
        generate: async () => {
          await gate;
          return {
            base64: IMAGE_BASE64,
            bytes: 8,
            format: "png",
            mime: "image/png",
            filename: "bg.png",
            providerId: "p",
            providerName: "P",
            model: "m",
            aspectRatio: "1:1",
          };
        },
      }),
    });
    const result = await registry.execute(
      "generate_image",
      { prompt: "slow", output_path: "bg/pic.png", wait_for_output: false },
      ctx,
    );
    assert.equal(result.ok, true);
    assert.equal((result.data as any).status, "started");
    release();
    // Let the background job settle and write the file.
    await new Promise((r) => setTimeout(r, 50));
    const stat = await fs.stat(path.join(workspace, "bg/pic.png"));
    assert.ok(stat.isFile());
  });

  it("returns a clear error when no image provider is connected", async () => {
    const ctx = ctxFor(workspace, {
      image: fakeRuntime({
        generate: async () => {
          throw new Error("No image generation provider is connected.");
        },
      }),
    });
    const result = await registry.execute(
      "generate_image",
      { prompt: "Hi", output_path: "out/x.png" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as any).code, "image_generation_failed");
    assert.match((result.error as any).message, /No image generation provider is connected/);
  });

  it("errors when the image runtime is absent", async () => {
    const ctx = ctxFor(workspace);
    const result = await registry.execute(
      "generate_image",
      { prompt: "Hi", output_path: "out/x.png" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as any).code, "image_unavailable");
  });

  it("rejects a path that escapes the workspace", async () => {
    const ctx = ctxFor(workspace, { image: fakeRuntime() });
    const result = await registry.execute(
      "generate_image",
      { prompt: "Hi", output_path: "../escape.png" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as any).code, "invalid_output_path");
  });

  it("rejects an empty prompt before calling the provider", async () => {
    let called = false;
    const ctx = ctxFor(workspace, {
      image: fakeRuntime({
        generate: async () => {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });
    const result = await registry.execute(
      "generate_image",
      { prompt: "   ", output_path: "out/x.png" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });

  it("rejects empty image data returned by the provider", async () => {
    const ctx = ctxFor(workspace, {
      image: fakeRuntime({
        generate: async () => ({
          base64: "",
          bytes: 0,
          format: "png",
          mime: "image/png",
          filename: "x.png",
          providerId: "x",
          providerName: "X",
          model: "m",
          aspectRatio: "1:1",
        }),
      }),
    });
    const result = await registry.execute(
      "generate_image",
      { prompt: "Hi", output_path: "out/x.png" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as any).code, "image_generation_failed");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      generateImageTool.label({
        prompt: "Hi",
        output_path: "images/cat.png",
        wait_for_output: true,
      }),
      "Generate image: images/cat.png",
    );
  });
});
