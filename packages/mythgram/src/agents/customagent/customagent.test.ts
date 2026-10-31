import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../../database/schema.js";
import { AppStateRepo } from "../../database/repositories/appStateRepo.js";
import { createToolRegistry } from "../tools/index.js";
import { buildSystemPrompt } from "../systemprompt.js";
import { TEAM_TOOL_NAMES, ALL_MULTI_AGENT_TOOL_NAMES } from "../tools/teamTools.js";
import type { ChatSession } from "../../services/sessionStore.js";
import type { SessionEventBuffer } from "../../services/eventBuffer.js";
import type { AppConfig } from "../../config.js";
import type { RunAgentRequest } from "../agent.js";
import {
  CUSTOM_AGENT_EXCLUDED_TOOLS,
  CustomAgentManager,
  CustomAgentRunner,
  isCustomAgentExcludedTool,
  listCustomAgentTools,
  normalizeCustomAgentConfig,
  resolveCustomAgentSystemPrompt,
  resolveCustomAgentTools,
  sanitizeSelectedTools,
  type CoreAgentRuntime,
  type CustomAgentConfig,
} from "./index.js";

const WORKSPACE = "/workspace";

function fakeConfig(): AppConfig {
  return { workspaceRoot: WORKSPACE } as AppConfig;
}

describe("custom agent — configuration & normalization", () => {
  it("requires a name (returns null without one)", () => {
    assert.equal(normalizeCustomAgentConfig({}, { id: "x", now: 1 }), null);
    assert.equal(normalizeCustomAgentConfig({ name: "   " }, { id: "x", now: 1 }), null);
    const ok = normalizeCustomAgentConfig({ name: "Research Agent" }, { id: "x", now: 1 });
    assert.ok(ok);
    assert.equal(ok!.name, "Research Agent");
  });

  it("accepts both snake_case (wire) and camelCase (stored) field spellings", () => {
    const wire = normalizeCustomAgentConfig(
      { name: "A", system_prompt: "P", selected_tools: ["file_read"] },
      { id: "id1", now: 5 },
    );
    const stored = normalizeCustomAgentConfig(
      { name: "A", systemPrompt: "P", selectedTools: ["file_read"] },
      { id: "id1", now: 5 },
    );
    assert.equal(wire!.systemPrompt, "P");
    assert.deepEqual(wire!.selectedTools, ["file_read"]);
    assert.equal(stored!.systemPrompt, "P");
    assert.deepEqual(stored!.selectedTools, ["file_read"]);
  });

  it("strips multi-agent/team tools from the selection (never permitted)", () => {
    const cleaned = sanitizeSelectedTools([
      "file_read",
      ...TEAM_TOOL_NAMES,
      "web_search",
      "file_read", // duplicate dropped
    ]);
    assert.deepEqual(cleaned, ["file_read", "web_search"]);
    for (const team of TEAM_TOOL_NAMES) assert.ok(isCustomAgentExcludedTool(team));
    assert.deepEqual(
      [...CUSTOM_AGENT_EXCLUDED_TOOLS].sort(),
      [...ALL_MULTI_AGENT_TOOL_NAMES].sort(),
    );
  });
});

describe("custom agent — automatic tool catalog (auto fetch / manual refresh source)", () => {
  it("lists the Main Agent's tools minus multi-agent tools, from the live registry", () => {
    const registry = createToolRegistry();
    const catalog = listCustomAgentTools(registry);
    const names = new Set(catalog.map((t) => t.name));

    // Includes sub-agent, memory, skills, knowledge and other main-agent tools.
    for (const expected of [
      "file_read",
      "call_sub_agent",
      "memory_write",
      "list_skills",
      "knowledge_read",
      "web_search",
    ]) {
      assert.ok(names.has(expected), `catalog should include ${expected}`);
    }
    // Never includes multi-agent/team tools.
    for (const team of TEAM_TOOL_NAMES) assert.ok(!names.has(team), `catalog must exclude ${team}`);

    // Every entry carries a usable name + description (latest definitions from the registry).
    for (const tool of catalog) {
      assert.equal(typeof tool.name, "string");
      assert.ok(tool.name.length > 0);
      assert.equal(typeof tool.description, "string");
    }
    // A manual refresh re-reads the same live registry → identical, non-empty catalog.
    assert.deepEqual(listCustomAgentTools(registry), catalog);
    assert.ok(catalog.length > 0);
  });
});

describe("custom agent — tool resolution (safety & validation)", () => {
  it("resolves selected tools against the live registry using the latest schemas", () => {
    const registry = createToolRegistry();
    const resolved = resolveCustomAgentTools(registry, ["file_read", "web_search"]);
    assert.deepEqual(resolved.allowed, ["file_read", "web_search"]);
    assert.equal(resolved.schemas.length, 2);
    const schemaNames = resolved.schemas.map((s) => s.function.name).sort();
    assert.deepEqual(schemaNames, ["file_read", "web_search"]);
    // Schemas come straight from the registry (latest), not stored on the config.
    assert.deepEqual(
      resolved.schemas,
      registry.schemasFor(["file_read", "web_search"]),
    );
  });

  it("ignores tools removed from the registry (reported as missing, not fatal)", () => {
    const registry = createToolRegistry();
    const resolved = resolveCustomAgentTools(registry, ["file_read", "a_tool_that_was_removed"]);
    assert.deepEqual(resolved.allowed, ["file_read"]);
    assert.deepEqual(resolved.missing, ["a_tool_that_was_removed"]);
    assert.equal(resolved.schemas.length, 1);
  });

  it("never resolves multi-agent tools (reported as excluded)", () => {
    const registry = createToolRegistry();
    const resolved = resolveCustomAgentTools(registry, ["file_read", TEAM_TOOL_NAMES[0]]);
    assert.deepEqual(resolved.allowed, ["file_read"]);
    assert.deepEqual(resolved.excluded, [TEAM_TOOL_NAMES[0]]);
  });
});

describe("custom agent — system prompt (pre-fill parity + verbatim use)", () => {
  it("the pre-fill source equals the Main Agent's built system prompt", () => {
    const built = buildSystemPrompt(WORKSPACE, {});
    assert.ok(built.includes("You are Mythgram"));
    // A Custom Agent starts from exactly this prompt (the creation UI pre-fills it), then edits it.
    const resolved = resolveCustomAgentSystemPrompt({ systemPrompt: built }, WORKSPACE);
    assert.equal(resolved, built);
  });

  it("uses the user's edited prompt verbatim", () => {
    const edited = "You are Research Agent. Do research thoroughly.";
    assert.equal(resolveCustomAgentSystemPrompt({ systemPrompt: edited }, WORKSPACE), edited);
  });

  it("falls back to the Main Agent prompt when the stored prompt is blank (never runs promptless)", () => {
    const resolved = resolveCustomAgentSystemPrompt({ systemPrompt: "   " }, WORKSPACE);
    assert.equal(resolved, buildSystemPrompt(WORKSPACE, {}));
  });
});

describe("custom agent — persistent manager (existing SQLite app_state repo)", () => {
  let manager: CustomAgentManager;

  beforeEach(() => {
    const db = new Database(":memory:");
    applySchema(db);
    manager = new CustomAgentManager(new AppStateRepo(db));
  });

  it("creates, lists, gets, updates and deletes independently of the Main Agent", () => {
    assert.deepEqual(manager.list(), []);

    const agent = manager.create({
      name: "Research Agent",
      description: "Finds and verifies information.",
      systemPrompt: "You research.",
      selectedTools: ["web_search", ...TEAM_TOOL_NAMES], // team tools stripped on persist
    });
    assert.ok(agent.id.length > 0);
    assert.deepEqual(agent.selectedTools, ["web_search"]);

    const listed = manager.list();
    assert.equal(listed.length, 1);
    assert.equal(manager.get(agent.id)!.name, "Research Agent");

    const updated = manager.update(agent.id, { name: "Deep Research", selectedTools: ["file_read"] });
    assert.equal(updated!.name, "Deep Research");
    assert.deepEqual(updated!.selectedTools, ["file_read"]);
    assert.equal(updated!.createdAt, agent.createdAt); // createdAt immutable
    assert.equal(manager.get(agent.id)!.name, "Deep Research");

    assert.equal(manager.delete(agent.id), true);
    assert.equal(manager.get(agent.id), null);
    assert.deepEqual(manager.list(), []);
  });

  it("persists configs into the shared `customAgents` app_state document", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const repo = new AppStateRepo(db);
    const m = new CustomAgentManager(repo);
    const a = m.create({ name: "Coding Agent", systemPrompt: "code" });

    // A brand-new manager over the SAME repo sees the persisted agent (independent persistence).
    const reopened = new CustomAgentManager(repo);
    assert.equal(reopened.get(a.id)!.name, "Coding Agent");
    const raw = repo.get("customAgents") as unknown[];
    assert.ok(Array.isArray(raw) && raw.length === 1);
  });

  it("throws when creating an agent without a name", () => {
    assert.throws(() => manager.create({ name: "   ", systemPrompt: "x" }));
  });
});

describe("custom agent — runtime runs as an independent top-level agent", () => {
  function fakeSession(): ChatSession {
    return { messages: [], running: true, updatedAt: 0 } as unknown as ChatSession;
  }
  function fakeBuffer(): { buffer: SessionEventBuffer; events: Array<{ event: string; data: unknown }> } {
    const events: Array<{ event: string; data: unknown }> = [];
    const buffer = { append: (event: string, data: unknown) => events.push({ event, data }) };
    return { buffer: buffer as unknown as SessionEventBuffer, events };
  }
  function baseRequest(): RunAgentRequest {
    return {
      chatId: "c1",
      userMessage: "hi",
      provider: "openrouter",
      model: "m",
      apiKey: "k",
    };
  }
  const agent: CustomAgentConfig = {
    id: "ca1",
    name: "Research Agent",
    description: "Research specialist.",
    systemPrompt: "You are Research Agent.",
    selectedTools: ["web_search", "file_read", TEAM_TOOL_NAMES[0]],
    createdAt: 1,
    updatedAt: 1,
  };

  it("delegates to the SHARED core runtime with the agent's prompt + resolved tools", async () => {
    const registry = createToolRegistry();
    let captured: RunAgentRequest | null = null;
    const core: CoreAgentRuntime = {
      async run(request) {
        captured = request;
      },
    };
    const runner = new CustomAgentRunner(core, registry, fakeConfig());
    const { buffer, events } = fakeBuffer();

    await runner.run(baseRequest(), agent, fakeSession(), buffer, new AbortController().signal);

    assert.ok(captured, "core runtime must be invoked (independent of any Main Agent running)");
    const req = captured as unknown as RunAgentRequest;
    // Verbatim custom system prompt applied as an override.
    assert.equal(req.systemPromptOverride, "You are Research Agent.");
    // Only the agent's selected + valid tools (team tool stripped).
    assert.deepEqual(req.allowedToolNames, ["web_search", "file_read"]);
    // The turn announces which top-level Custom Agent is handling it.
    assert.ok(events.some((e) => e.event === "custom_agent_active"));
  });

  it("does not require the Main Agent to be running (uses its own injected core only)", async () => {
    const registry = createToolRegistry();
    let ran = false;
    const core: CoreAgentRuntime = {
      async run() {
        ran = true;
      },
    };
    const runner = new CustomAgentRunner(core, registry, fakeConfig());
    const { buffer } = fakeBuffer();
    await runner.run(baseRequest(), agent, fakeSession(), buffer, new AbortController().signal);
    assert.equal(ran, true);
  });
});
