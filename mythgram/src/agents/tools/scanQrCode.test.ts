import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { scanQrCodeTool } from "./scanQrCode.js";
import { createToolRegistry } from "./index.js";
import { SUB_AGENT_RESTRICTED_TOOLS } from "./subAgentRestrictedTools.js";
import type { ToolContext } from "./types.js";

async function qrPngBuffer(text: string, width = 200): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: "png", width, margin: 2 });
}

interface RgbaImage {
  data: Buffer;
  width: number;
  height: number;
}

/** Paste a QR PNG onto a larger white canvas at an arbitrary offset (proves position independence). */
async function qrOnCanvas(text: string, canvasSize: number, atX: number, atY: number, qrWidth = 160): Promise<Buffer> {
  const qrPng = await qrPngBuffer(text, qrWidth);
  const qr = PNG.sync.read(qrPng) as unknown as RgbaImage;
  const canvas = new PNG({ width: canvasSize, height: canvasSize });
  // Opaque white background.
  for (let i = 0; i < canvas.data.length; i += 4) {
    canvas.data[i] = 255;
    canvas.data[i + 1] = 255;
    canvas.data[i + 2] = 255;
    canvas.data[i + 3] = 255;
  }
  for (let y = 0; y < qr.height; y += 1) {
    for (let x = 0; x < qr.width; x += 1) {
      const dx = atX + x;
      const dy = atY + y;
      if (dx < 0 || dy < 0 || dx >= canvasSize || dy >= canvasSize) continue;
      const src = (y * qr.width + x) * 4;
      const dst = (dy * canvasSize + dx) * 4;
      canvas.data[dst] = qr.data[src]!;
      canvas.data[dst + 1] = qr.data[src + 1]!;
      canvas.data[dst + 2] = qr.data[src + 2]!;
      canvas.data[dst + 3] = 255;
    }
  }
  return PNG.sync.write(canvas);
}

describe("scan_qr_code tool", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ReturnType<typeof createToolRegistry>;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-scanqr-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = createToolRegistry();
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: Buffer | string): Promise<string> {
    const abs = path.join(workspace, name);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
    return abs;
  }

  async function run(args: Record<string, unknown>) {
    return registry.execute("scan_qr_code", args, ctx);
  }

  it("is registered and exposed to the LLM as a native function tool", () => {
    assert.ok(registry.has("scan_qr_code"));
    const schema = registry.schemas.find((s) => s.function.name === "scan_qr_code");
    assert.ok(schema, "scan_qr_code must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.match(schema!.function.description, /QR/i);
    const params = schema!.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties?: boolean;
    };
    assert.equal(params.type, "object");
    assert.ok(params.properties.image_path, "image_path property must be declared");
    assert.deepEqual(params.required, ["image_path"]);
    assert.equal(params.additionalProperties, false);
  });

  it("is available to every agent surface (not restricted from sub-agents or teams)", () => {
    assert.ok(!SUB_AGENT_RESTRICTED_TOOLS.includes("scan_qr_code"));
  });

  it("decodes a QR code from a PNG image", async () => {
    const abs = await writeFile("qr.png", await qrPngBuffer("hello-qr-world"));
    const result = await run({ image_path: abs });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const data = result.data as Record<string, unknown>;
    assert.equal(data.content, "hello-qr-world");
    assert.equal(data.image_path, "qr.png");
  });

  it("finds the QR code when it sits off-center (side of the image)", async () => {
    const abs = await writeFile("qr-side.png", await qrOnCanvas("side-position-qr", 500, 300, 40));
    const result = await run({ image_path: abs });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal((result.data as { content: string }).content, "side-position-qr");
  });

  it("finds the QR code when it sits in a corner of a large photo", async () => {
    const abs = await writeFile("qr-corner.png", await qrOnCanvas("corner-qr-123", 500, 12, 320));
    const result = await run({ image_path: abs });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal((result.data as { content: string }).content, "corner-qr-123");
  });

  it("decodes a QR code from a JPEG image", async () => {
    const png = await qrPngBuffer("jpeg-qr-content");
    const decoded = PNG.sync.read(png) as unknown as RgbaImage;
    const encoded = jpeg.encode(
      { data: decoded.data, width: decoded.width, height: decoded.height },
      100,
    );
    const abs = await writeFile("qr.jpg", encoded.data);
    const result = await run({ image_path: abs });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal((result.data as { content: string }).content, "jpeg-qr-content");
  });

  it("accepts a workspace-relative path", async () => {
    await writeFile("nested/rel.png", await qrPngBuffer("relative-path-qr"));
    const result = await run({ image_path: "nested/rel.png" });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal((result.data as { content: string }).content, "relative-path-qr");
  });

  it("reports dimensions and format alongside the decoded content", async () => {
    const abs = await writeFile("meta.png", await qrPngBuffer("meta-qr"));
    const result = await run({ image_path: abs });
    assert.equal(result.ok, true);
    const data = result.data as { format: string; width: number; height: number; content: string };
    assert.equal(data.format, "png");
    assert.ok(data.width > 0 && data.height > 0);
    assert.equal(data.content, "meta-qr");
  });

  it("errors clearly when no QR code is present", async () => {
    const canvas = new PNG({ width: 64, height: 64 });
    for (let i = 0; i < canvas.data.length; i += 4) {
      canvas.data[i] = 255;
      canvas.data[i + 1] = 255;
      canvas.data[i + 2] = 255;
      canvas.data[i + 3] = 255;
    }
    const abs = await writeFile("blank.png", PNG.sync.write(canvas));
    const result = await run({ image_path: abs });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "qr_not_found");
  });

  it("errors clearly for a missing file", async () => {
    const result = await run({ image_path: path.join(workspace, "does-not-exist.png") });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "image_not_found");
  });

  it("errors clearly when the path is a directory", async () => {
    const dir = path.join(workspace, "a-directory");
    await fs.mkdir(dir, { recursive: true });
    const result = await run({ image_path: dir });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "is_directory");
  });

  it("errors for an unsupported image type", async () => {
    const abs = await writeFile("note.txt", "just some text, not an image");
    const result = await run({ image_path: abs });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "unsupported_image_type");
  });

  it("errors for a path that escapes the workspace", async () => {
    const result = await run({ image_path: "../escape.png" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_image_path");
  });

  it("rejects an empty image_path and unknown props via schema validation", async () => {
    const empty = await run({ image_path: "   " });
    assert.equal(empty.ok, false);
    assert.equal((empty.error as { code: string }).code, "invalid_arguments");

    const missing = await run({});
    assert.equal(missing.ok, false);
    assert.equal((missing.error as { code: string }).code, "invalid_arguments");

    const extra = await run({ image_path: "x.png", bogus: true });
    assert.equal(extra.ok, false);
    assert.equal((extra.error as { code: string }).code, "invalid_arguments");
  });

  it("exposes a clear UI label", () => {
    assert.equal(scanQrCodeTool.label({ image_path: "qr.png" }), "Scan QR: qr.png");
  });

  it("does not throw on any failure", async () => {
    const attempts = await Promise.all([
      run({ image_path: path.join(workspace, "nope.png") }),
      run({ image_path: workspace }),
      run({ image_path: "/tmp/not-a-real-file-xyz.png" }),
      run({ image_path: "   " }),
    ]);
    for (const result of attempts) {
      assert.equal(typeof result.ok, "boolean");
      if (!result.ok) assert.ok(result.error);
    }
  });
});
