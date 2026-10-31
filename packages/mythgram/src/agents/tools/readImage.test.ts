import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readImageTool,
  extractImageAttachment,
  withoutImageAttachment,
  buildImageMessage,
  IMAGE_ATTACHMENT_KEY,
} from "./readImage.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext, ToolResult } from "./types.js";

/** A valid 1x1 transparent PNG. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BUFFER = Buffer.from(PNG_BASE64, "base64");

describe("read_image tool", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-readimage-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = new ToolRegistry().register(readImageTool);
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function run(args: Record<string, unknown>, overrides: Partial<ToolContext> = {}) {
    return registry.execute("read_image", args, { ...ctx, ...overrides });
  }

  function assertOkImage(result: ToolResult, filePath: string, source: "workspace" | "url") {
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.file_path, filePath);
    assert.equal(data.source, source);
    assert.equal(data.size_bytes, PNG_BUFFER.length);
    const attachment = extractImageAttachment(result);
    assert.ok(attachment);
    assert.equal(attachment.content_type, "image/png");
    assert.equal(attachment.file_path, filePath);
    assert.equal(attachment.source, source);
    assert.equal(attachment.size_bytes, PNG_BUFFER.length);
    assert.ok(attachment.data_url.startsWith("data:image/png;base64,"));
    const b64 = attachment.data_url.slice("data:image/png;base64,".length);
    assert.deepEqual(Buffer.from(b64, "base64"), PNG_BUFFER);
  }

  it("reads a local image given a workspace-relative path", async () => {
    const rel = "photo.png";
    await fs.writeFile(path.join(workspace, rel), PNG_BUFFER);
    const result = await run({ file_path: rel });
    assertOkImage(result, rel, "workspace");
  });

  it("reads a local image given an absolute path inside the workspace", async () => {
    const rel = "abs.png";
    const abs = path.join(workspace, rel);
    await fs.writeFile(abs, PNG_BUFFER);
    const result = await run({ file_path: abs });
    assertOkImage(result, rel, "workspace");
  });

  it("reads a local image via the /workspace virtual mount", async () => {
    const rel = "mount.png";
    await fs.writeFile(path.join(workspace, rel), PNG_BUFFER);
    const result = await run({ file_path: `/workspace/${rel}` });
    assertOkImage(result, rel, "workspace");
  });

  it("reads a local image in a subfolder via the /workspace virtual mount", async () => {
    const rel = path.join("assets", "icons", "mount.png");
    await fs.mkdir(path.join(workspace, "assets", "icons"), { recursive: true });
    await fs.writeFile(path.join(workspace, rel), PNG_BUFFER);
    const result = await run({ file_path: `/workspace/${rel}` });
    assertOkImage(result, rel, "workspace");
  });

  it("supports jpeg extension mapping", async () => {
    const rel = "photo.jpeg";
    await fs.writeFile(path.join(workspace, rel), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
    const result = await run({ file_path: rel });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.content_type, "image/jpeg");
    const attachment = extractImageAttachment(result);
    assert.ok(attachment);
    assert.equal(attachment.content_type, "image/jpeg");
    assert.ok(attachment.data_url.startsWith("data:image/jpeg;base64,"));
  });

  it("errors clearly when the model is not vision capable", async () => {
    const rel = "blocked.png";
    await fs.writeFile(path.join(workspace, rel), PNG_BUFFER);
    const result = await run(
      { file_path: rel },
      { model: "deepseek-chat", visionCapable: false },
    );
    assert.equal(result.ok, false);
    const err = result.error as { code: string; message: string };
    assert.equal(err.code, "model_not_vision_capable");
    assert.match(err.message, /does not support image inputs/i);
  });

  it("errors for a missing file", async () => {
    const result = await run({ file_path: path.join(workspace, "does-not-exist.png") });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "image_not_found");
  });

  it("errors for a directory", async () => {
    const dir = path.join(workspace, "a-dir");
    await fs.mkdir(dir);
    const result = await run({ file_path: dir });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "is_directory");
  });

  it("errors for an unsupported image extension", async () => {
    const rel = "file.txt";
    await fs.writeFile(path.join(workspace, rel), "hello");
    const result = await run({ file_path: rel });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "unsupported_image_type");
  });

  it("errors for data that is not a valid image despite the extension", async () => {
    const rel = "fake.png";
    await fs.writeFile(path.join(workspace, rel), Buffer.from("not really a png"));
    const result = await run({ file_path: rel });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_image_data");
  });

  it("errors for an absolute path outside the workspace", async () => {
    const result = await run({ file_path: "/etc/hostname.png" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_file_path");
    assert.match((result.error as { message: string }).message, /outside the workspace/i);
  });

  it("errors for an empty file_path", async () => {
    const result = await run({ file_path: "   " });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("errors for an invalid URL", async () => {
    const result = await run({ file_path: "http://" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_url");
  });

  it("errors for a URL with an unsupported extension", async () => {
    const result = await run({ file_path: "https://example.com/photo.txt" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "unsupported_image_type");
  });

  it("reads an image from a live hosted URL", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG_BUFFER);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/images/photo.png`;
    try {
      const result = await run({ file_path: url });
      assertOkImage(result, url, "url");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("tolerates a generic octet-stream content type from an image host", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(PNG_BUFFER);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/raw/pic.png`;
    try {
      const result = await run({ file_path: url });
      assert.equal(result.ok, true);
      const data = result.data as Record<string, unknown>;
      assert.equal(data.content_type, "image/png");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("errors when a URL does not serve an image", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>not an image</html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/page.png`;
    try {
      const result = await run({ file_path: url });
      assert.equal(result.ok, false);
      assert.equal((result.error as { code: string }).code, "not_an_image");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not throw on any failure", async () => {
    const attempts = await Promise.all([
      run({ file_path: path.join(workspace, "nope.png") }),
      run({ file_path: workspace }),
      run({ file_path: "/tmp/not-a-real-image.png" }),
      run({ file_path: "https://example.com/x.png" }),
      run({ file_path: "   " }),
    ]);
    for (const result of attempts) {
      assert.equal(typeof result.ok, "boolean");
      if (!result.ok) assert.ok(result.error);
    }
  });

  describe("attachment helpers", () => {
    it("withoutImageAttachment strips the image but keeps metadata", async () => {
      const rel = "strip.png";
      await fs.writeFile(path.join(workspace, rel), PNG_BUFFER);
      const result = await run({ file_path: rel });
      assert.equal(result.ok, true);
      const stripped = withoutImageAttachment(result);
      assert.equal((stripped.data as Record<string, unknown>)[IMAGE_ATTACHMENT_KEY], undefined);
      assert.equal((stripped.data as Record<string, unknown>).file_path, rel);
      assert.equal((stripped.data as Record<string, unknown>).content_type, "image/png");
    });

    it("withoutImageAttachment returns the result unchanged when no image is attached", async () => {
      const bare: ToolResult = { ok: false, error: { code: "x", message: "y" } };
      assert.equal(withoutImageAttachment(bare), bare);
    });

    it("extractImageAttachment returns null when absent", () => {
      assert.equal(extractImageAttachment({ ok: true, data: { a: 1 } }), null);
      assert.equal(extractImageAttachment({ ok: true }), null);
      assert.equal(extractImageAttachment({ ok: false, error: { code: "x", message: "y" } }), null);
    });

    it("buildImageMessage produces OpenAI image_url content parts", () => {
      const message = buildImageMessage({
        data_url: "data:image/png;base64,AAAA",
        content_type: "image/png",
        file_path: "photo.png",
        source: "workspace",
        size_bytes: 4,
      });
      assert.equal(message.role, "user");
      assert.ok(Array.isArray(message.content));
      const parts = message.content as Array<Record<string, unknown>>;
      assert.equal(parts[0]?.type, "text");
      assert.equal((parts[1] as { type: string })?.type, "image_url");
      assert.equal(
        ((parts[1] as { image_url: { url: string } }).image_url as { url: string }).url,
        "data:image/png;base64,AAAA",
      );
    });
  });
});
