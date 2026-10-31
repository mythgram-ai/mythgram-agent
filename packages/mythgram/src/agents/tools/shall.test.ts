import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  shellTool,
  DEFAULT_TIMEOUT,
  MAX_TIMEOUT,
  MAX_LLM_CONTENT_CHARS,
} from "./shell.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

describe("shall_tool", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-shell-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = new ToolRegistry().register(shellTool);
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function run(args: Record<string, unknown>) {
    return registry.execute("shall_tool", args, ctx);
  }

  it("runs a command and returns stdout with exit code 0", async () => {
    const result = await run({ command: "echo hello shell" });
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.stdout, "hello shell\n");
    assert.equal(data.exit_code, 0);
    assert.equal(data.truncated, false);
    assert.equal(data.timed_out, false);
  });

  it("defaults the timeout to DEFAULT_TIMEOUT when omitted", () => {
    const parsed = shellTool.schema.parse({ command: "echo hi" });
    assert.equal(parsed.timeout, DEFAULT_TIMEOUT);
  });

  it("accepts a custom timeout within the allowed range", async () => {
    const parsed = shellTool.schema.parse({ command: "echo hi", timeout: 5 });
    assert.equal(parsed.timeout, 5);
    const result = await run({ command: "echo hi", timeout: 5 });
    assert.equal(result.ok, true);
  });

  it("rejects a timeout above MAX_TIMEOUT", async () => {
    const result = await run({ command: "echo hi", timeout: MAX_TIMEOUT + 1 });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects a zero or negative timeout", async () => {
    const zero = await run({ command: "echo hi", timeout: 0 });
    assert.equal(zero.ok, false);
    assert.equal((zero.error as { code: string }).code, "invalid_arguments");

    const negative = await run({ command: "echo hi", timeout: -5 });
    assert.equal(negative.ok, false);
    assert.equal((negative.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects a fractional timeout", async () => {
    const result = await run({ command: "echo hi", timeout: 1.5 });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("returns exit code and stderr for a failing command", async () => {
    const result = await run({ command: "echo boom >&2; exit 3" });
    assert.equal(result.ok, false);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.exit_code, 3);
    assert.equal(data.stdout, "");
    assert.equal(data.stderr, "boom\n");
  });

  it("reports a timeout with a 'retry with longer time out' hint and no throw", async () => {
    const started = Date.now();
    const result = await run({ command: "sleep 2", timeout: 1 });
    const elapsed = Date.now() - started;
    assert.equal(result.ok, false);
    const error = result.error as {
      code: string;
      message: string;
      timeout_seconds: number;
    };
    assert.equal(error.code, "shell_timeout");
    assert.match(error.message, /retry with longer time out/i);
    assert.equal(error.timeout_seconds, 1);
    // The command must have been killed near the requested timeout, not at the server cap.
    assert.ok(elapsed < 1500, `expected early kill, took ${elapsed}ms`);
  });

  it("truncates output beyond MAX_LLM_CONTENT_CHARS", async () => {
    const result = await run({ command: "seq 1 100000" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.truncated, true);
    const stdout = String(data.stdout);
    assert.ok(stdout.length <= MAX_LLM_CONTENT_CHARS + 100);
    assert.match(stdout, /\[truncated \d+ chars\]/);
  });

  it("returns partial output in the timeout error", async () => {
    const result = await run({ command: "echo partial-output; sleep 2", timeout: 1 });
    assert.equal(result.ok, false);
    const error = result.error as { code: string; stdout?: string };
    assert.equal(error.code, "shell_timeout");
    assert.match(error.stdout ?? "", /partial-output/);
  });

  it("starts a command in the background when wait_for_output is false", async () => {
    const result = await run({ command: "sleep 0.1", wait_for_output: false });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.background, true);
    assert.equal(typeof data.pid, "number");
  });

  it("rejects an empty command", async () => {
    const result = await run({ command: "   " });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "missing_command");
  });

  it("runs commands from the workspace directory", async () => {
    await fs.writeFile(path.join(workspace, "marker.txt"), "here", "utf8");
    const result = await run({ command: "pwd" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.match(String(data.stdout), new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("does not throw on any failure and never returns an unresolved rejection", async () => {
    const attempts = await Promise.all([
      run({ command: "false" }),
      run({ command: "sleep 1", timeout: 0 }),
      run({ command: "sleep 1", timeout: 999 }),
      run({ command: "" }),
    ]);
    for (const result of attempts) {
      assert.equal(typeof result.ok, "boolean");
      if (result.ok) assert.ok(result.data);
    }
  });
});