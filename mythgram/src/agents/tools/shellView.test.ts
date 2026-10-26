import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shellTool } from "./shell.js";
import { shellViewTool } from "./shellView.js";
import { shellSessionStore, type ShellSessionSnapshot } from "./shellSessions.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

describe("shell_view", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  before(async () => {
    shellSessionStore.clear();
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-shellview-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = new ToolRegistry().registerAll([shellTool, shellViewTool]);
  });

  after(async () => {
    shellSessionStore.clear();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function runShell(args: Record<string, unknown>) {
    return registry.execute("shall_tool", args, ctx);
  }

  async function runView(session_names: string[]) {
    return registry.execute("shell_view", { session_names }, ctx);
  }

  function sessionOf(
    result: Awaited<ReturnType<typeof runView>>,
    index = 0,
  ): ShellSessionSnapshot | { session_name: string; status: string; output: string } {
    const sessions = (result.ok ? result.data : result.error) as
      | { sessions: unknown[] }
      | undefined;
    const session = sessions?.sessions?.[index];
    assert.ok(session, "expected a session entry in the result");
    return session as never;
  }

  /** Poll the store until the session leaves "running" (max 5s). */
  async function waitUntilFinished(session_name: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const snapshot = shellSessionStore.snapshot(session_name);
      if (snapshot && snapshot.status !== "running") return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`session "${session_name}" did not finish within 5s`);
  }

  /** Poll the store until the session output matches the pattern (max 5s). */
  async function waitForOutput(session_name: string, pattern: RegExp): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const snapshot = shellSessionStore.snapshot(session_name);
      if (snapshot && pattern.test(snapshot.output)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`session "${session_name}" never produced output matching ${pattern}`);
  }

  it("rejects an empty session_names array", async () => {
    const result = await runView([]);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("returns 'session not found' for an unknown session", async () => {
    const result = await runView(["does-not-exist"]);
    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string; sessions: unknown[] };
    assert.equal(error.code, "shell_view_error");
    assert.match(error.message, /does-not-exist/);
    const session = error.sessions[0] as { session_name: string; status: string; output: string };
    assert.equal(session.session_name, "does-not-exist");
    assert.equal(session.status, "session not found");
    assert.equal(session.output, "");
  });

  it("rejects a foreground (wait_for_output=true) session", async () => {
    await runShell({ command: "echo hi", session_name: "foreground-session" });
    const result = await runView(["foreground-session"]);
    assert.equal(result.ok, false);
    const session = sessionOf(result) as { status: string };
    assert.equal(session.status, "not a background session");
  });

  it("returns partial output with status running for a live background command", async () => {
    const started = await runShell({
      command: "echo start-marker; sleep 3; echo end-marker",
      session_name: "live-session",
      wait_for_output: false,
    });
    assert.equal(started.ok, true);

    // Wait until the first marker lands in the buffer, then verify the command is
    // still alive and shell_view reports the partial output as status running.
    await waitForOutput("live-session", /start-marker/);

    const result = await runView(["live-session"]);
    assert.equal(result.ok, true);
    const session = sessionOf(result) as ShellSessionSnapshot;
    assert.equal(session.status, "running");
    assert.match(session.output, /start-marker/);
    assert.doesNotMatch(session.output, /end-marker/);
    assert.equal(typeof session.pid, "number");

    await waitUntilFinished("live-session");
  });

  it("returns the full output with status completed once the command finishes", async () => {
    await runShell({
      command: "echo hello-view; echo warn >&2; exit 0",
      session_name: "completed-session",
      wait_for_output: false,
    });
    await waitUntilFinished("completed-session");

    const result = await runView(["completed-session"]);
    assert.equal(result.ok, true);
    const session = sessionOf(result) as ShellSessionSnapshot;
    assert.equal(session.status, "completed");
    assert.equal(session.exit_code, 0);
    assert.match(session.output, /hello-view/);
    assert.match(session.output, /warn/);
    assert.equal(session.stdout, "hello-view\n");
    assert.equal(session.stderr, "warn\n");
  });

  it("marks a failing background command as errored with its exit code", async () => {
    await runShell({
      command: "echo boom >&2; exit 3",
      session_name: "errored-session",
      wait_for_output: false,
    });
    await waitUntilFinished("errored-session");

    const result = await runView(["errored-session"]);
    assert.equal(result.ok, true);
    const session = sessionOf(result) as ShellSessionSnapshot;
    assert.equal(session.status, "errored");
    assert.equal(session.exit_code, 3);
    assert.match(session.output, /boom/);
  });

  it("supports inspecting multiple sessions in one call", async () => {
    await runShell({
      command: "echo first-out",
      session_name: "multi-a",
      wait_for_output: false,
    });
    await runShell({
      command: "echo second-out",
      session_name: "multi-b",
      wait_for_output: false,
    });
    await waitUntilFinished("multi-a");
    await waitUntilFinished("multi-b");

    const result = await runView(["multi-a", "multi-b", "multi-missing"]);
    assert.equal(result.ok, false);
    const error = result.error as unknown as {
      sessions: Array<{ session_name: string; status: string }>;
    };
    assert.equal(error.sessions.length, 3);
    assert.equal(error.sessions[0]?.session_name, "multi-a");
    assert.equal(error.sessions[0]?.status, "completed");
    assert.equal(error.sessions[1]?.session_name, "multi-b");
    assert.equal(error.sessions[1]?.status, "completed");
    assert.equal(error.sessions[2]?.status, "session not found");
  });

  it("runs commands from the workspace directory", async () => {
    await runShell({
      command: "pwd",
      session_name: "cwd-session",
      wait_for_output: false,
    });
    await waitUntilFinished("cwd-session");
    const result = await runView(["cwd-session"]);
    assert.equal(result.ok, true);
    const session = sessionOf(result) as ShellSessionSnapshot;
    assert.match(session.output, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});