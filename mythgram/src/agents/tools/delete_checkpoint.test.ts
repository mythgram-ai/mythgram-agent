import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { deleteCheckpointTool } from "./delete_checkpoint.js";
import { createCheckpointTool } from "./create_checkpoint.js";
import { listCheckpointsTool } from "./list_checkpoints.js";
import type { ToolContext } from "./types.js";

function ctxFor(workspaceRoot: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot,
    shellTimeoutMs: 10_000,
    ...overrides,
  };
}

describe("delete_checkpoint tool", () => {
  let registry: ToolRegistry;
  let workspace: string;

  before(async () => {
    registry = new ToolRegistry().registerAll([
      createCheckpointTool,
      listCheckpointsTool,
      deleteCheckpointTool,
    ]);
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-checkpoint-delete-"));
    await fs.writeFile(path.join(workspace, "app.ts"), "export const x = 1;\n", "utf8");
    await fs.writeFile(path.join(workspace, "keep.ts"), "export const y = 2;\n", "utf8");
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("is registered and exposed to the LLM as a native function schema", () => {
    assert.ok(registry.has("delete_checkpoint"));
    const schema = registry.schemas.find((s) => s.function.name === "delete_checkpoint");
    assert.ok(schema, "delete_checkpoint must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    const props = schema!.function.parameters.properties as Record<string, any>;
    assert.ok(props.name, "name property must be declared");
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required, ["name"]);
  });

  it("deletes the checkpoint zip and its record without touching the workspace", async () => {
    const created = await registry.execute(
      "create_checkpoint",
      { name: "todelete", description: "Temporary" },
      ctxFor(workspace),
    );
    assert.equal(created.ok, true);

    const result = await registry.execute("delete_checkpoint", { name: "todelete" }, ctxFor(workspace));
    assert.equal(result.ok, true);
    const data = result.data as { name: string; deleted: boolean; message: string };
    assert.equal(data.name, "todelete");
    assert.equal(data.deleted, true);

    // The zip is gone...
    await assert.rejects(fs.stat(path.join(workspace, ".mythgram", "backups", "todelete.zip")));

    // ...the manifest no longer lists it...
    const listed = (await registry.execute("list_checkpoints", {}, ctxFor(workspace))).data as {
      count: number;
    };
    assert.equal(listed.count, 0);

    // ...and the workspace files are untouched.
    assert.equal(await fs.readFile(path.join(workspace, "app.ts"), "utf8"), "export const x = 1;\n");
    assert.equal(await fs.readFile(path.join(workspace, "keep.ts"), "utf8"), "export const y = 2;\n");
  });

  it("reports not found for an unknown checkpoint name", async () => {
    const result = await registry.execute("delete_checkpoint", { name: "nosuchpoint" }, ctxFor(workspace));
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "checkpoint_not_found");
  });

  it("rejects a name that includes .zip", async () => {
    const result = await registry.execute("delete_checkpoint", { name: "x.zip" }, ctxFor(workspace));
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_checkpoint_name");
  });

  it("produces a readable UI label", () => {
    assert.equal(
      registry.label("delete_checkpoint", { name: "todelete" }),
      "Delete Checkpoint: todelete",
    );
  });
});
