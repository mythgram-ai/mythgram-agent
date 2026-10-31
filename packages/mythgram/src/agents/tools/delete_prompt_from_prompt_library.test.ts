import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { deletePromptFromPromptLibraryTool } from "./delete_prompt_from_prompt_library.js";
import { savePromptInPromptLibraryTool } from "./save_prompt_in_prompt_library.js";
import { listAvailablePromptsInPromptLibraryTool } from "./list_available_prompts_in_prompt_library.js";
import { PromptLibraryManager } from "../../prompt-library.js";
import { createPromptLibraryRuntime } from "../promptLibrary.js";
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

function ctxFor(manager: PromptLibraryManager) {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const ctx: ToolContext = {
    workspaceRoot: "/workspace",
    shellTimeoutMs: 10_000,
    promptLibrary: createPromptLibraryRuntime(manager),
    emit: (event, data) => events.push({ event, data }),
  };
  return { ctx, events };
}

describe("delete_prompt_from_prompt_library tool", () => {
  const registry = new ToolRegistry().registerAll([
    deletePromptFromPromptLibraryTool,
    savePromptInPromptLibraryTool,
    listAvailablePromptsInPromptLibraryTool,
  ]);

  it("is registered with prompt_id required (and nothing else)", () => {
    const schema = registry.schemas.find(
      (s) => s.function.name === "delete_prompt_from_prompt_library",
    );
    assert.ok(schema, "delete_prompt_from_prompt_library must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.deepEqual(Object.keys(props), ["prompt_id"]);
    assert.deepEqual(schema!.function.parameters.required as string[], ["prompt_id"]);
    assert.equal(schema!.function.parameters.additionalProperties, false);
  });

  it("deletes a saved prompt by id, emits prompt_library_updated, and drops it from the list", async () => {
    const { appState, docs } = createAppState();
    const { ctx, events } = ctxFor(new PromptLibraryManager(appState));
    const saved = await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "Delete me", description: "temp", prompt: "some prompt" },
      ctx,
    );
    const promptId = (saved.data as { prompt: { id: string } }).prompt.id;

    const deleted = await registry.execute(
      "delete_prompt_from_prompt_library",
      { prompt_id: promptId },
      ctx,
    );
    assert.equal(deleted.ok, true);
    const data = deleted.data as { deleted: boolean; prompt_id: string; count: number };
    assert.equal(data.deleted, true);
    assert.equal(data.prompt_id, promptId);
    assert.equal(data.count, 0);

    // Persisted removal (the app_state document is now empty) + live mirror event.
    assert.deepEqual(docs.get("promptLibrary"), []);
    assert.equal(events.at(-1)!.event, "prompt_library_updated");
    assert.deepEqual(events.at(-1)!.data.prompts, []);

    const list = await registry.execute("list_available_prompts_in_prompt_library", {}, ctx);
    assert.equal((list.data as { count: number }).count, 0);
  });

  it("deletes a prompt saved by another manager instance (same persisted library)", async () => {
    const { appState } = createAppState();
    const { ctx: saveCtx } = ctxFor(new PromptLibraryManager(appState));
    const saved = await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "Persisted", description: "d", prompt: "p" },
      saveCtx,
    );
    const promptId = (saved.data as { prompt: { id: string } }).prompt.id;

    // A fresh manager (e.g. a new chat turn) reads the same app_state document.
    const { ctx: deleteCtx } = ctxFor(new PromptLibraryManager(appState));
    const deleted = await registry.execute(
      "delete_prompt_from_prompt_library",
      { prompt_id: promptId },
      deleteCtx,
    );
    assert.equal(deleted.ok, true);
  });

  it("returns a structured not-found error with the available prompts", async () => {
    const { appState } = createAppState();
    const { ctx } = ctxFor(new PromptLibraryManager(appState));
    const saved = await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "Kept", description: "d", prompt: "p" },
      ctx,
    );
    const keptId = (saved.data as { prompt: { id: string } }).prompt.id;

    const missing = await registry.execute(
      "delete_prompt_from_prompt_library",
      { prompt_id: "AAAAAAAAAAAAAAAAAAAA" },
      ctx,
    );
    assert.equal(missing.ok, false);
    const error = missing.error as unknown as {
      code: string;
      available_prompts: Array<{ id: string }>;
    };
    assert.equal(error.code, "prompt_not_found");
    assert.deepEqual(
      error.available_prompts.map((p) => p.id),
      [keptId],
    );
  });

  it("rejects a missing/blank prompt_id", async () => {
    const { appState } = createAppState();
    const { ctx } = ctxFor(new PromptLibraryManager(appState));
    const missing = await registry.execute("delete_prompt_from_prompt_library", {}, ctx);
    assert.equal(missing.ok, false);
    assert.equal((missing.error as { code: string }).code, "invalid_arguments");

    const blank = await registry.execute(
      "delete_prompt_from_prompt_library",
      { prompt_id: "   " },
      ctx,
    );
    assert.equal(blank.ok, false);
    assert.equal((blank.error as { code: string }).code, "prompt_id_required");
  });

  it("errors with a structured unavailable result outside the prompt-library surfaces", async () => {
    const subAgentCtx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute(
      "delete_prompt_from_prompt_library",
      { prompt_id: "AAAAAAAAAAAAAAAAAAAA" },
      subAgentCtx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "prompt_library_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      deletePromptFromPromptLibraryTool.label({ prompt_id: "abc123" }),
      "Prompt library: delete abc123",
    );
  });
});
