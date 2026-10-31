import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { connectRemoteMcpTool } from "./mcp_connect_remote.js";
import { connectLocalMcpServerTool } from "./mcp_connect_local.js";
import { listAvailableMcpServersTool } from "./mcp_list.js";
import { deleteMcpServerTool } from "./mcp_delete.js";
import { toggleMcpServerTool } from "./mcp_toggle.js";
import { getMcpServerStatusTool } from "./mcp_status.js";
import { McpManager } from "../mcp/manager.js";
import { McpRuntime } from "../mcp/runtime.js";
import type { ToolContext } from "./types.js";
import type { AppConfig } from "../../config.js";

/** Minimal in-memory AppStateRepo stub (only get/set needed by McpManager). */
function makeAppState() {
  const store = new Map<string, unknown>();
  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
      store.set(key, value);
    },
  } as unknown as import("../../database/repositories/appStateRepo.js").AppStateRepo;
}

function makeConfig(): AppConfig {
  return {
    port: 0,
    workspaceRoot: "/tmp/mcp-test-workspace",
    maxIterations: 10,
    corsOrigins: "*",
    shellTimeoutMs: 10_000,
    planApprovalTimeoutMs: 1_000,
    questionTimeoutMs: 1_000,
    searchProvider: "duckduckgo",
    fetchProvider: "builtin",
    tavilyApiKey: "",
    exaApiKey: "",
    serpapiApiKey: "",
    firecrawlApiKey: "",
    composioApiKey: "",
    visionModelPatterns: [],
    textOnlyModelPatterns: [],
    memoryAgentEnabled: false,
    memoryAgentInterval: 3,
  } as AppConfig;
}

describe("agent-driven MCP management tools", () => {
  let registry: ToolRegistry;
  let manager: McpManager;
  let runtime: import("../mcp/runtime.js").McpRuntime;

  beforeEach(async () => {
    registry = new ToolRegistry().registerAll([
      connectRemoteMcpTool,
      connectLocalMcpServerTool,
      listAvailableMcpServersTool,
      deleteMcpServerTool,
      toggleMcpServerTool,
      getMcpServerStatusTool,
    ]);
    manager = new McpManager(makeAppState(), makeConfig());
    runtime = await McpRuntime.create({ manager });
  });

  function ctxFor(extra?: Partial<ToolContext>): ToolContext {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    return {
      workspaceRoot: "/tmp/mcp-test-workspace",
      shellTimeoutMs: 10_000,
      mcp: runtime,
      mcpManager: manager,
      emit: (event, data) => events.push({ event, data }),
      ...extra,
    };
  }

  it("registers all six tools with native function schemas (zod-derived)", () => {
    for (const name of [
      "connect_remote_mcp",
      "connect_local_mcp_server",
      "list_available_mcp_servers",
      "delete_mcp_server",
      "on_off_mcp_server",
      "get_mcp_server_status",
    ]) {
      assert.ok(registry.has(name), `${name} must be registered`);
      const schema = registry.schemas.find((s) => s.function.name === name);
      assert.ok(schema, `${name} must appear in the OpenAI tools array`);
      assert.equal(schema!.type, "function");
    }
    // Required-field contracts from the task spec.
    const remote = registry.schemas.find((s) => s.function.name === "connect_remote_mcp")!;
    const remoteRequired = (remote.function.parameters as { required: string[] }).required;
    assert.deepEqual([...remoteRequired].sort(), ["auth_type", "mcp_server_description", "mcp_server_name", "url"].sort());
    const list = registry.schemas.find((s) => s.function.name === "list_available_mcp_servers")!;
    const listRequired = (list.function.parameters as { required?: string[] }).required ?? [];
    assert.deepEqual(listRequired, []);
  });

  it("list_available_mcp_servers starts empty and reflects created servers", async () => {
    const empty = await registry.execute("list_available_mcp_servers", {}, ctxFor());
    assert.equal(empty.ok, true);
    assert.equal((empty.data as { count: number }).count, 0);

    manager.create({ name: "Docs", description: "Docs server", kind: "remote", url: "https://example.com/mcp" });
    const listed = await registry.execute("list_available_mcp_servers", {}, ctxFor());
    assert.equal(listed.ok, true);
    const data = listed.data as { count: number; servers: Array<{ name: string; description: string; status: string }> };
    assert.equal(data.count, 1);
    assert.equal(data.servers[0]!.name, "Docs");
    assert.equal(data.servers[0]!.description, "Docs server");
    assert.ok(typeof data.servers[0]!.status === "string");
  });

  it("connect_remote_mcp rejects invalid URLs without network", async () => {
    const result = await registry.execute(
      "connect_remote_mcp",
      { mcp_server_name: "Bad", mcp_server_description: "d", url: "not-a-url", auth_type: "no_auth" },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_mcp_url");
  });

  it("connect_remote_mcp rejects duplicate names", async () => {
    manager.create({ name: "Dup", description: "x", kind: "remote", url: "https://example.com/mcp" });
    const result = await registry.execute(
      "connect_remote_mcp",
      { mcp_server_name: "dup", mcp_server_description: "y", url: "https://example.com/other", auth_type: "no_auth" },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "mcp_name_exists");
  });

  it("connect_remote_mcp oauth creates an auth_required record and emits a Connect event", async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const ctx = ctxFor({ emit: (event, data) => events.push({ event, data }) });
    // Abort immediately so the 3-minute OAuth wait resolves fast in tests.
    const controller = new AbortController();
    controller.abort();
    const ctxAborted = { ...ctx, signal: controller.signal };
    const result = await registry.execute(
      "connect_remote_mcp",
      { mcp_server_name: "OAuthSrv", mcp_server_description: "needs oauth", url: "https://example.com/mcp", auth_type: "oauth" },
      ctxAborted,
    );
    // Aborted waits resolve to ok:false/aborted (never hang for 3 minutes).
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "aborted");
    const created = manager.list().find((s) => s.name === "OAuthSrv");
    assert.ok(created, "oauth server record must persist even when the wait aborts");
    assert.equal(created!.authType, "oauth");
    const oauthEvent = events.find((e) => e.event === "mcp_oauth_required");
    assert.ok(oauthEvent, "must emit mcp_oauth_required so the chat UI shows a Connect button");
    assert.equal(oauthEvent!.data.server_name, "OAuthSrv");
  });

  it("connect_local_mcp_server rejects invalid config without spawning", async () => {
    const result = await registry.execute(
      "connect_local_mcp_server",
      { mcp_server_name: "Local", mcp_server_description: "d", mcpconfig_json: { bogus: true } },
      ctxFor(),
    );
    assert.equal(result.ok, false);
    const code = (result.error as { code: string }).code;
    assert.ok(code === "invalid_mcp_config" || code === "mcp_connection_failed");
  });

  it("delete_mcp_server requires an exact name from list_available_mcp_servers", async () => {
    const missing = await registry.execute("delete_mcp_server", { mcp_server_name: "Nope" }, ctxFor());
    assert.equal(missing.ok, false);
    assert.equal((missing.error as { code: string }).code, "mcp_not_found");

    manager.create({ name: "Temp", description: "t", kind: "remote", url: "https://example.com/mcp" });
    const deleted = await registry.execute("delete_mcp_server", { mcp_server_name: "temp" }, ctxFor());
    assert.equal(deleted.ok, true);
    assert.equal((deleted.data as { deleted: boolean }).deleted, true);
    assert.equal(manager.list().find((s) => s.name === "Temp"), undefined);
  });

  it("on_off_mcp_server disables immediately and re-enables", async () => {
    manager.create({ name: "Toggle", description: "t", kind: "remote", url: "https://example.com/mcp" });
    const off = await registry.execute("on_off_mcp_server", { mcp_server_name: "Toggle", status: "off" }, ctxFor());
    assert.equal(off.ok, true);
    assert.equal(manager.get(manager.list().find((s) => s.name === "Toggle")!.id)?.enabled, false);

    const on = await registry.execute("on_off_mcp_server", { mcp_server_name: "Toggle", status: "on" }, ctxFor());
    assert.equal(on.ok, true);
    assert.equal(manager.get(manager.list().find((s) => s.name === "Toggle")!.id)?.enabled, true);
  });

  it("get_mcp_server_status returns name, description, and connection status", async () => {
    manager.create({ name: "Stat", description: "status check", kind: "remote", url: "https://example.com/mcp" });
    const result = await registry.execute("get_mcp_server_status", { mcp_server_name: "stat" }, ctxFor());
    assert.equal(result.ok, true);
    const data = result.data as { server_name: string; description: string; status: string };
    assert.equal(data.server_name, "Stat");
    assert.equal(data.description, "status check");
    assert.ok(typeof data.status === "string");
  });

  it("management tools are unavailable without a manager (sub-agent/chat context)", async () => {
    const bare: ToolContext = { workspaceRoot: "/tmp", shellTimeoutMs: 10_000 };
    const result = await registry.execute("list_available_mcp_servers", {}, bare);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "mcp_unavailable");
  });
});
