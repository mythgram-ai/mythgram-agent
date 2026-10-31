/**
 * Manual end-to-end harness for the agent-driven application-connector tools. NOT part of the
 * test suite — run it with `npx tsx src/agents/tools/e2e.manual.connectorManagement.ts` from the
 * mythgram directory.
 *
 * Boots the REAL mythgram backend (its own process, real HTTP) against two mock upstreams:
 *   - an OpenAI-compatible LLM server that scripts the exact tool-call sequence,
 *   - a mock Composio REST API that implements auth-config discovery, the connect
 *     link, connected-account polling, tool listing, and tool execution.
 *
 * It then drives one real chat turn over /api/chat/stream and asserts that:
 *   1. the four tools are advertised to the model as native function tools,
 *   2. connect_applications_connectors emits a Connect-button event with an OAuth URL,
 *   3. the connected app's tools are usable on the VERY NEXT model iteration
 *      (the requirement that matters most),
 *   4. those tools really execute against the provider,
 *   5. get_application_connector_status reports "connected",
 *   6. disconnect_application_connector revokes it and stops the tools being callable.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const WORKSPACE = mkdtempSync(join(tmpdir(), "mythgram-connector-e2e-"));
const PORT = 47831;
const BASE = `http://127.0.0.1:${PORT}`;
/** Mock upstreams — distinct ports from the backend under test. */
const MOCK_COMPOSIO = `http://127.0.0.1:${PORT + 1}`;
const MOCK_LLM = `http://127.0.0.1:${PORT + 2}`;

/* ------------------------------------------------------------------ mock Composio */

const composioCalls: string[] = [];
let connectPolls = 0;
/** Set to false to simulate the user never finishing the OAuth flow. */
let authorized = true;

const composio = createServer((req, res) => {
  const url = new URL(req.url ?? "/", BASE);
  // The backend is pointed at <mock>/composio; route on the path after that prefix.
  const path = url.pathname.replace(/^\/composio/, "");
  composioCalls.push(`${req.method} /composio${path}`);
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path === "/auth_configs") {
    return send(200, {
      items: [
        {
          id: "auth_github",
          type: "use_composio_managed_auth",
          status: "ENABLED",
          auth_scheme: "OAUTH2",
          is_composio_managed: true,
          toolkit: { slug: "github" },
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
  }
  if (path === "/connected_accounts/link" && req.method === "POST") {
    return send(200, {
      redirect_url: "https://mock.composio.dev/authorize?state=xyz",
      connected_account_id: "acct_e2e_1",
      id: "acct_e2e_1",
    });
  }
  if (path.startsWith("/connected_accounts/") && req.method === "GET") {
    connectPolls += 1;
    // The user finishes authorizing on the 2nd poll — i.e. after pressing Connect.
    const active = authorized && connectPolls >= 2;
    return send(200, {
      id: "acct_e2e_1",
      status: active ? "active" : "initiated",
      toolkit: { slug: "github" },
      user_id: "default",
    });
  }
  if (path.startsWith("/connected_accounts/") && req.method === "DELETE") {
    return send(200, { ok: true });
  }
  if (path === "/tools") {
    return send(200, {
      items: [
        {
          slug: "GITHUB_CREATE_ISSUE",
          name: "Create an issue",
          human_description: "Open a new issue in a repository.",
          input_parameters: {
            type: "object",
            properties: {
              repo: { type: "string", description: "owner/name" },
              title: { type: "string", description: "Issue title" },
            },
            required: ["repo", "title"],
          },
          toolkit: { slug: "github", name: "GitHub", logo: "https://cdn.simpleicons.org/github" },
        },
        {
          slug: "GITHUB_LIST_REPOS",
          name: "List repositories",
          human_description: "List the repositories of the authenticated user.",
          input_parameters: { type: "object", properties: {} },
          toolkit: { slug: "github", name: "GitHub" },
        },
      ],
    });
  }
  if (path.startsWith("/tools/execute/")) {
    providerCalls.push(`POST /composio${path}`);
    return send(200, {
      successful: true,
      data: { number: 42, html_url: "https://github.com/acme/repo/issues/42" },
      error: null,
    });
  }
  return send(404, { error: `unhandled ${path}` });
});

/* ------------------------------------------------------------------ mock LLM */

type ScriptStep = "connect" | "use_issue_tool" | "status" | "disconnect" | "done";
/** Tools advertised on each request — recorded to prove same-turn availability. */
const advertised: string[][] = [];
/** Every provider-side call, so we can assert the tools were routed natively. */
const providerCalls: string[] = [];
let step: ScriptStep = "connect";

function toolChunk(name: string, args: unknown, id: string): unknown {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function textChunk(text: string): unknown {
  return { choices: [{ delta: { content: text }, finish_reason: "stop" }] };
}

const llm = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw) as { tools?: Array<{ function?: { name?: string } }> };
    advertised.push((body.tools ?? []).map((t) => String(t.function?.name ?? "")));

    const chunks: unknown[] = [];
    switch (step) {
      case "connect":
        step = "use_issue_tool";
        chunks.push(toolChunk("connect_applications_connectors", { connector_name: "github" }, "call_connect"));
        break;
      case "use_issue_tool":
        step = "status";
        chunks.push(
          toolChunk("GITHUB_CREATE_ISSUE", { repo: "acme/repo", title: "Crash on start" }, "call_issue"),
        );
        break;
      case "status":
        step = "disconnect";
        chunks.push(toolChunk("get_application_connector_status", { connector_name: "github" }, "call_status"));
        break;
      case "disconnect":
        step = "done";
        chunks.push(
          toolChunk("disconnect_application_connector", { connector_name: "github" }, "call_disconnect"),
        );
        break;
      default:
        chunks.push(textChunk("All done."));
    }

    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

/* ------------------------------------------------------------------ helpers */

function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

async function post(path: string, payload: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Boot the real backend as its own process against the mock upstreams. */
async function boot(): Promise<() => Promise<void>> {
  const child = spawn(
    process.execPath,
    [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WORKSPACE_ROOT: WORKSPACE,
        PORT: String(PORT),
        HOST: "127.0.0.1",
        COMPOSIO_API_KEY: "mock-composio-key",
        COMPOSIO_API_BASE: `${MOCK_COMPOSIO}/composio`,
        MEMORY_AGENT_ENABLED: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const logs: string[] = [];
  child.stdout?.on("data", (c) => logs.push(String(c)));
  child.stderr?.on("data", (c) => logs.push(String(c)));

  const deadline = Date.now() + 45_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`backend exited early (${child.exitCode}):\n${logs.join("")}`);
    }
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`backend did not start:\n${logs.join("")}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  return () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    });
}

/* ------------------------------------------------------------------ run */

async function main(): Promise<void> {
  await listen(composio, PORT + 1);
  await listen(llm, PORT + 2);
  const stop = await boot();

  try {
    // 1. The four tools are advertised as native function tools on the first request.
    const health = (await (await fetch(`${BASE}/health`)).json()) as { tools: string[] };
    for (const name of [
      "connect_applications_connectors",
      "list_available_application_connectors",
      "disconnect_application_connector",
      "get_application_connector_status",
    ]) {
      assert.ok(health.tools.includes(name), `${name} must be in the tool registry`);
    }
    console.log("✔ all four tools are registered");

    // 2. Drive one real turn through the streaming API.
    const chatId = `e2e_${Date.now()}`;
    const response = await post("/api/chat/stream", {
      chat_id: chatId,
      user_message: "Open a GitHub issue for me.",
      provider: "local",
      model: "mock-model",
      api_key: "",
      base_url: `${MOCK_LLM}/llm/v1`,
    });
    assert.equal(response.status, 200);

    const raw = await response.text();
    // SSE frames are `event: <name>` + `data: <json>` (see utils/sse.ts).
    const events = raw
      .split("\n\n")
      .map((block) => {
        const name = block
          .split("\n")
          .find((l) => l.startsWith("event:"))
          ?.slice(6)
          .trim();
        const payload = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (!name || !payload) return null;
        return { event: name, data: JSON.parse(payload) as Record<string, unknown> };
      })
      .filter((e): e is { event: string; data: Record<string, unknown> } => e !== null);

    if (process.env.E2E_DEBUG) console.log("RAW EVENTS:\n" + JSON.stringify(events, null, 2).slice(0, 6000));
    const named = (name: string) => events.filter((e) => e.event === name);
    const toolCalls = named("tool_call");
    const toolResults = named("tool_result");

    assert.deepEqual(
      toolCalls.map((c) => (c.data as { name: string }).name),
      [
        "connect_applications_connectors",
        "GITHUB_CREATE_ISSUE",
        "get_application_connector_status",
        "disconnect_application_connector",
      ],
      "the scripted tool sequence must execute in order",
    );
    console.log("✔ native tool calls executed in order (no simulated/prose tool use)");

    // 3. The Connect-button event carries a real OAuth URL for the UI.
    const connectReq = named("connector_connect_required")[0];
    assert.ok(connectReq, "connector_connect_required must be emitted so the UI shows Connect");
    assert.equal((connectReq!.data as { connector_name: string }).connector_name, "github");
    assert.equal((connectReq!.data as { connector_label: string }).connector_label, "GitHub");
    assert.match(
      String((connectReq!.data as { redirect_url: string }).redirect_url),
      /^https:\/\/mock\.composio\.dev\//,
    );
    assert.equal((connectReq!.data as { connected_account_id: string }).connected_account_id, "acct_e2e_1");
    console.log("✔ Connect button event emitted with a usable OAuth redirect URL");

    // 4. *** The connected app's tools are usable on the VERY NEXT model iteration. ***
    const firstIteration = advertised[0] ?? [];
    assert.ok(
      !firstIteration.includes("GITHUB_CREATE_ISSUE"),
      "the app must not be usable before it is connected",
    );
    const secondIteration = advertised[1] ?? [];
    assert.ok(
      secondIteration.includes("GITHUB_CREATE_ISSUE") && secondIteration.includes("GITHUB_LIST_REPOS"),
      `the app's tools must be advertised on the next iteration, got: ${secondIteration.filter((n) =>
        /^[A-Z]/.test(n),
      )}`,
    );
    console.log("✔ connected app tools advertised on the very next model iteration (same turn)");

    // 5. The connector tool really executed against the provider.
    const issueResult = toolResults[1]!.data as { ok: boolean; result: { data: { number: number } } };
    assert.equal(issueResult.ok, true, "the app tool call must succeed");
    assert.equal(issueResult.result.data.number, 42);
    assert.ok(
      providerCalls.includes("POST /composio/tools/execute/GITHUB_CREATE_ISSUE"),
      `the app tool must be routed natively to the provider, saw: ${providerCalls.join(", ")}`,
    );
    console.log("✔ connected app tool executed natively against the provider");

    // 6. Status reports connected after authorization.
    const statusResult = toolResults[2]!.data as { ok: boolean; result: { data: { status: string } } };
    assert.equal(statusResult.result.data.status, "connected");
    console.log("✔ get_application_connector_status reports connected");

    // 7. Disconnect revokes the provider account and the tools stop being callable.
    const disconnectResult = toolResults[3]!.data as { ok: boolean; result: { data: { disconnected: boolean } } };
    assert.equal(disconnectResult.result.data.disconnected, true);
    assert.ok(composioCalls.includes("DELETE /composio/connected_accounts/acct_e2e_1"));
    const afterDisconnect = advertised[advertised.length - 1] ?? [];
    assert.ok(
      !afterDisconnect.includes("GITHUB_CREATE_ISSUE"),
      "a disconnected app's tools must no longer be advertised",
    );
    console.log("✔ disconnect revoked the account and removed the app tools");

    // 8. The persisted state converged (the Connectors page + next turn agree).
    const overview = (await (await fetch(`${BASE}/api/connectors`)).json()) as {
      connectors: Array<{ id: string; status: string }>;
    };
    assert.equal(overview.connectors.find((c) => c.id === "github")?.status, "disconnected");
    console.log("✔ backend connection state persisted and consistent");

    assert.ok(named("done").length > 0, "the turn must complete");
    assert.match(raw, /All done\./, "the turn must end with a real assistant answer");
    console.log("\nALL END-TO-END CHECKS PASSED");
  } finally {
    await stop();
    composio.close();
    llm.close();
    rmSync(WORKSPACE, { recursive: true, force: true });
  }
}

void main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
