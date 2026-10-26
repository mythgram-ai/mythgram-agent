import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { restoreCheckpointTool } from "./restore_checkpoint.js";
import { createCheckpointTool } from "./create_checkpoint.js";
import { listCheckpointsTool } from "./list_checkpoints.js";
import { deleteCheckpointTool } from "./delete_checkpoint.js";
import type { ToolContext } from "./types.js";

function ctxFor(workspaceRoot: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot,
    shellTimeoutMs: 10_000,
    ...overrides,
  };
}

describe("restore_checkpoint tool", () => {
  let registry: ToolRegistry;
  let workspace: string;

  before(async () => {
    registry = new ToolRegistry().registerAll([
      createCheckpointTool,
      listCheckpointsTool,
      deleteCheckpointTool,
      restoreCheckpointTool,
    ]);
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-checkpoint-restore-"));
    await fs.writeFile(path.join(workspace, "app.ts"), "version one\n", "utf8");
    await fs.writeFile(path.join(workspace, ".gitignore"), "node_modules\n", "utf8");
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("is registered and exposed to the LLM as a native function schema", () => {
    assert.ok(registry.has("restore_checkpoint"));
    const schema = registry.schemas.find((s) => s.function.name === "restore_checkpoint");
    assert.ok(schema, "restore_checkpoint must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    const props = schema!.function.parameters.properties as Record<string, any>;
    assert.ok(props.name, "name property must be declared");
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required, ["name"]);
  });

  it("restores the workspace and keeps a safety backup of the previous state", async () => {
    const created = await registry.execute(
      "create_checkpoint",
      { name: "goodstate", description: "Known good" },
      ctxFor(workspace),
    );
    assert.equal(created.ok, true);

    // The user makes a mistake after the checkpoint.
    await fs.writeFile(path.join(workspace, "app.ts"), "broken version\n", "utf8");
    await fs.writeFile(path.join(workspace, "oops.ts"), "mistake\n", "utf8");

    const result = await registry.execute("restore_checkpoint", { name: "goodstate" }, ctxFor(workspace));
    assert.equal(result.ok, true);
    const data = result.data as {
      name: string;
      safety_backup: string;
      safety_backup_name: string;
      restored_files: number;
      message: string;
    };
    assert.equal(data.name, "goodstate");
    assert.match(data.safety_backup, /^\.mythgram\/backups\/btocptd\/.+\.zip$/);
    // The safety backup name is 5 English words.
    assert.equal(data.safety_backup_name.split("-").length, 5);
    assert.match(data.message, /safety backup/);

    // The workspace is back to the checkpoint: the mistake file is gone and the
    // original content is back.
    assert.equal(await fs.readFile(path.join(workspace, "app.ts"), "utf8"), "version one\n");
    await assert.rejects(fs.stat(path.join(workspace, "oops.ts")));

    // The safety backup zip exists and still holds the pre-restore state.
    const safetyAbs = path.join(workspace, ...data.safety_backup.split("/"));
    const safetyStat = await fs.stat(safetyAbs);
    assert.ok(safetyStat.isFile() && safetyStat.size > 0);
    const { parseZipBuffer } = await import("./checkpoints.js");
    const safetyEntries = parseZipBuffer(await fs.readFile(safetyAbs)).map((e) => e.name);
    assert.ok(safetyEntries.includes("app.ts"));
    assert.ok(safetyEntries.includes("oops.ts"));

    // The original checkpoint is untouched (still restorable) and protected
    // files were never deleted.
    const listed = (await registry.execute("list_checkpoints", {}, ctxFor(workspace))).data as {
      count: number;
    };
    assert.equal(listed.count, 1);
    assert.equal(await fs.readFile(path.join(workspace, ".gitignore"), "utf8"), "node_modules\n");
  });

  it("reports not found for an unknown checkpoint name", async () => {
    const result = await registry.execute("restore_checkpoint", { name: "nosuchpoint" }, ctxFor(workspace));
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "checkpoint_not_found");
  });

  it("produces a readable UI label", () => {
    assert.equal(
      registry.label("restore_checkpoint", { name: "goodstate" }),
      "Restore Checkpoint: goodstate",
    );
  });
});
