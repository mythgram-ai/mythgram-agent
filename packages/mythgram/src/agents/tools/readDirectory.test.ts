import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readDirectoryTool } from "./readDirectory.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

describe("read_directory tool", () => {
  let workspace: string;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-readdir-"));
    registry = new ToolRegistry().register(readDirectoryTool);
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: string | Uint8Array): Promise<string> {
    const abs = path.join(workspace, name);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
    return abs;
  }

  function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
    return { workspaceRoot: workspace, shellTimeoutMs: 10_000, ...overrides };
  }

  async function run(args: Record<string, unknown>, ctx: ToolContext = makeCtx()) {
    return registry.execute("read_directory", args, ctx);
  }

  it("is registered with a valid OpenAI function schema", () => {
    assert.ok(registry.has("read_directory"));
    const schema = registry.schemas.find((s) => s.function.name === "read_directory");
    assert.ok(schema);
    assert.equal(schema!.type, "function");
    const params = schema!.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties?: boolean;
    };
    assert.equal(params.type, "object");
    assert.ok(params.properties.directory_path);
    assert.ok(params.properties.read_only_files);
    assert.deepEqual(params.required, ["directory_path"]);
    assert.equal(params.additionalProperties, false);
  });

  it("rejects a missing directory_path through the registry", async () => {
    const result = await run({});
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("reads every supported file recursively with paths and complete contents", async () => {
    await writeFile("tree/a.txt", "alpha\n");
    await writeFile("tree/nested/b.ts", "export const b = 1;\n");
    await writeFile("tree/nested/deep/c.md", "# heading\n");
    const result = await run({ directory_path: "tree" });
    assert.equal(result.ok, true);
    const data = result.data as { files: Array<{ path: string; content: string }>; file_count: number };
    assert.equal(data.file_count, 3);
    const byPath = new Map(data.files.map((f) => [f.path.split(path.sep).join("/"), f.content]));
    assert.equal(byPath.get("tree/a.txt"), "alpha\n");
    assert.equal(byPath.get("tree/nested/b.ts"), "export const b = 1;\n");
    assert.equal(byPath.get("tree/nested/deep/c.md"), "# heading\n");
  });

  it("reads only top-level files when read_only_files is true", async () => {
    await writeFile("flat/top.txt", "top\n");
    await writeFile("flat/sub/deep.txt", "deep\n");
    const recursive = await run({ directory_path: "flat" });
    assert.equal(recursive.ok, true);
    assert.equal((recursive.data as { file_count: number }).file_count, 2);

    const filesOnly = await run({ directory_path: "flat", read_only_files: true });
    assert.equal(filesOnly.ok, true);
    const data = filesOnly.data as { files: Array<{ path: string }>; file_count: number; read_only_files: boolean };
    assert.equal(data.file_count, 1);
    assert.equal(data.read_only_files, true);
    assert.equal(data.files[0]!.path.split(path.sep).join("/"), "flat/top.txt");
  });

  it("accepts the string 'true' for read_only_files", async () => {
    await writeFile("stringy/top.txt", "t\n");
    await writeFile("stringy/sub/inner.txt", "i\n");
    const result = await run({ directory_path: "stringy", read_only_files: "true" });
    assert.equal(result.ok, true);
    assert.equal((result.data as { file_count: number }).file_count, 1);
  });

  it("skips binary files, excluded directories, and symlinks", async () => {
    await writeFile("bin/keep.txt", "keep\n");
    await writeFile("bin/image.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    await writeFile("bin/node_modules/dep/index.js", "module.exports = 1;\n");
    await writeFile("bin/.git/HEAD", "ref: refs/heads/main\n");
    await writeFile("bin/blob.dat", Buffer.from([0x41, 0x00, 0x42]));
    await fs.symlink(path.join(workspace, "bin/keep.txt"), path.join(workspace, "bin/link.txt"));
    const result = await run({ directory_path: "bin" });
    assert.equal(result.ok, true);
    const data = result.data as { files: Array<{ path: string }>; file_count: number };
    const paths = data.files.map((f) => f.path.split(path.sep).join("/"));
    assert.deepEqual(paths, ["bin/keep.txt"]);
    assert.equal(data.file_count, 1);
  });

  it("returns a structured budget error instead of partial content when too large", async () => {
    await writeFile("huge/a.txt", "A".repeat(2000));
    await writeFile("huge/b.txt", "B".repeat(2000));
    // 10 tokens * 4 chars/token * 0.5 fraction = 20 chars budget -> far below 4000.
    const result = await run({ directory_path: "huge" }, makeCtx({ contextLimit: 10 }));
    assert.equal(result.ok, false);
    const error = result.error as unknown as {
      code: string;
      file_count: number;
      total_chars: number;
      budget_chars: number;
      files: Array<{ path: string; bytes: number }>;
    };
    assert.equal(error.code, "content_exceeds_context_budget");
    assert.equal(error.file_count, 2);
    assert.equal(error.total_chars, 4000);
    assert.ok(error.budget_chars < error.total_chars);
    assert.equal(error.files.length, 2);
    assert.ok(error.files.every((f) => typeof f.path === "string" && typeof f.bytes === "number"));
    assert.equal((result as { data?: unknown }).data, undefined);
  });

  it("returns a directory_not_found error for a missing directory", async () => {
    const result = await run({ directory_path: "does-not-exist" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "directory_not_found");
  });

  it("returns a not_a_directory error when the path is a file", async () => {
    await writeFile("single.txt", "x\n");
    const result = await run({ directory_path: "single.txt" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "not_a_directory");
  });

  it("returns an empty result for a directory with no supported files", async () => {
    await fs.mkdir(path.join(workspace, "empty-dir"), { recursive: true });
    const result = await run({ directory_path: "empty-dir" });
    assert.equal(result.ok, true);
    const data = result.data as { files: unknown[]; file_count: number };
    assert.equal(data.file_count, 0);
    assert.deepEqual(data.files, []);
  });

  it("exposes a clear UI label", () => {
    assert.equal(readDirectoryTool.name, "read_directory");
    assert.equal(readDirectoryTool.label({ directory_path: "src" } as never), "Read directory: src");
  });
});
