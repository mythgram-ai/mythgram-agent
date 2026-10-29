import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { archiveFilesTool } from "./archive_files.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";
import { executableExists } from "./archiveSupport.js";

const hasZip = executableExists("zip") || executableExists("7z") || executableExists("7za");
const hasTar = executableExists("tar");

describe("archive_files tool", () => {
  let workspace: string;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-archive-"));
    registry = new ToolRegistry().register(archiveFilesTool);
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: string): Promise<string> {
    const abs = path.join(workspace, name);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
    return abs;
  }

  function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
    return { workspaceRoot: workspace, shellTimeoutMs: 30_000, ...overrides };
  }

  async function run(args: Record<string, unknown>, ctx: ToolContext = makeCtx()) {
    return registry.execute("archive_files", args, ctx);
  }

  it("is registered with a valid OpenAI function schema", () => {
    assert.ok(registry.has("archive_files"));
    const schema = registry.schemas.find((s) => s.function.name === "archive_files");
    assert.ok(schema);
    assert.equal(schema!.type, "function");
    const params = schema!.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties?: boolean;
    };
    assert.equal(params.type, "object");
    assert.ok(params.properties.archive_name);
    assert.ok(params.properties.archive_format);
    assert.ok(params.properties.output_directory);
    assert.ok(params.properties.source_directory);
    assert.ok(params.properties.file_paths);
    assert.ok(params.properties.password);
    assert.ok(params.properties.overwrite);
    assert.deepEqual(params.required, ["archive_name", "archive_format", "output_directory"]);
    assert.equal(params.additionalProperties, false);
  });

  it("exposes a clear UI label", () => {
    assert.equal(archiveFilesTool.name, "archive_files");
    assert.equal(
      archiveFilesTool.label({
        archive_name: "backup",
        archive_format: "tar.gz",
      } as never),
      "Archive: backup.tar.gz",
    );
  });

  it("rejects missing required arguments through the registry", async () => {
    const result = await run({});
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects when both sources are provided", async () => {
    await writeFile("both/a.txt", "a");
    const result = await run({
      archive_name: "both",
      archive_format: "zip",
      output_directory: "out",
      source_directory: "both",
      file_paths: ["both/a.txt"],
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_source");
  });

  it("rejects when no source is provided", async () => {
    const result = await run({
      archive_name: "none",
      archive_format: "zip",
      output_directory: "out",
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_source");
  });

  it("rejects an archive name that already has an extension", async () => {
    await writeFile("ext/a.txt", "a");
    const result = await run({
      archive_name: "backup.zip",
      archive_format: "zip",
      output_directory: "out",
      source_directory: "ext",
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_archive_name");
  });

  it("rejects an archive name containing a directory separator", async () => {
    const result = await run({
      archive_name: "nested/backup",
      archive_format: "zip",
      output_directory: "out",
      source_directory: "ext",
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_archive_name");
  });

  it("rejects a password for a format that cannot encrypt", async () => {
    await writeFile("pw/a.txt", "a");
    const result = await run({
      archive_name: "pw",
      archive_format: "tar.gz",
      output_directory: "out",
      source_directory: "pw",
      password: "secret",
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "password_not_supported");
  });

  it("returns a clear error when a source file does not exist", async () => {
    const result = await run({
      archive_name: "missing",
      archive_format: "zip",
      output_directory: "out",
      file_paths: ["does-not-exist.txt"],
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "file_not_found");
  });

  it("creates a zip from a directory and reflects the output path", { skip: !hasZip }, async () => {
    await writeFile("docs/a.txt", "alpha\n");
    await writeFile("docs/sub/b.txt", "beta\n");
    const result = await run({
      archive_name: "backup",
      archive_format: "zip",
      output_directory: "archives",
      source_directory: "docs",
    });
    assert.equal(result.ok, true);
    const data = result.data as { archive_path: string; size_bytes: number; encrypted: boolean; file_count: number };
    assert.equal(data.archive_path.split(path.sep).join("/"), "archives/backup.zip");
    assert.ok(data.size_bytes > 0);
    assert.equal(data.encrypted, false);
    assert.equal(data.file_count, 2);
    const stat = await fs.stat(path.join(workspace, "archives/backup.zip"));
    assert.equal(stat.size, data.size_bytes);
  });

  it("creates a zip from an explicit file list", { skip: !hasZip }, async () => {
    await writeFile("one.txt", "1\n");
    await writeFile("nested/two.txt", "2\n");
    const result = await run({
      archive_name: "two",
      archive_format: "zip",
      output_directory: "out",
      file_paths: ["one.txt", "nested/two.txt"],
    });
    assert.equal(result.ok, true);
    assert.equal((result.data as { file_count: number }).file_count, 2);
    await fs.access(path.join(workspace, "out/two.zip"));
  });

  it("protects an existing archive unless overwrite is true", { skip: !hasZip }, async () => {
    await writeFile("ovr/a.txt", "a\n");
    const first = await run({
      archive_name: "ovr",
      archive_format: "zip",
      output_directory: "out",
      source_directory: "ovr",
    });
    assert.equal(first.ok, true);

    const blocked = await run({
      archive_name: "ovr",
      archive_format: "zip",
      output_directory: "out",
      source_directory: "ovr",
    });
    assert.equal(blocked.ok, false);
    assert.equal((blocked.error as { code: string }).code, "archive_exists");

    const replaced = await run({
      archive_name: "ovr",
      archive_format: "zip",
      output_directory: "out",
      source_directory: "ovr",
      overwrite: true,
    });
    assert.equal(replaced.ok, true);
    assert.equal((replaced.data as { overwritten: boolean }).overwritten, true);
  });

  it("creates an encrypted zip when a password is supplied", { skip: !hasZip }, async () => {
    await writeFile("sec/secret.txt", "classified\n");
    const result = await run({
      archive_name: "sec",
      archive_format: "zip",
      output_directory: "out",
      source_directory: "sec",
      password: "hunter2",
    });
    assert.equal(result.ok, true);
    assert.equal((result.data as { encrypted: boolean }).encrypted, true);
  });

  it("creates a tar.gz archive from a directory", { skip: !hasTar }, async () => {
    await writeFile("tardir/a.txt", "alpha\n");
    const result = await run({
      archive_name: "tarball",
      archive_format: "tar.gz",
      output_directory: "out",
      source_directory: "tardir",
    });
    assert.equal(result.ok, true);
    assert.equal((result.data as { archive_path: string }).archive_path.split(path.sep).join("/"), "out/tarball.tar.gz");
    await fs.access(path.join(workspace, "out/tarball.tar.gz"));
  });

  it("creates a plain tar archive", { skip: !hasTar }, async () => {
    await writeFile("plain/a.txt", "a\n");
    const result = await run({
      archive_name: "plain",
      archive_format: "tar",
      output_directory: "out",
      source_directory: "plain",
    });
    assert.equal(result.ok, true);
    await fs.access(path.join(workspace, "out/plain.tar"));
  });

  it("reports a clear error when a required compressor is missing", { skip: executableExists("lz4") }, async () => {
    await writeFile("lz/a.txt", "a\n");
    const result = await run({
      archive_name: "lz",
      archive_format: "tar.lz4",
      output_directory: "out",
      source_directory: "lz",
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "tool_not_installed");
  });

  it("reports a clear error when 7z is not installed", { skip: executableExists("7z") || executableExists("7za") }, async () => {
    await writeFile("sz/a.txt", "a\n");
    const result = await run({
      archive_name: "sz",
      archive_format: "7z",
      output_directory: "out",
      source_directory: "sz",
    });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "tool_not_installed");
  });
});
