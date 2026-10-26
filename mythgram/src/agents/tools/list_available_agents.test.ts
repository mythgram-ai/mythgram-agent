import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { listAvailableAgentsTool } from "./list_available_agents.js";
import { CustomAgentManager } from "../customagent/index.js";
import { createCustomAgentsRuntime } from "../customAgents.js";
import type { AppStateRepo } from "../../database/repositories/appStateRepo.js";
import type { ToolContext } from "./types.js";

/** In-memory stand-in for the SQLite app_state repository (same get/set surface). */
function createAppState() {
  const docs = new Map<string, unknown>();
  const appState = {
    get: (key: string) => docs.get(key),
    set: (key: string, value: unknown) => {
      docs.set(key, value);
    },
    delete: (key: string) => {
      docs.delete(key);
    },
    getAll: () => Object.fromEntries(docs),
  } as unknown as AppStateRepo;
  return { appState, docs };
}

function ctxFor(manager: CustomAgentManager) {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const ctx: ToolContext = {
    workspaceRoot: "/workspace",
    shellTimeoutMs: 10_000,
    customAgents: createCustomAgentsRuntime(manager),
    emit: (event, data) => events.push({ event, data }),
  };
  return { ctx, events };
}

describe("list_available_agents tool", () => {
  const registry = new ToolRegistry().registerAll([listAvailableAgentsTool]);

  it("is registered and selectable by the LLM with an empty-object schema", () => {
    assert.ok(registry.has("list_available_agents"));
    const schema = registry.schemas.find((s) => s.function.name === "list_available_agents");
    assert.ok(schema, "list_available_agents must appear in the tools array");
    assert.match(schema!.function.description, /custom AI agents/i);
    const params = schema!.function.parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    assert.deepEqual(params.properties ?? {}, {});
    assert.ok(!params.required || params.required.length === 0);
  });

  it("returns an empty list with a helpful message", async () => {
    const { appState } = createAppState();
    const { ctx } = ctxFor(new CustomAgentManager(appState));
    const result = await registry.execute("list_available_agents", {}, ctx);
    assert.equal(result.ok, true);
    const data = result.data as {
      count: number;
      available_agents: unknown[];
      message: string;
    };
    assert.equal(data.count, 0);
    assert.equal(data.available_agents.length, 0);
    assert.match(data.message, /No custom agents/i);
  });

  it("lists exact names + short descriptions only — never system prompts or tools", async () => {
    const { appState } = createAppState();
    const manager = new CustomAgentManager(appState);
    const { ctx } = ctxFor(manager);
    manager.create({
      name: "Researcher",
      description: "Does research",
      systemPrompt: "SECRET_SYSTEM_PROMPT that must not leak into the list shape",
      selectedTools: ["file_read", "grep"],
    });

    const result = await registry.execute("list_available_agents", {}, ctx);
    const data = result.data as {
      count: number;
      available_agents: Array<Record<string, unknown>>;
    };
    assert.equal(data.count, 1);
    const entry = data.available_agents[0]!;
    assert.equal(entry.name, "Researcher");
    assert.equal(entry.description, "Does research");
    assert.equal(entry.short_description, "Does research");
    assert.equal("systemPrompt" in entry, false);
    assert.equal("system_prompt" in entry, false);
    assert.equal("selectedTools" in entry, false);
    assert.equal(JSON.stringify(data).includes("SECRET_SYSTEM_PROMPT"), false);
  });

  it("reflects manager state immediately (same turn)", async () => {
    const { appState } = createAppState();
    const manager = new CustomAgentManager(appState);
    const { ctx } = ctxFor(manager);
    manager.create({ name: "A", description: "first", systemPrompt: "p1" });
    manager.create({ name: "B", description: "second", systemPrompt: "p2" });
    const result = await registry.execute("list_available_agents", {}, ctx);
    const data = result.data as { count: number };
    assert.equal(data.count, 2);
  });

  it("errors with a structured unavailable result outside the allowed surfaces", async () => {
    const subAgentCtx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("list_available_agents", {}, subAgentCtx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "custom_agents_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(listAvailableAgentsTool.label({}), "List Agents");
  });
});
