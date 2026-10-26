import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { listAvailablePromptsInPromptLibraryTool } from "./list_available_prompts_in_prompt_library.js";
import { savePromptInPromptLibraryTool } from "./save_prompt_in_prompt_library.js";
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

describe("list_available_prompts_in_prompt_library tool", () => {
  const registry = new ToolRegistry().registerAll([
    listAvailablePromptsInPromptLibraryTool,
    savePromptInPromptLibraryTool,
  ]);

  it("is registered and selectable by the LLM with an empty-object schema", () => {
    assert.ok(registry.has("list_available_prompts_in_prompt_library"));
    const schema = registry.schemas.find(
      (s) => s.function.name === "list_available_prompts_in_prompt_library",
    );
    assert.ok(schema, "list_available_prompts_in_prompt_library must appear in the tools array");
    const params = schema!.function.parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    assert.deepEqual(params.properties ?? {}, {});
    assert.ok(!params.required || params.required.length === 0);
  });

  it("returns an empty library with a helpful message", async () => {
    const { appState } = createAppState();
    const { ctx } = ctxFor(new PromptLibraryManager(appState));
    const result = await registry.execute("list_available_prompts_in_prompt_library", {}, ctx);
    assert.equal(result.ok, true);
    const data = result.data as { count: number; prompts: unknown[]; message: string };
    assert.equal(data.count, 0);
    assert.equal(data.prompts.length, 0);
    assert.match(data.message, /empty/i);
  });

  it("lists id, title, and description only — never the prompt text", async () => {
    const { appState } = createAppState();
    const { ctx } = ctxFor(new PromptLibraryManager(appState));
    const promptText = "SECRET_PROMPT_BODY that must not leak into the list shape";
    await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "Title A", description: "Description A", prompt: promptText },
      ctx,
    );

    const result = await registry.execute("list_available_prompts_in_prompt_library", {}, ctx);
    const data = result.data as {
      count: number;
      prompts: Array<{ id: string; title: string; description: string }>;
    };
    assert.equal(data.count, 1);
    assert.deepEqual(Object.keys(data.prompts[0]!).sort(), ["description", "id", "title"]);
    assert.equal(data.prompts[0]!.title, "Title A");
    assert.equal(data.prompts[0]!.description, "Description A");
    assert.equal(JSON.stringify(data).includes("SECRET_PROMPT_BODY"), false);
  });

  it("reflects a freshly saved prompt immediately (same turn)", async () => {
    const { appState } = createAppState();
    const { ctx } = ctxFor(new PromptLibraryManager(appState));
    await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "Fresh", description: "just saved", prompt: "body" },
      ctx,
    );
    const result = await registry.execute("list_available_prompts_in_prompt_library", {}, ctx);
    const data = result.data as { count: number; prompts: Array<{ title: string }> };
    assert.equal(data.count, 1);
    assert.equal(data.prompts[0]!.title, "Fresh");
  });

  it("errors with a structured unavailable result outside the prompt-library surfaces", async () => {
    const subAgentCtx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute(
      "list_available_prompts_in_prompt_library",
      {},
      subAgentCtx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "prompt_library_unavailable");
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      listAvailablePromptsInPromptLibraryTool.label({}),
      "Prompt library: list",
    );
  });
});
