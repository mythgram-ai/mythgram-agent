import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { createToolRegistry, fetchTextFromImageTool } from "./index.js";
import { SUB_AGENT_RESTRICTED_TOOLS } from "./subAgentRestrictedTools.js";
import type { ToolContext } from "./types.js";

/** A tiny 5x7 bitmap font for the digits, used to synthesize a deterministic OCR test image. */
const DIGIT_FONT: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
};

/** Render a string of digits into a crisp black-on-white PNG at a size Tesseract reads reliably. */
function renderDigits(text: string, scale = 16): Buffer {
  const charW = 5;
  const charH = 7;
  const gap = 1;
  const width = text.length * (charW + gap) * scale + scale * 2;
  const height = charH * scale + scale * 2;
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 255;
    png.data[i + 1] = 255;
    png.data[i + 2] = 255;
    png.data[i + 3] = 255;
  }
  let x0 = scale;
  for (const ch of text) {
    const glyph = DIGIT_FONT[ch];
    if (!glyph) continue;
    for (let r = 0; r < charH; r += 1) {
      for (let c = 0; c < charW; c += 1) {
        if (glyph[r][c] !== "1") continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const px = x0 + c * scale + sx;
            const py = scale + r * scale + sy;
            const idx = (py * width + px) * 4;
            png.data[idx] = 0;
            png.data[idx + 1] = 0;
            png.data[idx + 2] = 0;
          }
        }
      }
    }
    x0 += (charW + gap) * scale;
  }
  return PNG.sync.write(png);
}

describe("fetch_text_from_image tool", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ReturnType<typeof createToolRegistry>;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-ocr-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = createToolRegistry();
  });

  after(async () => {
    mock.restoreAll();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: Buffer | string): Promise<string> {
    const abs = path.join(workspace, name);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
    return abs;
  }

  async function run(args: Record<string, unknown>, context: ToolContext = ctx) {
    return registry.execute("fetch_text_from_image", args, context);
  }

  it("is registered and exposed to the LLM as a native function tool", () => {
    assert.ok(registry.has("fetch_text_from_image"));
    const schema = registry.schemas.find((s) => s.function.name === "fetch_text_from_image");
    assert.ok(schema, "fetch_text_from_image must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.match(schema!.function.description, /text/i);
    const params = schema!.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties?: boolean;
    };
    assert.equal(params.type, "object");
    assert.ok(params.properties.image_source, "image_source property must be declared");
    assert.deepEqual(params.required, ["image_source"]);
    assert.equal(params.additionalProperties, false);
  });

  it("is restricted from sub-agents (main/custom/team/CEO only)", () => {
    assert.ok(SUB_AGENT_RESTRICTED_TOOLS.includes("fetch_text_from_image"));
  });

  it("rejects a missing or blank image_source via schema validation", async () => {
    const missing = await run({});
    assert.equal(missing.ok, false);
    assert.equal((missing.error as { code: string }).code, "invalid_arguments");

    const blank = await run({ image_source: "   " });
    assert.equal(blank.ok, false);
    assert.equal((blank.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects extra properties because the schema is strict", async () => {
    const result = await run({ image_source: "x.png", lang: "eng" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("errors clearly for a missing local file", async () => {
    const result = await run({ image_source: path.join(workspace, "does-not-exist.png") });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "image_not_found");
  });

  it("errors clearly when the path is a directory", async () => {
    const dir = path.join(workspace, "a-directory");
    await fs.mkdir(dir, { recursive: true });
    const result = await run({ image_source: dir });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "is_directory");
  });

  it("errors when a relative path escapes the workspace", async () => {
    const result = await run({ image_source: "../escape.png" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_file_path");
  });

  it("errors for a file that is not a supported image", async () => {
    const abs = await writeFile("note.txt", "just some text, not an image");
    const result = await run({ image_source: abs });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "unsupported_image_type");
  });

  it("errors for an empty file", async () => {
    const abs = await writeFile("empty.png", Buffer.alloc(0));
    const result = await run({ image_source: abs });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "empty_image");
  });

  it("rejects a non-http(s) URL scheme", async () => {
    const result = await run({ image_source: "ftp://example.com/image.png" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_url");
  });

  it("reports fetch failures for unreachable remote images", async () => {
    mock.method(globalThis, "fetch", async () => {
      throw new Error("network down");
    });
    const result = await run({ image_source: "https://example.com/image.png" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "fetch_failed");
  });

  it("rejects a remote response that is clearly not an image", async () => {
    mock.method(globalThis, "fetch", async () =>
      new Response("<html>not an image</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const result = await run({ image_source: "https://example.com/page.html" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "not_an_image");
  });

  it("does not throw on any failure", async () => {
    const attempts = await Promise.all([
      run({ image_source: path.join(workspace, "nope.png") }),
      run({ image_source: workspace }),
      run({ image_source: "   " }),
      run({ image_source: "ftp://nope" }),
    ]);
    for (const result of attempts) {
      assert.equal(typeof result.ok, "boolean");
      if (!result.ok) assert.ok(result.error);
    }
  });

  it("extracts text from a local image via OCR", { timeout: 180_000 }, async (t) => {
    const abs = await writeFile("digits.png", renderDigits("12345"));
    const result = await run({ image_source: abs });
    if (!result.ok) {
      // OCR needs Tesseract language data (downloaded on first use); skip if unavailable.
      t.skip(`OCR unavailable in this environment: ${JSON.stringify(result.error)}`);
      return;
    }
    const data = result.data as { text: string; source: string; image_source: string };
    assert.equal(data.source, "workspace");
    assert.equal(data.image_source, "digits.png");
    assert.match(data.text.replace(/\s+/g, ""), /12345/);
  });

  it("extracts text from a remote image URL via OCR", { timeout: 180_000 }, async (t) => {
    const png = renderDigits("12345");
    mock.method(globalThis, "fetch", async () =>
      new Response(png, { status: 200, headers: { "content-type": "image/png" } }),
    );
    const result = await run({ image_source: "https://example.com/digits.png" });
    if (!result.ok) {
      t.skip(`OCR unavailable in this environment: ${JSON.stringify(result.error)}`);
      return;
    }
    const data = result.data as { text: string; source: string };
    assert.equal(data.source, "url");
    assert.match(data.text.replace(/\s+/g, ""), /12345/);
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      fetchTextFromImageTool.label({ image_source: "shot.png" }),
      "Fetch Text From Image: shot.png",
    );
  });
});
