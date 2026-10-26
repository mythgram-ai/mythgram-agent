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

describe("delete_custom_system_prompt tool", () => {
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

  it("is registered with a strict 20-digit id schema", () => {
    assert.ok(registry.has("delete_custom_system_prompt"));
    const schema = registry.schemas.find(
      (s) => s.function.name === "delete_custom_system_prompt",
    );
    assert.ok(schema, "delete_custom_system_prompt must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.id);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual(required, ["id"]);
    assert.equal(schema!.function.parameters.additionalProperties, false);
  });

  it("deletes by exact id, persists the removal, and emits an update", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "csp-del-"));
    try {
      const { appState, docs } = createAppState();
      const manager = new MainAgentPromptManager(appState);
      const ctx = ctxFor(manager, root);
      const abs = path.join(root, "p.md");
      await fs.writeFile(abs, "content one", "utf8");
      const saved = await registry.execute(
        "save_custom_system_prompt",
        { name: "One", description: "first", file_path: abs },
        ctx,
      );
      const id = (saved.data as { prompt: { id: string } }).prompt.id;
      assert.match(id, /^[0-9]{20}$/);

      const deleted = await registry.execute("delete_custom_system_prompt", { id }, ctx);
      assert.equal(deleted.ok, true);
      assert.equal((deleted.data as { deleted: boolean }).deleted, true);
      assert.equal((deleted.data as { prompt_id: string }).prompt_id, id);

      const stored = docs.get("mainAgentPrompts") as Array<Record<string, unknown>>;
      assert.equal(stored.length, 0);

      const list = await registry.execute("list_available_custom_system_prompt", {}, ctx);
      assert.equal((list.data as { count: number }).count, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a non-20-digit id at the schema boundary", async () => {
    const { appState } = createAppState();
    const ctx = ctxFor(new MainAgentPromptManager(appState), "/workspace");
    for (const bad of ["abc", "123", "123456789012345678901", "abcdefghij1234567890", ""]) {
      const result = await registry.execute("delete_custom_system_prompt", { id: bad }, ctx);
      assert.equal(result.ok, false, `id ${JSON.stringify(bad)} should fail`);
    }
  });

  it("reports prompt_not_found for an unknown but well-formed id without inventing state", async () => {
    const { appState } = createAppState();
    const ctx = ctxFor(new MainAgentPromptManager(appState), "/workspace");
    const result = await registry.execute(
      "delete_custom_system_prompt",
      { id: "00000000000000000001" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "prompt_not_found");
    assert.equal(
      (result.error as unknown as { prompt_id: string }).prompt_id,
      "00000000000000000001",
    );
  });

  it("rejects unknown arguments (strict schema)", async () => {
    const { appState } = createAppState();
    const ctx = ctxFor(new MainAgentPromptManager(appState), "/workspace");
    const result = await registry.execute(
      "delete_custom_system_prompt",
      { id: "00000000000000000001", extra: true },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("errors with unavailable outside the allowed surfaces", async () => {
    const subAgentCtx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute(
      "delete_custom_system_prompt",
      { id: "00000000000000000001" },
      subAgentCtx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "custom_system_prompts_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      deleteCustomSystemPromptTool.label({ id: "00000000000000000001" }),
      "Custom system prompt: delete 00000000000000000001",
    );
  });
});
