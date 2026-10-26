import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { listCheckpointsTool } from "./list_checkpoints.js";
import { createCheckpointTool } from "./create_checkpoint.js";
import type { ToolContext } from "./types.js";

function ctxFor(workspaceRoot: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot,
    shellTimeoutMs: 10_000,
    ...overrides,
  };
}

describe("list_checkpoints tool", () => {
  let registry: ToolRegistry;
  let workspace: string;

  before(async () => {
    registry = new ToolRegistry().registerAll([createCheckpointTool, listCheckpointsTool]);
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-checkpoint-list-"));
    await fs.writeFile(path.join(workspace, "app.ts"), "export const x = 1;\n", "utf8");
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("is registered and exposed to the LLM as a native function schema", () => {
    assert.ok(registry.has("list_checkpoints"));
    const schema = registry.schemas.find((s) => s.function.name === "list_checkpoints");
    assert.ok(schema, "list_checkpoints must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
  });

  it("reports an empty list when no checkpoints exist", async () => {
    const result = await registry.execute("list_checkpoints", {}, ctxFor(workspace));
    assert.equal(result.ok, true);
    const data = result.data as { count: number; checkpoints: unknown[]; message: string };
    assert.equal(data.count, 0);
    assert.deepEqual(data.checkpoints, []);
    assert.match(data.message, /No checkpoints exist yet/);
  });

  it("lists created checkpoints with their names and descriptions", async () => {
    const created = await registry.execute(
      "create_checkpoint",
      { name: "v1", description: "First version" },
      ctxFor(workspace),
    );
    assert.equal(created.ok, true);

    const result = await registry.execute("list_checkpoints", {}, ctxFor(workspace));
    assert.equal(result.ok, true);
    const data = result.data as {
      count: number;
      checkpoints: Array<{
        name: string;
        description: string;
        file: string;
        created_at: number;
        size_bytes: number;
        file_count: number;
      }>;
      message: string;
    };
    assert.equal(data.count, 1);
    assert.equal(data.checkpoints[0]!.name, "v1");
    assert.equal(data.checkpoints[0]!.description, "First version");
    assert.equal(data.checkpoints[0]!.file, ".mythgram/backups/v1.zip");
    assert.ok(data.checkpoints[0]!.created_at > 0);
    assert.ok(data.checkpoints[0]!.size_bytes > 0);
    assert.equal(data.checkpoints[0]!.file_count, 1);
    assert.match(data.message, /restore_checkpoint/);
  });

  it("produces a readable UI label", () => {
    assert.equal(registry.label("list_checkpoints", {}), "List Checkpoints");
  });
});
