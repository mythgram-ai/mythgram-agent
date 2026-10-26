import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { listAvailableApplicationConnectorsTool } from "./list_available_application_connectors.js";
import { connectApplicationsConnectorsTool } from "./connect_applications_connectors.js";
import { disconnectApplicationConnectorTool } from "./disconnect_application_connector.js";
import { getApplicationConnectorStatusTool } from "./get_application_connector_status.js";
import {
  CONNECTOR_MANAGEMENT_TOOL_NAMES,
  connectorCatalog,
  normalizeConnectorName,
  waitForConnectorConnection,
} from "./connectorManagement.js";
import { SUB_AGENT_RESTRICTED_TOOLS } from "./subAgentRestrictedTools.js";
import { ConnectorManager } from "../connectors/manager.js";
import { ConnectorRuntime, ConnectorToolCache } from "../connectors/runtime.js";
import type { ComposioClient, ComposioToolDefinition } from "../connectors/index.js";
import type { ToolContext } from "./types.js";

/** Minimal in-memory AppStateRepo stub (only get/set needed by ConnectorManager). */
function makeAppState() {
  const store = new Map<string, unknown>();
  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
      store.set(key, value);
    },
  } as unknown as import("../../database/repositories/appStateRepo.js").AppStateRepo;
}

/** The two GitHub tools the fake provider serves; enough to prove real availability. */
function fakeTools(toolkitSlug: string): ComposioToolDefinition[] {
  return [
    {
      slug: `${toolkitSlug.toUpperCase()}_CREATE_ISSUE`,
      name: "Create an issue",
      description: "Open a new issue in a repository.",
      inputParameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
      toolkitSlug,
      toolkitName: toolkitSlug,
      toolkitLogo: "",
    },
    {
      slug: `${toolkitSlug.toUpperCase()}_LIST_REPOS`,
      name: "List repositories",
      description: "List the repositories of the authenticated user.",
      inputParameters: { type: "object", properties: {} },
      toolkitSlug,
      toolkitName: toolkitSlug,
      toolkitLogo: "",
    },
  ];
}

interface FakeComposioOptions {
  /** Status the provider reports for a linked account (default: authorized). */
  accountStatus?: string;
  /** Per-account statuses, keyed by connected-account id (overrides accountStatus). */
  accountStatuses?: Record<string, string>;
  /** Fail every call on this method to exercise error paths. */
  failOn?: "findAuthConfig" | "createAuthConfig" | "createLink" | "deleteConnectedAccount" | "getConnectedAccount" | "listTools";
}

interface FakeComposio extends ComposioClient {
  calls: { authConfigs: number; links: number; deletes: number; polls: number };
  setAccountStatus: (connectedAccountId: string, status: string) => void;
}

/**
 * A Composio client stub covering exactly the surface the four tools use, so the whole
 * OAuth connect → poll → attach flow runs end-to-end without network access.
 */
function makeFakeComposio(options: FakeComposioOptions = {}): FakeComposio {
  const calls = { authConfigs: 0, links: 0, deletes: 0, polls: 0 };
  const statuses = new Map<string, string>(Object.entries(options.accountStatuses ?? {}));
  const guard = (name: NonNullable<FakeComposioOptions["failOn"]>): void => {
    if (options.failOn === name) throw new Error(`fake ${name} failure`);
  };
  const client = {
    calls,
    setAccountStatus: (id: string, status: string) => statuses.set(id, status),
    configured: true,
    async findAuthConfig(toolkitSlug: string) {
      guard("findAuthConfig");
      calls.authConfigs += 1;
      return {
        id: `auth_${toolkitSlug}`,
        type: "default",
        status: "ENABLED",
        authScheme: "OAUTH2",
        isComposioManaged: true,
        toolkitSlug,
        createdAt: "2026-01-01T00:00:00Z",
      };
    },
    async createAuthConfig(toolkitSlug: string) {
      guard("createAuthConfig");
      calls.authConfigs += 1;
      return {
        id: `auth_${toolkitSlug}`,
        type: "use_composio_managed_auth",
        status: "ENABLED",
        authScheme: "OAUTH2",
        isComposioManaged: true,
        toolkitSlug,
        createdAt: "2026-01-01T00:00:00Z",
      };
    },
    async createLink() {
      guard("createLink");
      calls.links += 1;
      return {
        redirectUrl: "https://auth.composio.dev/authorize?state=test",
        connectedAccountId: "acct_test_1",
      };
    },
    async getConnectedAccount(id: string) {
      calls.polls += 1;
      guard("getConnectedAccount");
      return {
        id,
        status: statuses.get(id) ?? options.accountStatus ?? "active",
        toolkitSlug: "github",
        userId: "default",
      };
    },
    async deleteConnectedAccount() {
      calls.deletes += 1;
      guard("deleteConnectedAccount");
    },
    async listTools(toolkitSlug: string) {
      guard("listTools");
      return fakeTools(toolkitSlug);
    },
    async executeTool() {
      return { successful: true, data: { ok: true }, error: null };
    },
    async getToolkit() {
      return null;
    },
  };
  return client as unknown as FakeComposio;
}

describe("agent-driven application-connector management tools", () => {
  let registry: ToolRegistry;
  let manager: ConnectorManager;

  beforeEach(() => {
    registry = new ToolRegistry().registerAll([
      listAvailableApplicationConnectorsTool,
      connectApplicationsConnectorsTool,
      disconnectApplicationConnectorTool,
      getApplicationConnectorStatusTool,
    ]);
    manager = new ConnectorManager(makeAppState());
  });

  /**
   * Build a turn with a connector runtime wired to the fake provider. Starting with no
   * connections is the realistic case: the agent connects an app mid-turn and must be
   * able to use it on the very next model iteration. `connections` seeds BOTH the
   * persisted manager and the turn's runtime, exactly like a real turn does.
   */
  async function ctxFor(
    options: FakeComposioOptions & {
      connections?: Array<{ connectorId: string; connectedAccountId: string }>;
    } = {},
  ) {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const client = makeFakeComposio(options);
    for (const connection of options.connections ?? []) {
      manager.upsertPending(
        connection.connectorId as Parameters<ConnectorManager["upsertPending"]>[0],
        connection.connectedAccountId,
      );
      manager.markStatus(
        connection.connectorId as Parameters<ConnectorManager["markStatus"]>[0],
        "active",
      );
    }
    const runtime = await ConnectorRuntime.create({
      apiKey: "test-composio-key",
      connections: (options.connections ?? []) as never,
      clientFactory: () => client,
      cache: new ConnectorToolCache(),
    });
    const ctx: ToolContext = {
      workspaceRoot: "/tmp/connector-test-workspace",
      shellTimeoutMs: 10_000,
      connectorManager: manager,
      connectors: runtime,
      emit: (event, data) => events.push({ event, data }),
    };
    return { ctx, events, client, runtime, manager };
  }

  it("registers all four tools with native function schemas (zod-derived, strict)", () => {
    for (const name of CONNECTOR_MANAGEMENT_TOOL_NAMES) {
      assert.ok(registry.has(name), `${name} must be registered`);
      const schema = registry.schemas.find((s) => s.function.name === name);
      assert.ok(schema, `${name} must appear in the OpenAI tools array`);
      assert.equal(schema!.type, "function");
      assert.equal(
        (schema!.function.parameters as { additionalProperties?: boolean }).additionalProperties,
        false,
        `${name} must forbid additional properties`,
      );
    }
    // Required-field contracts from the task spec.
    const requiredOf = (name: string): string[] =>
      (
        (registry.schemas.find((s) => s.function.name === name)!.function.parameters as {
          required?: string[];
        }).required ?? []
      )
        .slice()
        .sort();
    assert.deepEqual(requiredOf("connect_applications_connectors"), ["connector_name"]);
    assert.deepEqual(requiredOf("list_available_application_connectors"), []);
    assert.deepEqual(requiredOf("disconnect_application_connector"), ["connector_name"]);
    assert.deepEqual(requiredOf("get_application_connector_status"), ["connector_name"]);

    // list_available_application_connectors takes no properties at all.
    const list = registry.schemas.find((s) => s.function.name === "list_available_application_connectors")!;
    const properties = (list.function.parameters as { properties?: Record<string, unknown> }).properties;
    assert.deepEqual(properties ?? {}, {});
  });

  it("lists the full connector catalog and reflects connection state", async () => {
    const { ctx } = await ctxFor();
    const listed = await registry.execute("list_available_application_connectors", {}, ctx);
    assert.equal(listed.ok, true);
    const data = listed.data as {
      count: number;
      connected_count: number;
      connectors: Array<{ connector_name: string; label: string; status: string; connected: boolean }>;
    };
    assert.ok(data.count >= 5, "the catalog must expose every supported app");
    assert.equal(data.connected_count, 0);
    const github = data.connectors.find((c) => c.connector_name === "github");
    assert.ok(github, "github must be listed");
    assert.equal(github!.label, "GitHub");
    assert.equal(github!.status, "disconnected");
    assert.equal(github!.connected, false);

    // A stored connection shows up as connected.
    manager.upsertPending("github", "acct_1");
    manager.markStatus("github", "active");
    const after = await registry.execute("list_available_application_connectors", {}, ctx);
    const afterData = after.data as { connected_count: number };
    assert.equal(afterData.connected_count, 1);
  });

  it("normalizes connector names case- and label-insensitively", () => {
    assert.equal(normalizeConnectorName("github"), "github");
    assert.equal(normalizeConnectorName("  GitHub "), "github");
    assert.equal(normalizeConnectorName("NOTION"), "notion");
    assert.equal(normalizeConnectorName("Git Hub"), "github", "spacing must not block the agent");
    assert.equal(normalizeConnectorName("Slack"), "slack");
    assert.equal(normalizeConnectorName("nope"), null);
    assert.equal(normalizeConnectorName("Google Drive"), null);
    assert.equal(normalizeConnectorName(42), null);
    assert.equal(normalizeConnectorName(""), null);
    // Every catalog entry is reachable by its own exact name.
    for (const entry of connectorCatalog()) {
      assert.equal(normalizeConnectorName(entry.connector_name), entry.connector_name);
    }
  });

  it("rejects unknown connector names with the list of valid ones", async () => {
    const { ctx } = await ctxFor();
    for (const tool of [
      "connect_applications_connectors",
      "disconnect_application_connector",
      "get_application_connector_status",
    ]) {
      const result = await registry.execute(tool, { connector_name: "dropbox" }, ctx);
      assert.equal(result.ok, false, `${tool} must reject an unknown connector`);
      assert.equal((result.error as { code: string }).code, "unknown_connector");
      assert.match((result.error as { message: string }).message, /github/);
    }
  });

  it("connects an app, attaches its native tools to the live turn, and emits the Connect event", async () => {
    const { ctx, events, client, runtime } = await ctxFor();
    // Nothing is connected when the turn starts.
    assert.equal(runtime.active, false);

    const result = await registry.execute(
      "connect_applications_connectors",
      { connector_name: "github" },
      ctx,
    );
    assert.equal(result.ok, true);
    const data = result.data as { connected: boolean; tool_count: number; tools: string[] };
    assert.equal(data.connected, true);
    assert.equal(data.tool_count, 2);
    assert.ok(data.tools.includes("GITHUB_CREATE_ISSUE"));

    // The OAuth session really was opened and the account really was polled.
    assert.equal(client.calls.links, 1);
    assert.ok(client.calls.polls >= 1);

    // The connection is persisted as ACTIVE.
    assert.equal(manager.get("github")?.status, "active");

    // *** The whole point: the app's tools are native function tools on THIS turn. ***
    assert.equal(runtime.active, true);
    assert.equal(runtime.has("GITHUB_CREATE_ISSUE"), true);
    assert.equal(runtime.has("GITHUB_LIST_REPOS"), true);
    const schemas = runtime.schemas();
    assert.ok(schemas.some((s) => s.function.name === "GITHUB_CREATE_ISSUE"));
    const issue = schemas.find((s) => s.function.name === "GITHUB_CREATE_ISSUE")!;
    assert.deepEqual((issue.function.parameters as { required: string[] }).required, ["title"]);

    // The chat UI got both the Connect button payload and the refreshed connection list.
    const connectEvent = events.find((e) => e.event === "connector_connect_required");
    assert.ok(connectEvent, "must emit connector_connect_required so the UI shows a Connect button");
    assert.equal(connectEvent!.data.connector_name, "github");
    assert.equal(connectEvent!.data.connector_label, "GitHub");
    assert.match(String(connectEvent!.data.redirect_url), /^https:\/\//);
    assert.equal(connectEvent!.data.connected_account_id, "acct_test_1");
    assert.equal(connectEvent!.data.tool_call_id, undefined);
    const updated = events.filter((e) => e.event === "connectors_updated");
    assert.ok(updated.length >= 2, "must emit the refreshed connection list (pending + active)");
    const lastList = updated[updated.length - 1]!.data.connectors as Array<{ connectorId: string; status: string }>;
    assert.equal(lastList[0]!.connectorId, "github");
    assert.equal(lastList[0]!.status, "active");

    // The attached tools really execute through the provider.
    const executed = await runtime.execute("GITHUB_CREATE_ISSUE", { title: "Bug" });
    assert.equal(executed.ok, true);
  });

  it("connects an app that is already connected without reopening the OAuth session", async () => {
    const { ctx, client } = await ctxFor({
      connections: [{ connectorId: "notion", connectedAccountId: "acct_9" }],
    });
    manager.markStatus("notion", "active", "team@acme.com");

    const result = await registry.execute(
      "connect_applications_connectors",
      { connector_name: "notion" },
      ctx,
    );
    assert.equal(result.ok, true);
    const data = result.data as { already_connected: boolean; connected: boolean; account_label: string };
    assert.equal(data.already_connected, true);
    assert.equal(data.connected, true);
    assert.equal(data.account_label, "team@acme.com");
    assert.equal(client.calls.links, 0, "an already-connected app must not re-prompt the user");
  });

  it("reports a missing Composio key instead of failing opaquely", async () => {
    // No API key => the runtime holds no client => connectors cannot be managed.
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const runtime = await ConnectorRuntime.create({
      apiKey: "",
      connections: [],
      cache: new ConnectorToolCache(),
    });
    const result = await registry.execute(
      "connect_applications_connectors",
      { connector_name: "github" },
      {
        workspaceRoot: "/tmp",
        shellTimeoutMs: 10_000,
        connectorManager: manager,
        connectors: runtime,
        emit: (event, data) => events.push({ event, data }),
      },
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "composio_key_missing");
    assert.match((result.error as { message: string }).message, /Composio/);
    assert.equal(manager.get("github"), null, "no half-created record may be left behind");
  });

  it("surfaces provider failures without persisting a bogus connection", async () => {
    const { ctx } = await ctxFor({ failOn: "createLink" });
    const result = await registry.execute(
      "connect_applications_connectors",
      { connector_name: "github" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.match((result.error as { message: string }).message, /fake createLink failure/);
    assert.equal(manager.get("github"), null);
  });

  it("persists the pending connection and reports it when the user does not finish in time", async () => {
    const { ctx, manager: mgr } = await ctxFor({ accountStatus: "initiated" });
    mgr.upsertPending("github", "acct_test_1");

    // Poll with an already-elapsed deadline: the wait resolves immediately, no 3-minute stall.
    const outcome = await waitForConnectorConnection(mgr, ctx.connectors!.composioClient(), "github", {
      timeoutMs: 0,
      signal: new AbortController().signal,
    });
    assert.equal(outcome.status, "pending");
    assert.equal(mgr.get("github")?.status, "pending", "the pending record must survive the timeout");

    // Aborting mid-flow resolves fast and leaves the saved connection in place.
    const controller = new AbortController();
    controller.abort();
    const aborted = await waitForConnectorConnection(mgr, ctx.connectors!.composioClient(), "github", {
      signal: controller.signal,
    });
    assert.equal(aborted.status, "aborted");

    // And through the tool: the request aborts without hanging the turn.
    mgr.upsertPending("slack", "acct_slack");
    const abortedTool = await registry.execute(
      "connect_applications_connectors",
      { connector_name: "slack" },
      { ...ctx, signal: controller.signal },
    );
    assert.equal(abortedTool.ok, false);
    assert.equal((abortedTool.error as { code: string }).code, "aborted");
    assert.ok(mgr.get("slack"), "the saved connection must survive an aborted request");
  });

  it("disconnects an app and removes its tools from the live turn", async () => {
    const { ctx, client, runtime, events } = await ctxFor({
      connections: [{ connectorId: "github", connectedAccountId: "acct_test_1" }],
    });
    assert.equal(runtime.has("GITHUB_CREATE_ISSUE"), true);

    const result = await registry.execute(
      "disconnect_application_connector",
      { connector_name: "github" },
      ctx,
    );
    assert.equal(result.ok, true);
    const data = result.data as { disconnected: boolean; removed_tools: number; remote_cleanup_failed: boolean };
    assert.equal(data.disconnected, true);
    assert.equal(data.removed_tools, 2);
    assert.equal(data.remote_cleanup_failed, false);

    assert.equal(client.calls.deletes, 1, "the provider account must be revoked");
    assert.equal(manager.get("github"), null);
    assert.equal(runtime.has("GITHUB_CREATE_ISSUE"), false, "detached tools must not stay callable");
    assert.equal(runtime.active, false);
    const updated = events.filter((e) => e.event === "connectors_updated");
    assert.deepEqual(updated[updated.length - 1]!.data.connectors, []);
  });

  it("disconnects locally even when the provider refuses to revoke", async () => {
    const { ctx } = await ctxFor({
      connections: [{ connectorId: "github", connectedAccountId: "acct_test_1" }],
      failOn: "deleteConnectedAccount",
    });
    const result = await registry.execute(
      "disconnect_application_connector",
      { connector_name: "github" },
      ctx,
    );
    assert.equal(result.ok, true, "a stale remote account must not block a local disconnect");
    assert.equal((result.data as { remote_cleanup_failed: boolean }).remote_cleanup_failed, true);
    assert.equal(manager.get("github"), null);
  });

  it("disconnecting an app that is not connected is an explicit error", async () => {
    const { ctx } = await ctxFor();
    const result = await registry.execute(
      "disconnect_application_connector",
      { connector_name: "github" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "connector_not_connected");
  });

  it("reports connector status and re-polls it so a finished authorization is seen at once", async () => {
    const { ctx } = await ctxFor();

    const disconnected = await registry.execute(
      "get_application_connector_status",
      { connector_name: "github" },
      ctx,
    );
    assert.equal(disconnected.ok, true);
    const before = disconnected.data as { status: string; connected: boolean; tools_usable: boolean };
    assert.equal(before.status, "disconnected");
    assert.equal(before.connected, false);
    assert.equal(before.tools_usable, false);

    // The user authorizes out-of-band: only Composio knows, the record still says pending.
    manager.upsertPending("github", "acct_test_1");
    const pending = await registry.execute(
      "get_application_connector_status",
      { connector_name: "github" },
      ctx,
    );
    const pendingData = pending.data as { status: string; requires_user_action: boolean };
    assert.equal(pendingData.status, "connected", "the status call must re-poll Composio");
    assert.equal(pendingData.requires_user_action, false);
    assert.equal(manager.get("github")?.status, "active");

    // A connection whose authorization was rejected is reported as failed + disabled.
    manager.upsertPending("slack", "acct_slack");
    manager.markStatus("slack", "failed");
    const { ctx: slackCtx, client } = await ctxFor();
    client.setAccountStatus("acct_slack", "failed");
    const failed = await registry.execute(
      "get_application_connector_status",
      { connector_name: "slack" },
      slackCtx,
    );
    const failedData = failed.data as { status: string; disabled: boolean };
    assert.equal(failedData.status, "failed");
    assert.equal(failedData.disabled, true);
  });

  it("all four tools are unavailable without a manager (sub-agent / chat context)", async () => {
    const bare: ToolContext = { workspaceRoot: "/tmp", shellTimeoutMs: 10_000 };
    for (const name of CONNECTOR_MANAGEMENT_TOOL_NAMES) {
      const result = await registry.execute(
        name,
        name === "list_available_application_connectors" ? {} : { connector_name: "github" },
        bare,
      );
      assert.equal(result.ok, false, `${name} must refuse outside a managed context`);
      assert.equal((result.error as { code: string }).code, "connectors_unavailable");
    }
  });

  it("all four tools are restricted from the sub-agent system", () => {
    for (const name of CONNECTOR_MANAGEMENT_TOOL_NAMES) {
      assert.ok(
        SUB_AGENT_RESTRICTED_TOOLS.includes(name),
        `${name} must be restricted from sub-agents`,
      );
    }
  });
});
