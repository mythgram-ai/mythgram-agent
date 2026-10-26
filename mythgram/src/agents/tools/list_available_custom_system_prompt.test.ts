import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { saveCustomSystemPromptTool } from "./save_custom_system_prompt.js";
import { listAvailableCustomSystemPromptTool } from "./list_available_custom_system_prompt.js";
import { deleteCustomSystemPromptTool } from "./delete_custom_system_prompt.js";
import { MainAgentPromptManager } from "../mainagentprompt/index.js";
import { createCustomSystemPromptsRuntime } from "../customSystemPrompts.js";
import type { AppStateRepo } from "../../database/repositories/appStateRepo.js";
import type { ToolContext } from "./types.js";

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

describe("list_available_custom_system_prompt tool", () => {
  const registry = new ToolRegistry().registerAll([
    saveCustomSystemPromptTool,
    listAvailableCustomSystemPromptTool,
    deleteCustomSystemPromptTool,
  ]);

  function ctxFor(manager: MainAgentPromptManager, workspaceRoot: string): ToolContext {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    return {
      workspaceRoot,
      shellTimeoutMs: 10_000,
      customSystemPrompts: createCustomSystemPromptsRuntime(manager),
      emit: (event, data) => events.push({ event, data }),
    };
  }

  it("is registered with an empty strict schema", () => {
    assert.ok(registry.has("list_available_custom_system_prompt"));
    const schema = registry.schemas.find(
      (s) => s.function.name === "list_available_custom_system_prompt",
    );
    assert.ok(schema, "list tool must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.deepEqual(props, {});
    assert.equal(schema!.function.parameters.additionalProperties, false);
  });

  it("returns an empty list when nothing is saved", async () => {
    const { appState } = createAppState();
    const ctx = ctxFor(new MainAgentPromptManager(appState), "/workspace");
    const result = await registry.execute("list_available_custom_system_prompt", {}, ctx);
    assert.equal(result.ok, true);
    assert.equal((result.data as { count: number }).count, 0);
    assert.deepEqual((result.data as { prompts: unknown[] }).prompts, []);
  });

  it("lists name, description, and exact 20-digit id only (never content)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "csp-list-"));
    try {
      const { appState } = createAppState();
      const manager = new MainAgentPromptManager(appState);
      const ctx = ctxFor(manager, root);
      const abs = path.join(root, "a.md");
      await fs.writeFile(abs, "alpha content", "utf8");
      await registry.execute(
        "save_custom_system_prompt",
        { name: "Alpha", description: "First.", file_path: abs },
        ctx,
      );
      const result = await registry.execute("list_available_custom_system_prompt", {}, ctx);
      assert.equal(result.ok, true);
      const data = result.data as {
        count: number;
        prompts: Array<{ id: string; name: string; description: string }>;
      };
      assert.equal(data.count, 1);
      assert.match(data.prompts[0]!.id, /^[0-9]{20}$/);
      assert.equal(data.prompts[0]!.name, "Alpha");
      assert.equal(data.prompts[0]!.description, "First.");
      assert.deepEqual(Object.keys(data.prompts[0]!).sort(), ["description", "id", "name"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("is read-only: listing never creates, updates, or deletes prompts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "csp-list-ro-"));
    try {
      const { appState, docs } = createAppState();
      const manager = new MainAgentPromptManager(appState);
      const ctx = ctxFor(manager, root);
      const before = JSON.stringify(docs.get("mainAgentPrompts") ?? null);
      await registry.execute("list_available_custom_system_prompt", {}, ctx);
      await registry.execute("list_available_custom_system_prompt", {}, ctx);
      assert.equal(JSON.stringify(docs.get("mainAgentPrompts") ?? null), before);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unknown arguments (strict schema)", async () => {
    const { appState } = createAppState();
    const ctx = ctxFor(new MainAgentPromptManager(appState), "/workspace");
    const result = await registry.execute(
      "list_available_custom_system_prompt",
      { unexpected: true },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("errors with unavailable outside the allowed surfaces", async () => {
    const subAgentCtx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute("list_available_custom_system_prompt", {}, subAgentCtx);
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "custom_system_prompts_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      listAvailableCustomSystemPromptTool.label({}),
      "Custom system prompt: list",
    );
  });
});
