import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shellTool } from "./shell.js";
import { shellViewTool } from "./shellView.js";
import { bashWriteToProcessTool } from "./bashWriteToProcess.js";
import { shellSessionStore } from "./shellSessions.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

describe("bash_write_to_process", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  before(async () => {
    shellSessionStore.clear();
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-write-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = new ToolRegistry().registerAll([
      shellTool,
      shellViewTool,
      bashWriteToProcessTool,
    ]);
  });

  after(async () => {
    shellSessionStore.clear();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function runShell(args: Record<string, unknown>) {
    return registry.execute("shall_tool", args, ctx);
  }

  async function runWrite(args: Record<string, unknown>) {
    return registry.execute("bash_write_to_process", args, ctx);
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

  /** Kill the process behind a session (test cleanup only). */
  function killSession(session_name: string): void {
    const pid = shellSessionStore.snapshot(session_name)?.pid;
    if (pid != null) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }

  it("defaults press_enter to true in the schema", () => {
    const parsed = bashWriteToProcessTool.schema.parse({
      session_name: "dev",
      input: "hello",
    });
    assert.equal(parsed.press_enter, true);
  });

  it("rejects an empty session_name at the schema level", async () => {
    const result = await runWrite({ session_name: "", input: "hello" });
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("rejects a nonexistent session", async () => {
    const result = await runWrite({ session_name: "does-not-exist", input: "hello" });
    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string; session_name: string };
    assert.equal(error.code, "session_not_found");
    assert.equal(error.session_name, "does-not-exist");
    assert.match(error.message, /does-not-exist/);
  });

  it("rejects writing to a foreground (wait_for_output=true) session", async () => {
    await runShell({ command: "echo hi", session_name: "foreground-session" });
    const result = await runWrite({
      session_name: "foreground-session",
      input: "hello",
      press_enter: true,
    });
    assert.equal(result.ok, false);
    const error = result.error as { code: string };
    assert.equal(error.code, "not_writable_session");
  });

  it("rejects writing to a session whose process has already exited", async () => {
    await runShell({
      command: "echo done",
      session_name: "exited-session",
      wait_for_output: false,
    });
    await waitUntilFinished("exited-session");

    const result = await runWrite({ session_name: "exited-session", input: "hello" });
    assert.equal(result.ok, false);
    const error = result.error as unknown as {
      code: string;
      status: string;
      exit_code: number | null;
    };
    assert.equal(error.code, "process_exited");
    assert.equal(error.status, "completed");
    assert.equal(error.exit_code, 0);
  });

  it("writes input with a trailing newline when press_enter is true", async () => {
    await runShell({
      command: "read -r line; echo got:$line",
      session_name: "enter-session",
      wait_for_output: false,
    });

    const result = await runWrite({
      session_name: "enter-session",
      input: "hello",
      press_enter: true,
    });
    assert.equal(result.ok, true);
    const data = result.data as {
      session_name: string;
      input: string;
      press_enter: boolean;
      written: string;
      bytes_written: number;
    };
    assert.equal(data.session_name, "enter-session");
    assert.equal(data.input, "hello");
    assert.equal(data.press_enter, true);
    assert.equal(data.written, "hello\n");
    assert.equal(data.bytes_written, 6);

    await waitUntilFinished("enter-session");
    const output = shellSessionStore.snapshot("enter-session")?.output ?? "";
    assert.equal(output, "got:hello\n");
  });

  it("writes input exactly as provided without a newline when press_enter is false", async () => {
    await runShell({
      command: "IFS= read -r -n 1 c; echo char:$c",
      session_name: "no-enter-session",
      wait_for_output: false,
    });

    const result = await runWrite({
      session_name: "no-enter-session",
      input: "x",
      press_enter: false,
    });
    assert.equal(result.ok, true);
    const data = result.data as {
      written: string;
      bytes_written: number;
      press_enter: boolean;
    };
    assert.equal(data.press_enter, false);
    assert.equal(data.written, "x");
    assert.equal(data.bytes_written, 1);

    await waitUntilFinished("no-enter-session");
    const output = shellSessionStore.snapshot("no-enter-session")?.output ?? "";
    assert.equal(output, "char:x\n");
  });

  it("feeds an interactive process over multiple writes (dev-server style)", async () => {
    await runShell({
      command: "while read -r line; do echo \"=> $line\"; done",
      session_name: "repl-session",
      wait_for_output: false,
    });

    const first = await runWrite({ session_name: "repl-session", input: "ping" });
    assert.equal(first.ok, true);
    await waitForOutput("repl-session", /=> ping/);

    const second = await runWrite({ session_name: "repl-session", input: "stop" });
    assert.equal(second.ok, true);
    await waitForOutput("repl-session", /=> stop/);

    const output = shellSessionStore.snapshot("repl-session")?.output ?? "";
    assert.match(output, /=> ping\n/);
    assert.match(output, /=> stop\n/);

    killSession("repl-session");
  });

  it("sends partial lines without a newline to a running process", async () => {
    await runShell({ command: "cat", session_name: "cat-session", wait_for_output: false });

    const first = await runWrite({ session_name: "cat-session", input: "alpha", press_enter: false });
    assert.equal(first.ok, true);
    await waitForOutput("cat-session", /alpha/);

    const second = await runWrite({ session_name: "cat-session", input: "beta", press_enter: false });
    assert.equal(second.ok, true);
    await waitForOutput("cat-session", /beta/);

    const output = shellSessionStore.snapshot("cat-session")?.output ?? "";
    assert.match(output, /alpha/);
    assert.match(output, /beta/);

    killSession("cat-session");
  });

  it("serializes concurrent writes to the same session in call order", async () => {
    await runShell({
      command: "for i in 1 2 3; do read -r line; echo line$i:$line; done",
      session_name: "concurrent-session",
      wait_for_output: false,
    });

    const [a, b, c] = await Promise.all([
      runWrite({ session_name: "concurrent-session", input: "aaa" }),
      runWrite({ session_name: "concurrent-session", input: "bbb" }),
      runWrite({ session_name: "concurrent-session", input: "ccc" }),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(c.ok, true);

    await waitUntilFinished("concurrent-session");
    const output = shellSessionStore.snapshot("concurrent-session")?.output ?? "";
    assert.equal(output, "line1:aaa\nline2:bbb\nline3:ccc\n");
  });

  it("returns a write error when the process has closed its stdin", async () => {
    await runShell({
      command: "exec 0<&-; echo ready; sleep 5",
      session_name: "closed-stdin-session",
      wait_for_output: false,
    });
    // Deterministic: once "ready" lands, the child has definitely closed stdin.
    await waitForOutput("closed-stdin-session", /ready/);

    const result = await runWrite({ session_name: "closed-stdin-session", input: "hello" });
    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string; detail?: string };
    assert.equal(error.code, "write_failed");
    assert.match(error.message, /closed-stdin-session/);

    killSession("closed-stdin-session");
  });

  it("never executes the input as a new shell command", async () => {
    await runShell({
      command: "read -r line; echo got:$line",
      session_name: "injection-session",
      wait_for_output: false,
    });

    const payload = "echo pwned; touch should-not-exist.txt";
    const result = await runWrite({
      session_name: "injection-session",
      input: payload,
    });
    assert.equal(result.ok, true);

    await waitUntilFinished("injection-session");
    const output = shellSessionStore.snapshot("injection-session")?.output ?? "";
    // The payload must arrive as one literal line of stdin, not as commands.
    assert.equal(output, `got:${payload}\n`);
    const marker = path.join(workspace, "should-not-exist.txt");
    await assert.rejects(fs.access(marker));
  });
});