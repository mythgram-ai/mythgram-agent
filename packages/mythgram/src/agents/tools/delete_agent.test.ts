import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { deleteAgentTool } from "./delete_agent.js";
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

describe("delete_agent tool", () => {
  const registry = new ToolRegistry().registerAll([deleteAgentTool, listAvailableAgentsTool]);

  it("is registered with the required exact-name schema", () => {
    assert.ok(registry.has("delete_agent"));
    const schema = registry.schemas.find((s) => s.function.name === "delete_agent");
    assert.ok(schema, "delete_agent must appear in the tools array");
    assert.match(schema!.function.description, /exact name/i);
    const params = schema!.function.parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    assert.ok("name" in (params.properties ?? {}), "schema must require name");
    assert.deepEqual(params.required ?? [], ["name"]);
  });

  it("deletes by exact name and emits custom_agents_updated", async () => {
    const { appState } = createAppState();
    const manager = new CustomAgentManager(appState);
    manager.create({ name: "Helper", description: "helps", systemPrompt: "prompt" });
    const { ctx, events } = ctxFor(manager);

    const result = await registry.execute("delete_agent", { name: "Helper" }, ctx);
    assert.equal(result.ok, true);
    const data = result.data as { deleted: boolean; name: string };
    assert.equal(data.deleted, true);
    assert.equal(data.name, "Helper");
    assert.equal(manager.list().length, 0);
    assert.ok(
      events.some((e) => e.event === "custom_agents_updated"),
      "delete must emit custom_agents_updated",
    );

    const listed = await registry.execute("list_available_agents", {}, ctx);
    assert.equal((listed.data as { count: number }).count, 0);
  });

  it("matches names case-insensitively but preserves the stored casing in output", async () => {
    const { appState } = createAppState();
    const manager = new CustomAgentManager(appState);
    manager.create({ name: "ResearchBot", description: "research", systemPrompt: "p" });
    const { ctx } = ctxFor(manager);

    const result = await registry.execute("delete_agent", { name: "  researchbot  " }, ctx);
    assert.equal(result.ok, true);
    assert.equal((result.data as { name: string }).name, "ResearchBot");
  });

  it("fails clearly for unknown names and suggests list_available_agents", async () => {
    const { appState } = createAppState();
    const manager = new CustomAgentManager(appState);
    manager.create({ name: "Alpha", description: "a", systemPrompt: "p" });
    const { ctx } = ctxFor(manager);

    const result = await registry.execute("delete_agent", { name: "Beta" }, ctx);
    assert.equal(result.ok, false);
    const error = result.error as { code: string; message: string };
    assert.equal(error.code, "agent_not_found");
    assert.match(error.message, /list_available_agents/);
    assert.equal(manager.list().length, 1);
  });

  it("errors with a structured unavailable result outside the allowed surfaces", async () => {
    const subAgentCtx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("delete_agent", { name: "Helper" }, subAgentCtx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "custom_agents_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(deleteAgentTool.label({ name: "Helper" }), "Delete Agent: Helper");
  });
});
