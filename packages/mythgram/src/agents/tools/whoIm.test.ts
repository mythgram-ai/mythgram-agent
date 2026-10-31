import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { whoImTool, createAgentInfoRuntime, setAgentInfoClock } from "./whoIm.js";
import { ToolRegistry } from "./registry.js";
import type { AgentSelfInfo, ToolContext } from "./types.js";

const BASE_INFO: AgentSelfInfo = {
  agent: { type: "main", name: "Main Agent" },
  model: { id: "gpt-test", provider: "openai", vision_capable: true },
  context: {
    context_limit: 128_000,
    summary_threshold: 0.9,
    available_tools: ["file_read", "who_im"],
    tool_count: 2,
  },
  workspace_root: "/workspace",
  generated_at: "2026-01-01T00:00:00.000Z",
};

describe("who_im tool", () => {
  let registry: ToolRegistry;

  before(() => {
    registry = new ToolRegistry().register(whoImTool);
    setAgentInfoClock(() => new Date("2026-01-01T00:00:00.000Z"));
  });

  after(() => {
    setAgentInfoClock(() => new Date());
  });

  function makeCtx(info?: AgentSelfInfo): ToolContext {
    return {
      workspaceRoot: "/workspace",
      shellTimeoutMs: 10_000,
      agentInfo: info ? createAgentInfoRuntime(info) : undefined,
    };
  }

  it("is registered with an empty object schema", () => {
    assert.ok(registry.has("who_im"));
    const schema = registry.schemas.find((s) => s.function.name === "who_im");
    assert.ok(schema);
    assert.equal(schema!.type, "function");
    const params = schema!.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties?: boolean;
    };
    assert.equal(params.type, "object");
    assert.deepEqual(params.properties, {});
    // zod-to-json-schema omits `required` for an object with no required properties.
    assert.deepEqual(params.required ?? [], []);
    assert.equal(params.additionalProperties, false);
  });

  it("returns the agent's self-description", async () => {
    const result = await registry.execute("who_im", {}, makeCtx(BASE_INFO));
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.deepEqual(data.agent, { type: "main", name: "Main Agent" });
    assert.deepEqual(data.model, { id: "gpt-test", provider: "openai", vision_capable: true });
    assert.equal((data.context as { context_limit: number }).context_limit, 128_000);
    assert.equal(data.workspace_root, "/workspace");
    assert.equal(data.generated_at, "2026-01-01T00:00:00.000Z");
  });

  it("drops empty optional sections but keeps populated ones", async () => {
    const result = await registry.execute(
      "who_im",
      {},
      makeCtx({
        ...BASE_INFO,
        skills: [],
        sub_agents: [{ name: "codeexpert", description: "coding" }],
        memory: { file_count: 0, paths: [] },
        todos: { total: 0, pending: 0, in_progress: 0, completed: 0 },
        user_profile: { id: "u1", name: "Ada" },
      }),
    );
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.skills, undefined);
    assert.equal(data.memory, undefined);
    assert.equal(data.todos, undefined);
    assert.deepEqual(data.sub_agents, [{ name: "codeexpert", description: "coding" }]);
    assert.deepEqual(data.user_profile, { id: "u1", name: "Ada" });
  });

  it("fails cleanly when no runtime is present", async () => {
    const result = await registry.execute("who_im", {}, makeCtx(undefined));
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "no_agent_info");
  });

  it("exposes a clear UI label and description", () => {
    assert.equal(whoImTool.name, "who_im");
    assert.equal(whoImTool.label({} as never), "Who am I");
    assert.ok(whoImTool.description.length > 0);
  });

  it("createAgentInfoRuntime returns the snapshot and stamps generated_at when missing", () => {
    const runtime = createAgentInfoRuntime({ ...BASE_INFO, generated_at: "" });
    const info = runtime.describe();
    assert.equal(info.generated_at, "2026-01-01T00:00:00.000Z");
    assert.equal(info.agent.type, "main");
  });
});
