import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { createAgentTool } from "./create_agent.js";
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

async function makeWorkspace(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-create-agent-"));
  return {
    dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

function ctxFor(
  manager: CustomAgentManager,
  workspaceRoot: string,
  availableToolNames?: string[],
) {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const ctx: ToolContext = {
    workspaceRoot,
    shellTimeoutMs: 10_000,
    customAgents: createCustomAgentsRuntime(manager),
    availableToolNames: availableToolNames ?? ["file_read", "file_write", "grep"],
    emit: (event, data) => events.push({ event, data }),
  };
  return { ctx, events };
}

describe("create_agent tool", () => {
  const registry = new ToolRegistry().registerAll([
    createAgentTool,
    listAvailableAgentsTool,
  ]);

  it("is registered with the required name/short_description/system_prompt_file schema", () => {
    assert.ok(registry.has("create_agent"));
    const schema = registry.schemas.find((s) => s.function.name === "create_agent");
    assert.ok(schema, "create_agent must appear in the tools array");
    assert.match(schema!.function.description, /custom AI agent/i);
    const params = schema!.function.parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const props = params.properties ?? {};
    assert.ok("name" in props, "schema must require name");
    assert.ok("short_description" in props, "schema must require short_description");
    assert.ok("system_prompt_file" in props, "schema must require system_prompt_file");
    assert.deepEqual([...(params.required ?? [])].sort(), [
      "name",
      "short_description",
      "system_prompt_file",
    ]);
  });

  it("creates a custom agent from a workspace Markdown prompt file", async () => {
    const ws = await makeWorkspace();
    try {
      const { appState } = createAppState();
      const manager = new CustomAgentManager(appState);
      const { ctx, events } = ctxFor(manager, ws.dir);

      await fs.mkdir(path.join(ws.dir, "prompt"), { recursive: true });
      const rel = "prompt/prompt.md";
      const body = "# Helper\nYou are a helpful custom agent.";
      await fs.writeFile(path.join(ws.dir, rel), body, "utf8");

      const result = await registry.execute(
        "create_agent",
        { name: "Helper", short_description: "Helps with tasks", system_prompt_file: rel },
        ctx,
      );
      assert.equal(result.ok, true);
      const data = result.data as {
        created: boolean;
        agent: { name: string; description: string };
        granted_tools: number;
      };
      assert.equal(data.created, true);
      assert.equal(data.agent.name, "Helper");
      assert.equal(data.agent.description, "Helps with tasks");

      // Persisted through the SAME manager the REST API uses.
      const stored = manager.list();
      assert.equal(stored.length, 1);
      assert.equal(stored[0]!.name, "Helper");
      assert.equal(stored[0]!.systemPrompt, body);

      // Frontend sync event emitted.
      assert.ok(
        events.some((e) => e.event === "custom_agents_updated"),
        "create must emit custom_agents_updated",
      );

      // Visible immediately via list_available_agents in the same turn.
      const listed = await registry.execute("list_available_agents", {}, ctx);
      assert.equal(listed.ok, true);
      const listData = listed.data as {
        count: number;
        available_agents: Array<{ name: string }>;
      };
      assert.equal(listData.count, 1);
      assert.equal(listData.available_agents[0]!.name, "Helper");
    } finally {
      await ws.cleanup();
    }
  });

  it("rejects duplicate names without overwriting the existing agent", async () => {
    const ws = await makeWorkspace();
    try {
      const { appState } = createAppState();
      const manager = new CustomAgentManager(appState);
      const { ctx } = ctxFor(manager, ws.dir);
      await fs.writeFile(path.join(ws.dir, "a.md"), "prompt A", "utf8");
      await fs.writeFile(path.join(ws.dir, "b.md"), "prompt B", "utf8");

      const first = await registry.execute(
        "create_agent",
        { name: "Dup", short_description: "first", system_prompt_file: "a.md" },
        ctx,
      );
      assert.equal(first.ok, true);

      const second = await registry.execute(
        "create_agent",
        { name: "dup", short_description: "second", system_prompt_file: "b.md" },
        ctx,
      );
      assert.equal(second.ok, false);
      assert.equal((second.error as { code: string }).code, "agent_already_exists");
      assert.equal(manager.list().length, 1);
    } finally {
      await ws.cleanup();
    }
  });

  it("fails clearly when the prompt file is missing, empty, or not Markdown", async () => {
    const ws = await makeWorkspace();
    try {
      const { appState } = createAppState();
      const manager = new CustomAgentManager(appState);
      const { ctx } = ctxFor(manager, ws.dir);

      const missing = await registry.execute(
        "create_agent",
        { name: "Ghost", short_description: "missing file", system_prompt_file: "nope.md" },
        ctx,
      );
      assert.equal(missing.ok, false);
      assert.equal((missing.error as { code: string }).code, "prompt_file_not_found");

      await fs.writeFile(path.join(ws.dir, "empty.md"), "   \n", "utf8");
      const empty = await registry.execute(
        "create_agent",
        { name: "Empty", short_description: "empty file", system_prompt_file: "empty.md" },
        ctx,
      );
      assert.equal(empty.ok, false);
      assert.equal((empty.error as { code: string }).code, "empty_system_prompt");

      await fs.writeFile(path.join(ws.dir, "notes.txt"), "not markdown", "utf8");
      const notMd = await registry.execute(
        "create_agent",
        { name: "Txt", short_description: "wrong type", system_prompt_file: "notes.txt" },
        ctx,
      );
      assert.equal(notMd.ok, false);
      assert.equal((notMd.error as { code: string }).code, "invalid_prompt_file_type");

      assert.equal(manager.list().length, 0);
    } finally {
      await ws.cleanup();
    }
  });

  it("errors with a structured unavailable result outside the allowed surfaces", async () => {
    const subAgentCtx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute(
      "create_agent",
      { name: "X", short_description: "Y", system_prompt_file: "prompt.md" },
      subAgentCtx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "custom_agents_unavailable");
  });

  it("rejects invalid arguments via zod (empty name / missing fields)", async () => {
    const ws = await makeWorkspace();
    try {
      const { appState } = createAppState();
      const manager = new CustomAgentManager(appState);
      const { ctx } = ctxFor(manager, ws.dir);
      const result = await registry.execute(
        "create_agent",
        { name: "   ", short_description: "desc", system_prompt_file: "prompt.md" },
        ctx,
      );
      // Empty-after-trim names fail at the runtime guard (zod trim+min keeps whitespace-only
      // strings passing trim? runtime guard catches it deterministically).
      assert.equal(result.ok, false);
    } finally {
      await ws.cleanup();
    }
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      createAgentTool.label({
        name: "Helper",
        short_description: "desc",
        system_prompt_file: "prompt.md",
      }),
      "Create Agent: Helper",
    );
  });
});
