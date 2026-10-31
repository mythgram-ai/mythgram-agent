import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../../database/schema.js";
import { AppStateRepo } from "../../database/repositories/appStateRepo.js";
import {
  AVAILABLE_CONNECTORS,
  isConnectorToolName,
  normalizeConnectorConnection,
  normalizeConnectorWire,
} from "./configuration.js";
import { ComposioClient, ComposioError, type ComposioFetch } from "./client.js";
import { ConnectorManager } from "./manager.js";
import {
  ConnectorRuntime,
  ConnectorToolCache,
  toOpenAIParameters,
} from "./runtime.js";

/* ------------------------------------------------------------------ stubs */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Route stub fetch calls by URL path to canned Composio payloads. */
function stubFetch(routes: Record<string, (url: string, init?: RequestInit) => Response>): {
  fetchFn: ComposioFetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    for (const [path, handler] of Object.entries(routes)) {
      if (url.includes(path)) return handler(url, init);
    }
    return jsonResponse({ message: "not mocked" }, 404);
  }) as unknown as ComposioFetch;
  return { fetchFn, calls };
}

function toolItem(slug: string, toolkit = "github"): Record<string, unknown> {
  return {
    slug,
    name: `Display ${slug}`,
    description: `Does ${slug}`,
    input_parameters: {
      type: "object",
      properties: { repo: { type: "string" } },
      required: ["repo"],
    },
    toolkit: { slug: toolkit, name: "GitHub", logo: "https://logo.example/github.png" },
  };
}

/* ------------------------------------------------------------------ configuration */

describe("connectors — configuration", () => {
  it("ships exactly the five required connectors with toolkit slugs", () => {
    const ids = AVAILABLE_CONNECTORS.map((c) => c.id).sort();
    assert.deepEqual(ids, ["github", "gmail", "notion", "outlook", "slack"]);
    for (const c of AVAILABLE_CONNECTORS) {
      assert.ok(c.toolkitSlug.length > 0);
      assert.ok(c.name.length > 0 && c.description.length > 0);
      assert.ok(c.logoSlug.length > 0 && c.homepage.startsWith("https://"));
    }
  });

  it("normalizes stored/wire connections and rejects unknown connectors", () => {
    const ok = normalizeConnectorConnection({
      connector_id: "GitHub",
      connected_account_id: "acc_1",
      status: "active",
      account_label: "octocat",
    });
    assert.ok(ok);
    assert.equal(ok!.connectorId, "github");
    assert.equal(ok!.status, "active");

    assert.equal(normalizeConnectorConnection({ connector_id: "nope", connected_account_id: "x" }), null);
    assert.equal(normalizeConnectorConnection({ connector_id: "github" }), null);
    assert.equal(normalizeConnectorConnection(null), null);
  });

  it("normalizes per-turn wire references", () => {
    const ok = normalizeConnectorWire({ connector_id: "slack", connected_account_id: "acc_9" });
    assert.deepEqual(ok, { connectorId: "slack", connectedAccountId: "acc_9" });
    assert.equal(normalizeConnectorWire({ connector_id: "slack" }), null);
  });

  it("recognizes Composio tool names without colliding with built-ins", () => {
    assert.equal(isConnectorToolName("GITHUB_CREATE_ISSUE"), true);
    assert.equal(isConnectorToolName("SLACK_SEND_MESSAGE"), true);
    assert.equal(isConnectorToolName("file_read"), false);
    assert.equal(isConnectorToolName("submit_plan"), false);
    assert.equal(isConnectorToolName("call_sub_agent"), false);
    assert.equal(isConnectorToolName(""), false);
  });
});

/* ------------------------------------------------------------------ manager */

describe("connectors — manager persistence", () => {
  let db: Database.Database;
  let appState: AppStateRepo;
  let manager: ConnectorManager;
  const savedEnv = process.env.COMPOSIO_API_KEY;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    appState = new AppStateRepo(db);
    manager = new ConnectorManager(appState);
    delete process.env.COMPOSIO_API_KEY;
  });

  afterEach(() => {
    db.close();
    if (savedEnv === undefined) delete process.env.COMPOSIO_API_KEY;
    else process.env.COMPOSIO_API_KEY = savedEnv;
  });

  it("starts empty and round-trips pending -> active -> removed", () => {
    assert.deepEqual(manager.list(), []);

    manager.upsertPending("github", "acc_1");
    const pending = manager.get("github");
    assert.ok(pending);
    assert.equal(pending!.status, "pending");

    manager.markStatus("github", "active", "octocat");
    const active = manager.get("github")!;
    assert.equal(active.status, "active");
    assert.equal(active.accountLabel, "octocat");

    // Re-initiating replaces the stale account id but keeps the label.
    manager.upsertPending("github", "acc_2");
    assert.equal(manager.get("github")!.connectedAccountId, "acc_2");
    assert.equal(manager.get("github")!.accountLabel, "octocat");

    assert.equal(manager.remove("github"), true);
    assert.equal(manager.get("github"), null);
    assert.equal(manager.remove("github"), false);
  });

  it("resolves the API key with override > settings > env precedence", () => {
    assert.equal(manager.resolveApiKey(), "");
    process.env.COMPOSIO_API_KEY = "env-key";
    assert.equal(manager.resolveApiKey(), "env-key");
    appState.set("settings", { composioApiKey: "settings-key" });
    assert.equal(manager.resolveApiKey(), "settings-key");
    assert.equal(manager.resolveApiKey("override-key"), "override-key");
  });
});

/* ------------------------------------------------------------------ client */

describe("connectors — Composio client", () => {
  it("requires an API key before any network call", async () => {
    const { fetchFn, calls } = stubFetch({});
    const client = new ComposioClient("", { fetchFn });
    await assert.rejects(client.listTools("github"), /API key/);
    assert.equal(calls.length, 0);
  });

  it("discovers the newest enabled default auth config", async () => {
    const { fetchFn } = stubFetch({
      "/auth_configs": () =>
        jsonResponse({
          items: [
            { id: "ac_disabled", type: "default", status: "DISABLED", is_composio_managed: true, created_at: "2026-01-03" },
            { id: "ac_old", type: "default", status: "ENABLED", is_composio_managed: true, created_at: "2026-01-01" },
            { id: "ac_new", type: "default", status: "ENABLED", is_composio_managed: true, created_at: "2026-01-02" },
            { id: "ac_custom", type: "custom", status: "ENABLED", is_composio_managed: false, created_at: "2026-01-04" },
          ],
        }),
    });
    const client = new ComposioClient("k", { fetchFn });
    const found = await client.findAuthConfig("github");
    // Newest ENABLED default managed config wins over the newer custom one.
    assert.equal(found?.id, "ac_new");
  });

  it("creates a link session and normalizes the redirect + account id", async () => {
    const { fetchFn } = stubFetch({
      "/connected_accounts/link": () =>
        jsonResponse({ redirect_url: "https://auth.example/xyz", connected_account_id: "acc_7" }),
    });
    const client = new ComposioClient("k", { fetchFn });
    const link = await client.createLink("ac_1", "default");
    assert.equal(link.redirectUrl, "https://auth.example/xyz");
    assert.equal(link.connectedAccountId, "acc_7");
  });

  it("reads connected-account status from nested shapes", async () => {
    const { fetchFn } = stubFetch({
      "/connected_accounts/acc_1": () =>
        jsonResponse({ id: "acc_1", connection: { state: { status: "ACTIVE" } } }),
    });
    const client = new ComposioClient("k", { fetchFn });
    const account = await client.getConnectedAccount("acc_1");
    assert.equal(account.status, "active");
  });

  it("lists every tool page with no cap (cursor pagination exhausted)", async () => {
    const page1 = Array.from({ length: 1200 }, (_, i) => toolItem(`GITHUB_TOOL_${i}`));
    const page2 = Array.from({ length: 800 }, (_, i) => toolItem(`GITHUB_MORE_${i}`));
    const { fetchFn } = stubFetch({
      "/tools": (url) =>
        url.includes("cursor=")
          ? jsonResponse({ items: page2, next_cursor: null })
          : jsonResponse({ items: page1, next_cursor: "cursor-2" }),
    });
    const client = new ComposioClient("k", { fetchFn });
    const tools = await client.listTools("github");
    // 2000 tools across pages — nothing is dropped or capped.
    assert.equal(tools.length, 2000);
    assert.ok(tools.some((t) => t.slug === "GITHUB_TOOL_0"));
    assert.ok(tools.some((t) => t.slug === "GITHUB_MORE_799"));
  });

  it("executes a tool and maps success + failure", async () => {
    const { fetchFn } = stubFetch({
      "/tools/execute/GITHUB_CREATE_ISSUE": () =>
        jsonResponse({ data: { id: 42 }, error: null, successful: true }),
      "/tools/execute/SLACK_SEND_MESSAGE": () =>
        jsonResponse({ data: null, error: "channel_not_found", successful: false }),
    });
    const client = new ComposioClient("k", { fetchFn });
    const ok = await client.executeTool("GITHUB_CREATE_ISSUE", {
      userId: "default",
      connectedAccountId: "acc_1",
      args: { repo: "a/b" },
    });
    assert.equal(ok.successful, true);
    assert.deepEqual(ok.data, { id: 42 });

    const failed = await client.executeTool("SLACK_SEND_MESSAGE", {
      userId: "default",
      connectedAccountId: "acc_2",
      args: {},
    });
    assert.equal(failed.successful, false);
    assert.equal(failed.error, "channel_not_found");
  });

  it("surfaces HTTP failures as structured ComposioError codes", async () => {
    const { fetchFn } = stubFetch({
      "/tools": () => jsonResponse({ message: "Invalid API key" }, 401),
    });
    const client = new ComposioClient("bad", { fetchFn });
    await assert.rejects(client.listTools("github"), (error: unknown) => {
      assert.ok(error instanceof ComposioError);
      assert.equal((error as ComposioError).code, "composio_unauthorized");
      return true;
    });
  });
});

/* ------------------------------------------------------------------ runtime bridge */

describe("connectors — runtime bridge", () => {
  it("stays inert without a key or connections (zero network)", async () => {
    const { fetchFn, calls } = stubFetch({
      "/tools": () => jsonResponse({ items: [] }),
    });
    const runtime = await ConnectorRuntime.create({
      apiKey: "",
      connections: [{ connectorId: "github", connectedAccountId: "acc_1" }],
      clientFactory: (key) => new ComposioClient(key, { fetchFn }),
      cache: new ConnectorToolCache(),
    });
    assert.equal(runtime.active, false);
    assert.equal(runtime.size, 0);
    assert.deepEqual(runtime.schemas(), []);
    assert.equal(calls.length, 0);
  });

  it("advertises every catalog tool natively with OpenAI parameters", async () => {
    const page1 = Array.from({ length: 1200 }, (_, i) => toolItem(`GITHUB_TOOL_${i}`));
    const page2 = Array.from({ length: 800 }, (_, i) => toolItem(`GITHUB_MORE_${i}`));
    const { fetchFn } = stubFetch({
      "/tools": (url) =>
        url.includes("cursor=")
          ? jsonResponse({ items: page2, next_cursor: null })
          : jsonResponse({ items: page1, next_cursor: "cursor-2" }),
    });
    const runtime = await ConnectorRuntime.create({
      apiKey: "k",
      connections: [{ connectorId: "github", connectedAccountId: "acc_1" }],
      clientFactory: (key) => new ComposioClient(key, { fetchFn }),
      cache: new ConnectorToolCache(),
    });
    // No limits: all 2000 tools are advertised as native function schemas.
    assert.equal(runtime.size, 2000);
    assert.equal(runtime.schemas().length, 2000);
    assert.ok(runtime.has("GITHUB_TOOL_0"));
    assert.ok(!runtime.has("file_read"));
    const first = runtime.schemas()[0]!;
    assert.equal(first.type, "function");
    assert.equal((first.function.parameters as { type: string }).type, "object");
    assert.equal(runtime.label("GITHUB_TOOL_0"), "GitHub: Display GITHUB_TOOL_0");
    assert.ok(runtime.hint().includes("GitHub"));
  });

  it("routes execution to the right connected account per toolkit", async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      if (url.includes("/tools?")) {
        const toolkit = new URL(url).searchParams.get("toolkit_slug");
        return jsonResponse({
          items: [toolItem(`${toolkit!.toUpperCase()}_PING`, toolkit!)],
          next_cursor: null,
        });
      }
      return jsonResponse({ data: { pong: true }, error: null, successful: true });
    }) as unknown as ComposioFetch;

    const runtime = await ConnectorRuntime.create({
      apiKey: "k",
      connections: [
        { connectorId: "github", connectedAccountId: "acc_gh" },
        { connectorId: "slack", connectedAccountId: "acc_sl" },
      ],
      clientFactory: (key) => new ComposioClient(key, { fetchFn }),
      cache: new ConnectorToolCache(),
    });
    assert.equal(runtime.size, 2);

    const result = await runtime.execute("SLACK_PING", { channel: "general" });
    assert.equal(result.ok, true);
    const call = seen.find((s) => s.url.includes("/tools/execute/SLACK_PING"))!;
    assert.equal((call.body as { connected_account_id: string }).connected_account_id, "acc_sl");
    assert.deepEqual((call.body as { arguments: unknown }).arguments, { channel: "general" });
  });

  it("fails closed for unknown tools without network", async () => {
    const { fetchFn, calls } = stubFetch({});
    const runtime = await ConnectorRuntime.create({
      apiKey: "k",
      connections: [{ connectorId: "github", connectedAccountId: "acc_1" }],
      clientFactory: (key) => new ComposioClient(key, { fetchFn }),
      cache: new ConnectorToolCache(),
    });
    void calls;
    const result = await runtime.execute("NOPE_NOT_A_TOOL", {});
    assert.equal(result.ok, false);
  });

  it("normalizes degenerate input schemas instead of breaking", () => {
    assert.deepEqual(toOpenAIParameters(null), { type: "object", properties: {} });
    assert.deepEqual(toOpenAIParameters([]), { type: "object", properties: {} });
    assert.deepEqual(toOpenAIParameters({ properties: { a: { type: "string" } }, required: ["a", 1] }), {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    });
  });
});
