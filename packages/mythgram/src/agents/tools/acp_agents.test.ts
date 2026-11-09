import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { connectAcpAgentsTool } from "./connect_acp_agents.js";
import { listAvailableAcpAgentsTool } from "./list_available_acp_agents.js";
import { deleteAcpAgentsTool } from "./delete_acp_agents.js";
import { callConnectedAcpAgentsTool } from "./call_connected_acp_agents.js";
import { interruptAcpAgentTool } from "./interrupt_acp_agent.js";
import { startNewAcpAgentSessionTool } from "./start_new_acp_agent_session.js";
import { createAcpAgentsRuntime } from "../acpAgents.js";
import { MythgramDatabase } from "../../database/index.js";
import { AcpClientManager } from "../../acp-client/manager.js";
import type { ToolContext } from "./types.js";

/**
 * End-to-end tests for the agent-driven ACP tools. They drive a real child process implementing the
 * agent side of ACP (over stdio JSON-RPC), exercising connect/list/call (foreground + background),
 * session reuse, start-new-session, delete, and the unavailable-context guard.
 */

const MOCK_AGENT = String.raw`
import readline from "node:readline";

let counter = 0;
let pendingPromptId = null;
let promptSessionId = null;
let promptText = "";
let permissionId = null;

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}
function update(sessionId, body) {
  send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: body } });
}
function finishPrompt(stopReason = "end_turn") {
  if (pendingPromptId === null) return;
  send({ jsonrpc: "2.0", id: pendingPromptId, result: { stopReason } });
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
        agentCapabilities: { sessionCapabilities: { close: {} } },
        agentInfo: { name: "mock-acp-agent", title: "Mock", version: "1.0.0" },
        authMethods: []
      }
    });
    return;
  }

  if (method === "session/new") {
    counter += 1;
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "agent-session-" + counter } });
    return;
  }

  if (method === "session/prompt") {
    pendingPromptId = message.id;
    promptSessionId = message.params.sessionId;
    const blocks = Array.isArray(message.params.prompt) ? message.params.prompt : [];
    const first = blocks.find((b) => b && b.type === "text");
    promptText = first && typeof first.text === "string" ? first.text : "";
    permissionId = 500 + counter;
    send({
      jsonrpc: "2.0",
      id: permissionId,
      method: "session/request_permission",
      params: {
        sessionId: promptSessionId,
        toolCall: { toolCallId: "c1", title: "Do work", kind: "execute", status: "pending" },
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" }
        ]
      }
    });
    return;
  }

  if (permissionId !== null && message.id === permissionId && ("result" in message || "error" in message)) {
    const allowed = message.result && message.result.outcome && message.result.outcome.outcome === "selected" && message.result.outcome.optionId === "allow-once";
    permissionId = null;
    if (allowed) {
      update(promptSessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "echo:" + promptText } });
    } else {
      update(promptSessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "denied" } });
    }
    finishPrompt();
    return;
  }

  if (method === "session/cancel") {
    finishPrompt("cancelled");
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

function ctxFor(runtime: ReturnType<typeof createAcpAgentsRuntime>, workspaceRoot: string, chatId: string) {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const ctx: ToolContext = {
    workspaceRoot,
    chatId,
    shellTimeoutMs: 10_000,
    acpAgents: runtime,
    emit: (event, data) => events.push({ event, data }),
  };
  return { ctx, events };
}

describe("agent-driven ACP tools", () => {
  let tmp: string;
  let scriptPath: string;
  let db: MythgramDatabase;
  let manager: AcpClientManager;
  let runtime: ReturnType<typeof createAcpAgentsRuntime>;
  let registry: ToolRegistry;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mythgram-acp-tools-"));
    scriptPath = path.join(tmp, "mock-acp-agent.mjs");
    fs.writeFileSync(scriptPath, MOCK_AGENT, "utf8");
    db = MythgramDatabase.open(tmp);
    manager = new AcpClientManager(db, tmp);
    runtime = createAcpAgentsRuntime(manager, tmp);
    registry = new ToolRegistry().registerAll([
      connectAcpAgentsTool,
      listAvailableAcpAgentsTool,
      deleteAcpAgentsTool,
      callConnectedAcpAgentsTool,
      interruptAcpAgentTool,
      startNewAcpAgentSessionTool,
    ]);
  });

  after(() => {
    manager.closeAll();
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("registers all six tools with the exact schema names", () => {
    for (const name of [
      "connect_acp_agents",
      "list_available_acp_agents",
      "delete_acp_agents",
      "call_connected_acp_agents",
      "Interrupt_acp_agent",
      "start_new_acp_agent_session",
    ]) {
      assert.ok(registry.has(name), `${name} must be registered`);
      assert.ok(
        registry.schemas.some((s) => s.function.name === name),
        `${name} must appear in the tools array`,
      );
    }
    const callSchema = registry.schemas.find(
      (s) => s.function.name === "call_connected_acp_agents",
    )!;
    const params = callSchema.function.parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    assert.ok("agents" in (params.properties ?? {}));
    assert.deepEqual(params.required ?? [], ["agents"]);
  });

  it("returns a structured error when the ACP runtime is unavailable", async () => {
    const bare: ToolContext = { workspaceRoot: tmp, shellTimeoutMs: 10_000 };
    const result = await registry.execute("list_available_acp_agents", {}, bare);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "acp_agents_unavailable");
  });

  it("connects, lists, calls (foreground + background), starts a new session, and deletes", async () => {
    const chatId = "chattest1";
    const { ctx, events } = ctxFor(runtime, tmp, chatId);

    // connect_acp_agents
    const connectResult = await registry.execute(
      "connect_acp_agents",
      {
        acp_agent_name: "Mock Agent",
        acp_agent_command: process.execPath,
        acp_agent_args: [scriptPath],
      },
      ctx,
    );
    assert.equal(connectResult.ok, true);
    const connected = connectResult.data as { acp_agent_id: string; status: string; connected: boolean };
    assert.equal(connected.connected, true);
    assert.equal(connected.status, "connected");
    const agentId = connected.acp_agent_id;
    assert.match(agentId, /^[0-9]{20}$/);

    // list_available_acp_agents
    const listResult = await registry.execute("list_available_acp_agents", {}, ctx);
    assert.equal(listResult.ok, true);
    const listed = listResult.data as { count: number; agents: Array<{ acp_agent_id: string }> };
    assert.equal(listed.count, 1);
    assert.equal(listed.agents[0]!.acp_agent_id, agentId);
    assert.ok(events.some((e) => e.event === "acp_agents_updated"));

    // call (wait_for_output true) — auto-approves permission and returns the final message
    const callResult = await registry.execute(
      "call_connected_acp_agents",
      { agents: [{ acp_agent_id: agentId, prompt: "hello world", wait_for_output: true }] },
      ctx,
    );
    assert.equal(callResult.ok, true);
    const callData = callResult.data as { agents: Array<Record<string, unknown>> };
    assert.equal(callData.agents[0]!.ok, true);
    assert.equal(callData.agents[0]!.output, "echo:hello world");

    // Same chat reuses the SAME session (context preserved)
    const sessionsAfterFirstCall = manager.listSessions(agentId);
    assert.equal(sessionsAfterFirstCall.length, 1);
    const reusedSessionId = sessionsAfterFirstCall[0]!.id;

    const secondCall = await registry.execute(
      "call_connected_acp_agents",
      { agents: [{ acp_agent_id: agentId, prompt: "second", wait_for_output: true }] },
      ctx,
    );
    assert.equal(secondCall.ok, true);
    const secondData = secondCall.data as { agents: Array<Record<string, unknown>> };
    assert.equal(secondData.agents[0]!.output, "echo:second");
    assert.equal((secondData.agents[0]!.session_id as string), reusedSessionId);
    assert.equal(manager.listSessions(agentId).length, 1);

    // call (wait_for_output false) — background, writes the final output to a .mythgram/acp file
    const bgCall = await registry.execute(
      "call_connected_acp_agents",
      { agents: [{ acp_agent_id: agentId, prompt: "background task", wait_for_output: false }] },
      ctx,
    );
    assert.equal(bgCall.ok, true);
    const bgData = bgCall.data as { agents: Array<Record<string, unknown>> };
    assert.equal(bgData.agents[0]!.background, true);
    const outputFile = String(bgData.agents[0]!.output_file);
    assert.ok(outputFile.startsWith(".mythgram/acp/"));

    const absOutput = path.join(tmp, ".mythgram", "acp", path.basename(outputFile));
    await waitFor(() => {
      try {
        return fs.readFileSync(absOutput, "utf8").includes("echo:background task");
      } catch {
        return false;
      }
    });
    const fileBody = fs.readFileSync(absOutput, "utf8");
    assert.match(fileBody, /Status: completed/);

    // start_new_acp_agent_session — creates a NEW session and rebinds the chat
    const newSessionResult = await registry.execute(
      "start_new_acp_agent_session",
      { acp_agent_id: agentId },
      ctx,
    );
    assert.equal(newSessionResult.ok, true);
    const newSession = newSessionResult.data as { session_id: string };
    assert.notEqual(newSession.session_id, reusedSessionId);
    assert.equal(manager.listSessions(agentId).length, 2);

    // After a new session, the next call uses the fresh session
    const afterNew = await registry.execute(
      "call_connected_acp_agents",
      { agents: [{ acp_agent_id: agentId, prompt: "fresh", wait_for_output: true }] },
      ctx,
    );
    const afterNewData = afterNew.data as { agents: Array<Record<string, unknown>> };
    assert.equal(afterNewData.agents[0]!.output, "echo:fresh");
    assert.equal(afterNewData.agents[0]!.session_id, newSession.session_id);

    // Interrupt_acp_agent — cancel + send a new prompt; returns the final message
    const interruptResult = await registry.execute(
      "Interrupt_acp_agent",
      { acp_agent_id: agentId, prompt: "changed direction" },
      ctx,
    );
    assert.equal(interruptResult.ok, true);
    assert.equal((interruptResult.data as { output: string }).output, "echo:changed direction");

    // delete_acp_agents
    const deleteResult = await registry.execute("delete_acp_agents", { acp_agent_id: agentId }, ctx);
    assert.equal(deleteResult.ok, true);
    assert.equal(manager.listClients().length, 0);
  });

  it("reports a clear error for an unknown ACP agent id", async () => {
    const { ctx } = ctxFor(runtime, tmp, "chattest2");
    const result = await registry.execute(
      "call_connected_acp_agents",
      { agents: [{ acp_agent_id: "00000000000000000000", prompt: "hi" }] },
      ctx,
    );
    assert.equal(result.ok, true);
    const data = result.data as { agents: Array<Record<string, unknown>>; failed: number };
    assert.equal(data.failed, 1);
    assert.equal(data.agents[0]!.ok, false);
    assert.match(String(data.agents[0]!.error), /No connected ACP agent/);
  });
});
