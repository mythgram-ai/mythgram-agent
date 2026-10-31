import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { createCheckpointTool } from "./create_checkpoint.js";
import { createToolRegistry } from "./index.js";
import type { ToolContext } from "./types.js";

function ctxFor(workspaceRoot: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot,
    shellTimeoutMs: 10_000,
    ...overrides,
  };
}

describe("create_checkpoint tool", () => {
  let registry: ToolRegistry;
  let workspace: string;

  before(async () => {
    registry = new ToolRegistry().registerAll([createCheckpointTool]);
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-checkpoint-create-"));
    await fs.writeFile(path.join(workspace, "app.ts"), "export const x = 1;\n", "utf8");
    await fs.mkdir(path.join(workspace, "src"), { recursive: true });
    await fs.writeFile(path.join(workspace, "src", "index.ts"), "console.log(1);\n", "utf8");
    // Generated content that must never end up in a checkpoint.
    await fs.mkdir(path.join(workspace, "node_modules", "dep"), { recursive: true });
    await fs.writeFile(path.join(workspace, "node_modules", "dep", "index.js"), "x", "utf8");
    await fs.writeFile(path.join(workspace, ".gitignore"), "node_modules\n", "utf8");
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("is registered and exposed to the LLM as a native function schema", () => {
    assert.ok(registry.has("create_checkpoint"));
    const schema = registry.schemas.find((s) => s.function.name === "create_checkpoint");
    assert.ok(schema, "create_checkpoint must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    const props = schema!.function.parameters.properties as Record<string, any>;
    assert.ok(props.name, "name property must be declared");
    assert.ok(props.description, "description property must be declared");
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual([...required].sort(), ["description", "name"]);
  });

  it("is part of the agent's default tool registry", () => {
    const full = createToolRegistry();
    assert.ok(full.has("create_checkpoint"));
    assert.ok(full.has("list_checkpoints"));
    assert.ok(full.has("delete_checkpoint"));
    assert.ok(full.has("restore_checkpoint"));
  });

  it("creates a checkpoint zip with the requested name", async () => {
    const result = await registry.execute(
      "create_checkpoint",
      { name: "checkpoint298", description: "First backup" },
      ctxFor(workspace),
    );
    assert.equal(result.ok, true);
    const data = result.data as {
      name: string;
      file: string;
      file_count: number;
      size_bytes: number;
      message: string;
    };
    assert.equal(data.name, "checkpoint298");
    assert.equal(data.file, ".mythgram/backups/checkpoint298.zip");
    assert.equal(data.file_count, 2);
    assert.ok(data.size_bytes > 0);
    assert.match(data.message, /restore_checkpoint/);
    const stat = await fs.stat(path.join(workspace, ".mythgram", "backups", "checkpoint298.zip"));
    assert.ok(stat.isFile());
  });

  it("excludes node_modules, .gitignore, and .mythgram from the zip", async () => {
    const { parseZipBuffer } = await import("./checkpoints.js");
    const zip = await fs.readFile(path.join(workspace, ".mythgram", "backups", "checkpoint298.zip"));
    const entries = parseZipBuffer(zip).map((e) => e.name);
    assert.ok(entries.includes("app.ts"));
    assert.ok(entries.includes("src/index.ts"));
    assert.ok(!entries.some((name) => name.includes("node_modules")), "node_modules must be excluded");
    assert.ok(!entries.includes(".gitignore"), ".gitignore must be excluded");
    assert.ok(!entries.some((name) => name.startsWith(".mythgram")), ".mythgram must be excluded");
  });

  it("rejects a duplicate checkpoint name", async () => {
    const result = await registry.execute(
      "create_checkpoint",
      { name: "checkpoint298", description: "Duplicate attempt" },
      ctxFor(workspace),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "checkpoint_name_exists");
  });

  it("rejects a name that includes .zip", async () => {
    const result = await registry.execute(
      "create_checkpoint",
      { name: "backup.zip", description: "Bad name" },
      ctxFor(workspace),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_checkpoint_name");
  });

  it("rejects names with spaces, slashes, or traversal", async () => {
    for (const bad of ["my checkpoint", "../escape", "a/b"]) {
      const result = await registry.execute(
        "create_checkpoint",
        { name: bad, description: "Bad name" },
        ctxFor(workspace),
      );
      assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
      assert.equal(result.error?.code, "invalid_checkpoint_name");
    }
    // An empty name never reaches the tool — the argument schema rejects it.
    const empty = await registry.execute(
      "create_checkpoint",
      { name: "", description: "Bad name" },
      ctxFor(workspace),
    );
    assert.equal(empty.ok, false);
    assert.equal(empty.error?.code, "invalid_arguments");
  });

  it("rejects a missing description", async () => {
    // A blank description never reaches the tool — the argument schema rejects it.
    const result = await registry.execute(
      "create_checkpoint",
      { name: "nodesc", description: "   " },
      ctxFor(workspace),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_arguments");
  });

  it("produces a readable UI label", () => {
    assert.equal(registry.label("create_checkpoint", { name: "checkpoint298" }), "Checkpoint: checkpoint298");
  });
});
