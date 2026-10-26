import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyMultipleEditsTool } from "./applyMultipleEdits.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

describe("apply_multiple_edits tool", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-multiedit-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = new ToolRegistry().register(applyMultipleEditsTool);
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: string): Promise<string> {
    const abs = path.join(workspace, name);
    await fs.writeFile(abs, content, "utf8");
    return abs;
  }

  async function readFile(name: string): Promise<string> {
    return fs.readFile(path.join(workspace, name), "utf8");
  }

  async function run(args: Record<string, unknown>) {
    return registry.execute("apply_multiple_edits", args, ctx);
  }

  it("applies multiple edits to a single file in one call", async () => {
    const abs = await writeFile(
      "app.py",
      'name = "John"\nage = 20\nprint(name)\n',
    );
    const result = await run({
      file_path: abs,
      edits: [
        { old_text: 'name = "John"', new_text: 'name = "Alice"' },
        { old_text: "age = 20", new_text: "age = 25" },
        { old_text: "print(name)", new_text: 'print(f"Hello {name}")' },
      ],
    });

    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.error, undefined);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.edits_applied, 3);
    assert.equal(data.file_path, "app.py");
    assert.equal(
      await readFile("app.py"),
      'name = "Alice"\nage = 25\nprint(f"Hello {name}")\n',
    );
  });

  it("deletes matched code lines when new_text is empty", async () => {
    const abs = await writeFile("strip.ts", "const a = 1;\nconst dead = 2;\nconst b = 3;\n");
    const result = await run({
      file_path: abs,
      edits: [{ old_text: "const dead = 2;\n", new_text: "" }],
    });

    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal((result.data as Record<string, unknown>).edits_applied, 1);
    assert.equal(await readFile("strip.ts"), "const a = 1;\nconst b = 3;\n");
  });

  it("preserves untouched regions when edits target different parts of the file", async () => {
    const abs = await writeFile("multi.txt", "HEAD\nfoo\nMID\nbar\nTAIL\n");
    const result = await run({
      file_path: abs,
      edits: [
        { old_text: "foo", new_text: "FOO" },
        { old_text: "bar", new_text: "BAR" },
      ],
    });

    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("multi.txt"), "HEAD\nFOO\nMID\nBAR\nTAIL\n");
  });

  it("fails the whole call when a single old_text is not found, leaving the file unchanged", async () => {
    const original = "alpha\nbeta\ngamma\n";
    const abs = await writeFile("nf.txt", original);
    const result = await run({
      file_path: abs,
      edits: [
        { old_text: "beta", new_text: "BETA" },
        { old_text: "delta", new_text: "DELTA" },
      ],
    });

    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string };
    assert.equal(error.code, "edit_validation_failed");
    assert.match(error.message, /"delta"/);
    assert.match(error.message, /not found/i);
    assert.match(error.message, /NO changes were written/i);
    assert.equal(await readFile("nf.txt"), original, "file must be untouched");
  });

  it("reports every old_text that is not found", async () => {
    const abs = await writeFile("nf2.txt", "only this\n");
    const result = await run({
      file_path: abs,
      edits: [
        { old_text: "missing-a", new_text: "x" },
        { old_text: "missing-b", new_text: "y" },
      ],
    });

    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string; issues: unknown[] };
    assert.equal(error.code, "edit_validation_failed");
    assert.match(error.message, /"missing-a"/);
    assert.match(error.message, /"missing-b"/);
    assert.equal(error.issues.length, 2);
  });

  it("fails the whole call when an old_text matches multiple times", async () => {
    const abs = await writeFile("multi-match.txt", "dup\ndup\nother\n");
    const result = await run({
      file_path: abs,
      edits: [
        { old_text: "other", new_text: "OTHER" },
        { old_text: "dup", new_text: "DUP" },
      ],
    });

    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string; issues: unknown[] };
    assert.equal(error.code, "edit_validation_failed");
    assert.match(error.message, /"dup"/);
    assert.match(error.message, /2 times/i);
    assert.equal(error.issues.length, 1);
    assert.equal((error.issues[0] as { occurrences: number }).occurrences, 2);
    assert.equal(await readFile("multi-match.txt"), "dup\ndup\nother\n", "file must be untouched");
  });

  it("reports all old_texts that match multiple times", async () => {
    const abs = await writeFile("mm2.txt", "a\na\nb\nb\nc\n");
    const result = await run({
      file_path: abs,
      edits: [
        { old_text: "a", new_text: "A" },
        { old_text: "b", new_text: "B" },
        { old_text: "c", new_text: "C" },
      ],
    });

    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string; issues: unknown[] };
    assert.match(error.message, /"a"/);
    assert.match(error.message, /"b"/);
    assert.equal(error.issues.length, 2);
    assert.equal(await readFile("mm2.txt"), "a\na\nb\nb\nc\n", "file must be untouched");
  });

  it("reports both missing and duplicated old_texts in a single error", async () => {
    const abs = await writeFile("mixed.txt", "x\nx\ny\n");
    const result = await run({
      file_path: abs,
      edits: [
        { old_text: "x", new_text: "X" },
        { old_text: "missing", new_text: "M" },
      ],
    });

    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string; issues: unknown[] };
    assert.match(error.message, /"x"/);
    assert.match(error.message, /"missing"/);
    assert.equal(error.issues.length, 2);
    const kinds = (error.issues as { kind: string }[]).map((i) => i.kind).sort();
    assert.deepEqual(kinds, ["multiple", "not_found"]);
    assert.equal(await readFile("mixed.txt"), "x\nx\ny\n", "file must be untouched");
  });

  it("fails when two edits overlap and nothing is written", async () => {
    const abs = await writeFile("overlap.txt", "hello world\n");
    const result = await run({
      file_path: abs,
      edits: [
        { old_text: "hello world", new_text: "goodbye" },
        { old_text: "world", new_text: "WORLD" },
      ],
    });

    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string };
    assert.equal(error.code, "edit_validation_failed");
    assert.match(error.message, /overlaps/i);
    assert.equal(await readFile("overlap.txt"), "hello world\n", "file must be untouched");
  });

  it("errors clearly when the file does not exist", async () => {
    const result = await run({
      file_path: path.join(workspace, "nope.txt"),
      edits: [{ old_text: "a", new_text: "b" }],
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "file_read_failed");
  });

  it("errors for a path that escapes the workspace", async () => {
    const result = await run({
      file_path: "../escape.txt",
      edits: [{ old_text: "a", new_text: "b" }],
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "file_read_failed");
    assert.match((result.error as { message: string }).message, /escapes the workspace/i);
  });

  it("rejects an empty edits array", async () => {
    const abs = await writeFile("empty-edits.txt", "content\n");
    const result = await run({ file_path: abs, edits: [] });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects an empty old_text", async () => {
    const abs = await writeFile("empty-old.txt", "content\n");
    const result = await run({
      file_path: abs,
      edits: [{ old_text: "", new_text: "x" }],
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
    assert.match((result.error as { message: string }).message, /non-empty/i);
  });

  it("rejects edits with unknown extra properties", async () => {
    const abs = await writeFile("extra-prop.txt", "content\n");
    const result = await run({
      file_path: abs,
      edits: [{ old_text: "content", new_text: "x", replace_all: true }],
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects an edit missing new_text and a call missing file_path", async () => {
    const abs = await writeFile("missing-field.txt", "content\n");
    const missingNew = await run({
      file_path: abs,
      edits: [{ old_text: "content" }],
    });
    assert.equal(missingNew.ok, false);
    assert.equal((missingNew.error as { code: string }).code, "invalid_arguments");

    const missingFile = await run({ edits: [{ old_text: "content", new_text: "x" }] });
    assert.equal(missingFile.ok, false);
    assert.equal((missingFile.error as { code: string }).code, "invalid_arguments");
  });

  it("applies edits by their original match positions (deterministic, never corrupting)", async () => {
    const abs = await writeFile("chain.txt", "ab\n");
    const result = await run({
      file_path: abs,
      edits: [
        { old_text: "a", new_text: "b" },
        { old_text: "b", new_text: "c" },
      ],
    });

    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("chain.txt"), "bc\n");
  });

  it("exposes the correct OpenAI-compatible schema", async () => {
    const schemas = registry.schemas;
    assert.equal(schemas.length, 1);
    const fn = schemas[0].function;
    assert.equal(fn.name, "apply_multiple_edits");
    const params = fn.parameters as { properties: Record<string, unknown>; required?: string[] };
    assert.deepEqual(params.required, ["file_path", "edits"]);
    const edits = params.properties.edits as {
      type: string;
      minItems: number;
      items: { type: string; properties: Record<string, unknown>; required: string[] };
    };
    assert.equal(edits.type, "array");
    assert.equal(edits.minItems, 1);
    assert.deepEqual(edits.items.required, ["old_text", "new_text"]);
    assert.deepEqual(
      Object.keys(edits.items.properties).sort(),
      ["new_text", "old_text"],
    );
  });
});