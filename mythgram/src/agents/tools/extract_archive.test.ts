import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { extractArchiveTool } from "./extract_archive.js";
import { archiveFilesTool } from "./archive_files.js";
import { createZipBuffer } from "./checkpoints.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";
import { executableExists, findUnsafeEntry } from "./archiveSupport.js";

const hasZip = executableExists("zip") || executableExists("7z") || executableExists("7za");
const hasUnzip = executableExists("unzip") || executableExists("7z") || executableExists("7za");
const hasTar = executableExists("tar");

describe("extract_archive tool", () => {
  let workspace: string;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-extract-"));
    registry = new ToolRegistry().register(archiveFilesTool).register(extractArchiveTool);
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
    return { workspaceRoot: workspace, shellTimeoutMs: 30_000, ...overrides };
  }

  async function archive(args: Record<string, unknown>) {
    return registry.execute("archive_files", args, makeCtx());
  }

  async function extract(args: Record<string, unknown>) {
    return registry.execute("extract_archive", args, makeCtx());
  }

  it("is registered with a valid OpenAI function schema", () => {
    assert.ok(registry.has("extract_archive"));
    const schema = registry.schemas.find((s) => s.function.name === "extract_archive");
    assert.ok(schema);
    assert.equal(schema!.type, "function");
    const params = schema!.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties?: boolean;
    };
    assert.equal(params.type, "object");
    assert.ok(params.properties.archive_path);
    assert.ok(params.properties.password);
    assert.deepEqual(params.required, ["archive_path", "password"]);
    assert.equal(params.additionalProperties, false);
  });

  it("exposes a clear UI label", () => {
    assert.equal(extractArchiveTool.name, "extract_archive");
    assert.equal(
      extractArchiveTool.label({ archive_path: "a/b.zip", password: null } as never),
      "Extract: a/b.zip",
    );
  });

  it("rejects missing required arguments through the registry", async () => {
    const result = await extract({ archive_path: "x.zip" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("returns archive_not_found for a missing archive", async () => {
    const result = await extract({ archive_path: "nope.zip", password: null });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "archive_not_found");
  });

  it("returns unsupported_archive_format for an unknown extension", async () => {
    await writeFile("note.txt", "not an archive");
    const result = await extract({ archive_path: "note.txt", password: null });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "unsupported_archive_format");
  });

  it("rejects directory traversal entries (zip-slip guard)", async () => {
    const evil = createZipBuffer([{ name: "../outside.txt", isDir: false, data: Buffer.from("evil") }]);
    await writeFile("evil.zip", evil);
    const result = await extract({ archive_path: "evil.zip", password: null });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "unsafe_archive_entry");
  });

  it("findUnsafeEntry flags absolute and traversal names", () => {
    assert.equal(findUnsafeEntry(["a/b.txt", "c/d.txt"]), null);
    assert.equal(findUnsafeEntry(["../evil"]), "../evil");
    assert.equal(findUnsafeEntry(["a/../../evil"]), "a/../../evil");
    assert.equal(findUnsafeEntry(["/etc/passwd"]), "/etc/passwd");
    assert.equal(findUnsafeEntry(["C:/windows/system32"]), "C:/windows/system32");
  });

  it("round-trips a directory archive through zip", { skip: !(hasZip && hasUnzip) }, async () => {
    await writeFile("src/a.txt", "alpha\n");
    await writeFile("src/sub/b.txt", "beta\n");
    const created = await archive({
      archive_name: "backup",
      archive_format: "zip",
      output_directory: "archives",
      source_directory: "src",
    });
    assert.equal(created.ok, true);

    const extracted = await extract({ archive_path: "archives/backup.zip", password: null });
    assert.equal(extracted.ok, true);
    const data = extracted.data as { output_directory: string; file_count: number };
    assert.equal(data.output_directory.split(path.sep).join("/"), "archives/backup");
    assert.equal(data.file_count, 2);
    assert.equal(await fs.readFile(path.join(workspace, "archives/backup/a.txt"), "utf8"), "alpha\n");
    assert.equal(await fs.readFile(path.join(workspace, "archives/backup/sub/b.txt"), "utf8"), "beta\n");
  });

  it("round-trips a directory archive through tar.gz", { skip: !hasTar }, async () => {
    await writeFile("tsrc/x.txt", "x\n");
    const created = await archive({
      archive_name: "tb",
      archive_format: "tar.gz",
      output_directory: "out",
      source_directory: "tsrc",
    });
    assert.equal(created.ok, true);

    const extracted = await extract({ archive_path: "out/tb.tar.gz", password: null });
    assert.equal(extracted.ok, true);
    assert.equal(await fs.readFile(path.join(workspace, "out/tb/x.txt"), "utf8"), "x\n");
  });

  it("requires the correct password for an encrypted zip", { skip: !(hasZip && hasUnzip) }, async () => {
    await writeFile("enc/secret.txt", "classified\n");
    const created = await archive({
      archive_name: "enc",
      archive_format: "zip",
      output_directory: "out",
      source_directory: "enc",
      password: "hunter2",
    });
    assert.equal(created.ok, true);

    const noPassword = await extract({ archive_path: "out/enc.zip", password: null });
    assert.equal(noPassword.ok, false);
    assert.equal((noPassword.error as { code: string }).code, "password_required");

    const wrongPassword = await extract({ archive_path: "out/enc.zip", password: "nope" });
    assert.equal(wrongPassword.ok, false);
    assert.equal((wrongPassword.error as { code: string }).code, "incorrect_password");

    const correct = await extract({ archive_path: "out/enc.zip", password: "hunter2" });
    assert.equal(correct.ok, true);
    assert.equal(await fs.readFile(path.join(workspace, "out/enc/secret.txt"), "utf8"), "classified\n");
  });

  it("extracts a single .gz file", async () => {
    await writeFile("single/hello.txt.gz", gzipSync(Buffer.from("hello gzip\n")));
    const result = await extract({ archive_path: "single/hello.txt.gz", password: null });
    assert.equal(result.ok, true);
    assert.equal((result.data as { output_directory: string }).output_directory.split(path.sep).join("/"), "single");
    assert.equal(await fs.readFile(path.join(workspace, "single/hello.txt"), "utf8"), "hello gzip\n");
  });

  it("extracts an archive that was not created by archive_files", { skip: !(hasZip && hasUnzip) }, async () => {
    const foreign = createZipBuffer([
      { name: "readme.md", isDir: false, data: Buffer.from("# foreign\n") },
    ]);
    await writeFile("foreign.zip", foreign);
    const result = await extract({ archive_path: "foreign.zip", password: null });
    assert.equal(result.ok, true);
    assert.equal(await fs.readFile(path.join(workspace, "foreign/readme.md"), "utf8"), "# foreign\n");
  });
});
