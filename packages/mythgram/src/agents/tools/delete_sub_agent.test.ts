import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { deleteSubAgentTool, DELETE_DEFAULT_SUB_AGENT_ERROR } from "./delete_sub_agent.js";
import type { SubAgentDefinition, SubAgentRuntime, ToolContext, ToolResult } from "./types.js";

/** A minimal SubAgentRuntime whose only used surface is `definitions`. */
function makeRuntime(definitions: SubAgentDefinition[]): SubAgentRuntime {
  return {
    definitions,
    available: () =>
      definitions
        .filter((d) => d.enabled !== false)
        .map((d) => ({ name: d.name, description: d.description })),
    register: (subAgent) => {
      definitions.push(subAgent);
    },
    run: async (): Promise<ToolResult> => ({ ok: true }),
    runMany: async (): Promise<ToolResult> => ({ ok: true }),
    listSessions: () => [],
    reuseSession: async (): Promise<ToolResult> => ({ ok: true }),
  };
}

const USER_SUB_AGENTS: SubAgentDefinition[] = [
  { name: "myhelper", description: "A user helper", system_prompt: "You help.", tools: [] },
  { name: "Reporter", description: "Writes reports", system_prompt: "You report.", tools: [] },
];

function ctxFor(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: "/tmp",
    shellTimeoutMs: 10_000,
    subAgents: makeRuntime(USER_SUB_AGENTS),
    ...overrides,
  };
}

describe("delete_sub_agent tool", () => {
  let registry: ToolRegistry;

  before(() => {
    registry = new ToolRegistry().registerAll([deleteSubAgentTool]);
  });

  it("is registered and exposed to the LLM as a native function schema", () => {
    assert.ok(registry.has("delete_sub_agent"));
    const schema = registry.schemas.find((s) => s.function.name === "delete_sub_agent");
    assert.ok(schema, "delete_sub_agent must appear in the OpenAI tools array");
    assert.equal(schema!.type, "function");
    assert.equal(schema!.function.parameters.type, "object");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.name, "name property must be declared");
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required, ["name"]);
  });

  it("deletes an existing user-defined sub-agent by exact name", async () => {
    const result = await registry.execute("delete_sub_agent", { name: "myhelper" }, ctxFor());
    assert.equal(result.ok, true);
    const data = result.data as { deleted_sub_agent: string; message: string };
    assert.equal(data.deleted_sub_agent, "myhelper");
    assert.match(data.message, /Deleted sub-agent/);
  });

  it("matches the registered name case-insensitively and returns its canonical name", async () => {
    const result = await registry.execute("delete_sub_agent", { name: "reporter" }, ctxFor());
    assert.equal(result.ok, true);
    assert.equal((result.data as { deleted_sub_agent: string }).deleted_sub_agent, "Reporter");
  });

  it("refuses to delete a built-in default sub-agent", async () => {
    const result = await registry.execute("delete_sub_agent", { name: "DeepExplorer" }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "cannot_delete_default_sub_agent");
    assert.equal(result.error?.message, DELETE_DEFAULT_SUB_AGENT_ERROR);
  });

  it("refuses to delete a default sub-agent regardless of casing", async () => {
    const result = await registry.execute("delete_sub_agent", { name: "codeexpert" }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.message, DELETE_DEFAULT_SUB_AGENT_ERROR);
  });

  it("returns an error when the sub-agent does not exist", async () => {
    const result = await registry.execute("delete_sub_agent", { name: "ghost" }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "unknown_sub_agent");
  });

  it("rejects an empty name via schema validation", async () => {
    const result = await registry.execute("delete_sub_agent", { name: "   " }, ctxFor());
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_arguments");
  });

  it("fails cleanly when there is no sub-agent runtime (sub-agent context)", async () => {
    const result = await registry.execute(
      "delete_sub_agent",
      { name: "myhelper" },
      ctxFor({ subAgents: undefined }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "registry_unavailable");
  });

  it("produces a readable UI label", () => {
    assert.equal(registry.label("delete_sub_agent", { name: "myhelper" }), "Delete Sub-Agent: myhelper");
  });
});
