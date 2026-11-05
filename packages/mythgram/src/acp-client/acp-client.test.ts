import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MythgramDatabase } from "../database/index.js";
import { AcpClientManager } from "./manager.js";
import { createAcpNumericId, createUniqueAcpId, isAcpNumericId } from "./ids.js";

/**
 * End-to-end ACP client test against a real child process implementing the agent
 * side of ACP. It covers initialization, session creation with an app-owned id,
 * streaming updates, a permission round-trip, persistence, and cleanup.
 */

const MOCK_AGENT = String.raw`
import readline from "node:readline";

const agentSessionId = "agent-session-1";
let permissionId = null;
let pendingPromptId = null;
let promptSessionId = null;

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}
function update(sessionId, body) {
  send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: body } });
}
function finishPrompt() {
  if (pendingPromptId === null) return;
  send({ jsonrpc: "2.0", id: pendingPromptId, result: { stopReason: "end_turn" } });
  pendingPromptId = null;
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const method = message.method;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, audio: true, embeddedContext: true },
          sessionCapabilities: { resume: {}, close: {} }
        },
        agentInfo: { name: "mock-agent", title: "Mock ACP Agent", version: "1.2.3" },
        authMethods: []
      }
    });
    return;
  }

  if (method === "session/new") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        sessionId: agentSessionId,
        modes: {
          currentModeId: "ask",
          availableModes: [
            { id: "ask", name: "Ask" },
            { id: "code", name: "Code" }
          ]
        },
        configOptions: [
          {
            id: "model",
            name: "Model",
            type: "select",
            currentValue: "m1",
            options: [
              { value: "m1", name: "Model 1" },
              { value: "m2", name: "Model 2" }
            ]
          }
        ]
      }
    });
    return;
  }

  if (method === "session/prompt") {
    pendingPromptId = message.id;
    promptSessionId = message.params.sessionId;
    update(promptSessionId, { sessionUpdate: "agent_thought_chunk", messageId: "t1", content: { type: "text", text: "thinking..." } });
    update(promptSessionId, { sessionUpdate: "agent_message_chunk", messageId: "a1", content: { type: "text", text: "Hello" } });
    update(promptSessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "call_1",
      title: "Read a file",
      kind: "read",
      status: "pending",
      locations: [{ path: "/tmp/demo.txt" }]
    });
    permissionId = 100;
    send({
      jsonrpc: "2.0",
      id: permissionId,
      method: "session/request_permission",
      params: {
        sessionId: promptSessionId,
        toolCall: { toolCallId: "call_1", title: "Read a file", kind: "read", status: "pending" },
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" }
        ]
      }
    });
    return;
  }

  if (message.id === permissionId && ("result" in message || "error" in message)) {
    const allowed = message.result && message.result.outcome && message.result.outcome.outcome === "selected" && message.result.outcome.optionId === "allow-once";
    permissionId = null;
    update(promptSessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_1",
      status: allowed ? "completed" : "failed",
      content: [
        { type: "content", content: { type: "text", text: allowed ? "file contents" : "denied" } }
      ]
    });
    update(promptSessionId, { sessionUpdate: "agent_message_chunk", messageId: "a1", content: { type: "text", text: " world" } });
    update(promptSessionId, { sessionUpdate: "usage_update", used: 120, size: 1000, cost: { amount: 0.01, currency: "USD" } });
    update(promptSessionId, {
      sessionUpdate: "plan",
      entries: [
        { content: "Inspect", status: "completed", priority: "high" },
        { content: "Answer", status: "in_progress", priority: "medium" }
      ]
    });
    finishPrompt();
    return;
  }

  if (method === "session/set_mode" || method === "session/set_config_option") {
    send({ jsonrpc: "2.0", id: message.id, result: { configOptions: [] } });
    return;
  }

  if (method === "session/cancel") {
    finishPrompt();
    return;
  }

  if (method === "session/close") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }

  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found: " + method } });
  }
});
`;

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for condition."));
      }
    }, 20);
    timer.unref?.();
  });
}

describe("ACP client ids", () => {
  it("mints exact 20-digit numeric ids and validates them", () => {
    for (let i = 0; i < 50; i += 1) {
      const id = createAcpNumericId();
      assert.equal(id.length, 20);
      assert.match(id, /^[0-9]{20}$/);
      assert.equal(isAcpNumericId(id), true);
    }
    assert.equal(isAcpNumericId("123"), false);
    assert.equal(isAcpNumericId("abcdefghijklmnopqrst"), false);
  });

  it("avoids ids already in use", () => {
    const taken = new Set<string>();
    const id = createUniqueAcpId((candidate) => taken.has(candidate));
    assert.equal(isAcpNumericId(id), true);
  });
});

describe("AcpClientManager", () => {
  let tmp: string;
  let scriptPath: string;
  let db: MythgramDatabase;
  let manager: AcpClientManager;

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mythgram-acp-test-"));
    scriptPath = path.join(tmp, "mock-agent.mjs");
    fs.writeFileSync(scriptPath, MOCK_AGENT, "utf8");
    db = MythgramDatabase.open(tmp);
    manager = new AcpClientManager(db, tmp);
  });

  after(() => {
    manager.closeAll();
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("connects, creates an app-owned session and streams a prompt with permissions", async () => {
    const created = manager.createClient({
      name: "Mock agent",
      command: process.execPath,
      args: [scriptPath],
      env: {},
      cwd: tmp,
    });

    assert.match(created.id, /^[0-9]{20}$/);
    const connected = await manager.connect(created.id);
    assert.equal(connected.status, "connected");
    assert.equal(connected.agent?.name, "mock-agent");
    assert.equal(connected.protocolVersion, 1);

    const session = await manager.createSession(created.id, { title: "Test chat" });
    assert.match(session.id, /^[0-9]{20}$/);
    assert.notEqual(session.id, "agent-session-1");
    assert.equal(session.title, "Test chat");
    assert.equal(session.meta.modes?.currentModeId, "ask");

    const emitted: Array<{ event: string; data: Record<string, unknown> }> = [];
    let permissionRequestId = "";
    const prompt = manager.prompt({
      clientId: created.id,
      sessionId: session.id,
      text: "Say hello",
      emit: (event, data) => {
        const record = data as Record<string, unknown>;
        emitted.push({ event, data: record });
        if (event === "permission_request") permissionRequestId = String(record.requestId);
      },
    });

    await waitFor(() => permissionRequestId.length > 0);
    manager.resolvePermission(created.id, session.id, permissionRequestId, "allow-once");
    await prompt;

    assert.ok(emitted.some((entry) => entry.event === "user"));
    assert.ok(
      emitted.some(
        (entry) =>
          entry.event === "update" &&
          (entry.data.update as Record<string, unknown>)?.sessionUpdate === "agent_message_chunk",
      ),
    );
    assert.ok(emitted.some((entry) => entry.event === "permission_request"));
    assert.ok(emitted.some((entry) => entry.event === "permission_resolved"));
    assert.ok(emitted.some((entry) => entry.event === "done"));

    const detail = manager.getSession(created.id, session.id);
    assert.equal(detail.running, false);
    assert.equal(detail.meta.usage?.used, 120);
    assert.equal(detail.events.length > 0, true);
    assert.equal(JSON.stringify(detail).includes("agent-session-1"), false);

    const list = manager.listSessions(created.id);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, session.id);

    const disconnected = await manager.disconnect(created.id);
    assert.equal(disconnected.status, "disconnected");
  });
});