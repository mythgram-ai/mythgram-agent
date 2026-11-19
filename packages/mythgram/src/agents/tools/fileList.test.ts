import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileListTool } from "./fileList.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

describe("file_list tool", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-filelist-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = new ToolRegistry().register(fileListTool);
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function writeFile(name: string): Promise<string> {
    const abs = path.join(workspace, name);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, "x", "utf8");
    return abs;
  }

  function run(args: Record<string, unknown>) {
    return registry.execute("file_list", args, ctx);
  }

  it("lists an absolute directory and includes hidden entries", async () => {
    await writeFile(".mythgram/data.json");
    await writeFile(".hidden/secret.txt");
    await writeFile("visible.txt");
    const result = await run({ path: workspace });
    assert.equal(result.ok, true);
    const data = result.data as { items: Array<{ name: string; path: string }> };
    const names = data.items.map((item) => item.name);
    assert.ok(names.includes(".mythgram"));
    assert.ok(names.includes(".hidden"));
    assert.ok(names.includes("visible.txt"));
  });

  it("lists a directory outside the workspace", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-filelist-outside-"));
    try {
      await fs.writeFile(path.join(outside, "outside.txt"), "x", "utf8");
      const result = await run({ path: outside });
      assert.equal(result.ok, true);
      const data = result.data as { items: Array<{ name: string; path: string }> };
      const entry = data.items.find((item) => item.name === "outside.txt");
      assert.ok(entry);
      assert.equal(entry!.path, path.join(outside, "outside.txt"));
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a relative path", async () => {
    const result = await run({ path: "relative-dir" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "file_list_failed");
  });
});