import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileReadTool, MAX_FILE_READ_LINES, MAX_LINE_LENGTH } from "./fileRead.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

const TRUNCATED_SUFFIX = "...";

function render(number: number, line: string): string {
  return `${String(number).padStart(6)}  ${line}`;
}

describe("file_read tool", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-fileread-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = new ToolRegistry().register(fileReadTool);
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: string | Uint8Array): Promise<string> {
    const abs = path.join(workspace, name);
    await fs.writeFile(abs, content, "utf8");
    return abs;
  }

  async function run(args: Record<string, unknown>) {
    return registry.execute("file_read", args, ctx);
  }

  it("reads a normal text file and returns raw content without line numbers", async () => {
    const abs = await writeFile("basic.txt", "first line\nsecond line\nthird line\n");
    const result = await run({ file_path: abs });
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.content, "first line\nsecond line\nthird line");
    assert.equal(data.line_count, 3);
    assert.equal(data.total_lines, 3);
    assert.equal(data.first_line, 1);
    assert.equal(data.last_line, 3);
    assert.equal(data.truncated, false);
    assert.equal(data.truncated_lines, 0);
    assert.equal(data.file_path, "basic.txt");
    assert.equal(data.return_line_number, false);
  });

  it("returns cat -n style content when return_line_number is true", async () => {
    const abs = await writeFile("numbered.txt", "first line\nsecond line\nthird line\n");
    const result = await run({ file_path: abs, return_line_number: true });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.content, `${render(1, "first line")}\n${render(2, "second line")}\n${render(3, "third line")}`);
    assert.equal(data.line_count, 3);
    assert.equal(data.total_lines, 3);
    assert.equal(data.first_line, 1);
    assert.equal(data.last_line, 3);
    assert.equal(data.return_line_number, true);
  });

  it("keeps the original line numbers with offset/limit when return_line_number is true", async () => {
    const content = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`).join("\n") + "\n";
    const abs = await writeFile("numbered-ten.txt", content);
    const result = await run({ file_path: abs, offset: 3, limit: 2, return_line_number: true });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(String(data.content), `${render(3, "line-3")}\n${render(4, "line-4")}`);
    assert.equal(data.first_line, 3);
    assert.equal(data.last_line, 4);
  });

  it("accepts the string values 'true' and 'false' for return_line_number", async () => {
    const abs = await writeFile("stringy.txt", "alpha\nbeta\n");
    const on = await run({ file_path: abs, return_line_number: "true" });
    assert.equal(on.ok, true);
    assert.equal(String((on.data as Record<string, unknown>).content), `${render(1, "alpha")}\n${render(2, "beta")}`);

    const off = await run({ file_path: abs, return_line_number: "false" });
    assert.equal(off.ok, true);
    assert.equal(String((off.data as Record<string, unknown>).content), "alpha\nbeta");
  });

  it("errors for a non-boolean return_line_number", async () => {
    const abs = await writeFile("bad-flag.txt", "a\n");
    const yes = await run({ file_path: abs, return_line_number: "yes" });
    assert.equal(yes.ok, false);
    assert.equal((yes.error as { code: string }).code, "invalid_arguments");

    const num = await run({ file_path: abs, return_line_number: 1 });
    assert.equal(num.ok, false);
    assert.equal((num.error as { code: string }).code, "invalid_arguments");
  });

  it("defaults to raw content when return_line_number is omitted", async () => {
    const abs = await writeFile("default-flag.txt", "one\ntwo\n");
    const result = await run({ file_path: abs });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(String(data.content), "one\ntwo");
    assert.equal(data.return_line_number, false);
  });

  it("reads a specific section with offset + limit, keeping original line metadata", async () => {
    const content = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`).join("\n") + "\n";
    const abs = await writeFile("ten.txt", content);
    const result = await run({ file_path: abs, offset: 3, limit: 4 });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.line_count, 4);
    assert.equal(data.first_line, 3);
    assert.equal(data.last_line, 6);
    assert.equal(data.total_lines, 10);
    assert.equal(data.truncated, true);
    assert.equal(String(data.content), "line-3\nline-4\nline-5\nline-6");
  });

  it("starts at line 1 by default when offset is omitted", async () => {
    const abs = await writeFile("start.txt", "alpha\nbeta\n");
    const result = await run({ file_path: abs, limit: 1 });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.first_line, 1);
    assert.equal(data.last_line, 1);
    assert.equal(String(data.content), "alpha");
  });

  it("defaults to MAX_FILE_READ_LINES lines and reports truncation", async () => {
    const lineCount = MAX_FILE_READ_LINES + 25;
    const content = Array.from({ length: lineCount }, (_, i) => `row-${i}`).join("\n") + "\n";
    const abs = await writeFile("many.txt", content);
    const result = await run({ file_path: abs });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.line_count, MAX_FILE_READ_LINES);
    assert.equal(data.total_lines, lineCount);
    assert.equal(data.first_line, 1);
    assert.equal(data.last_line, MAX_FILE_READ_LINES);
    assert.equal(data.truncated, true);
  });

  it("does not report truncation when the file has exactly the limit", async () => {
    const content = Array.from({ length: MAX_FILE_READ_LINES }, (_, i) => `row-${i}`).join("\n") + "\n";
    const abs = await writeFile("exact.txt", content);
    const result = await run({ file_path: abs });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.line_count, MAX_FILE_READ_LINES);
    assert.equal(data.total_lines, MAX_FILE_READ_LINES);
    assert.equal(data.truncated, false);
  });

  it("truncates lines longer than MAX_LINE_LENGTH with a marker", async () => {
    const long = "x".repeat(MAX_LINE_LENGTH + 100);
    const abs = await writeFile("long.txt", `${long}\nshort\n`);
    const result = await run({ file_path: abs });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.truncated_lines, 1);
    const content = String(data.content);
    const firstLine = content.split("\n")[0];
    assert.ok(firstLine.endsWith("x".repeat(MAX_LINE_LENGTH) + TRUNCATED_SUFFIX));
    assert.ok(content.includes("short"));
  });

  it("handles CRLF line endings", async () => {
    const abs = await writeFile("crlf.txt", "one\r\ntwo\r\n");
    const result = await run({ file_path: abs });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(String(data.content), "one\ntwo");
    assert.equal(data.line_count, 2);
  });

  it("returns an empty result when offset is beyond the end of the file", async () => {
    const abs = await writeFile("tiny.txt", "a\nb\nc\n");
    const result = await run({ file_path: abs, offset: 100 });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.line_count, 0);
    assert.equal(data.content, "");
    assert.equal(data.first_line, null);
    assert.equal(data.last_line, null);
    assert.equal(data.total_lines, 3);
    assert.equal(data.truncated, false);
  });

  it("errors clearly for a missing file", async () => {
    const result = await run({ file_path: path.join(workspace, "does-not-exist.txt") });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "file_not_found");
  });

  it("errors clearly when the path is a directory", async () => {
    const dir = path.join(workspace, "a-directory");
    await fs.mkdir(dir);
    const result = await run({ file_path: dir });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "is_directory");
  });

  it("errors clearly for a binary file", async () => {
    const abs = await writeFile("blob.bin", Buffer.from([0x00, 0x01, 0x02, 0x7f, 0x41, 0x42, 0x00]));
    const result = await run({ file_path: abs });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "binary_file");
  });

  it("errors for a relative file_path", async () => {
    const result = await run({ file_path: "basic.txt" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_file_path");
    assert.match((result.error as { message: string }).message, /absolute path/i);
  });

  it("errors for an absolute path outside the workspace", async () => {
    const result = await run({ file_path: "/etc/hostname" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_file_path");
    assert.match((result.error as { message: string }).message, /outside the workspace/i);
  });

  it("errors for an empty file_path", async () => {
    const result = await run({ file_path: "   " });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("errors for an invalid offset", async () => {
    const abs = await writeFile("off.txt", "a\nb\n");
    const zero = await run({ file_path: abs, offset: 0 });
    assert.equal(zero.ok, false);
    assert.equal((zero.error as { code: string }).code, "invalid_arguments");

    const negative = await run({ file_path: abs, offset: -3 });
    assert.equal(negative.ok, false);
    assert.equal((negative.error as { code: string }).code, "invalid_arguments");

    const fractional = await run({ file_path: abs, offset: 1.5 });
    assert.equal(fractional.ok, false);
    assert.equal((fractional.error as { code: string }).code, "invalid_arguments");
  });

  it("errors for an invalid limit", async () => {
    const abs = await writeFile("lim.txt", "a\nb\n");
    const zero = await run({ file_path: abs, limit: 0 });
    assert.equal(zero.ok, false);
    assert.equal((zero.error as { code: string }).code, "invalid_arguments");

    const negative = await run({ file_path: abs, limit: -2 });
    assert.equal(negative.ok, false);
    assert.equal((negative.error as { code: string }).code, "invalid_arguments");

    const fractional = await run({ file_path: abs, limit: 2.5 });
    assert.equal(fractional.ok, false);
    assert.equal((fractional.error as { code: string }).code, "invalid_arguments");
  });

  it("does not throw on any failure and never returns an unresolved promise rejection", async () => {
    const attempts = await Promise.all([
      run({ file_path: path.join(workspace, "nope.txt") }),
      run({ file_path: workspace }),
      run({ file_path: "/tmp/not-a-real-file-xyz" }),
      run({ file_path: "relative.txt" }),
    ]);
    for (const result of attempts) {
      assert.equal(typeof result.ok, "boolean");
      if (!result.ok) assert.ok(result.error);
    }
  });
});
