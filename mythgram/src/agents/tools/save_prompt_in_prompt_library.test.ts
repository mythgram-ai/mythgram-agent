import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { savePromptInPromptLibraryTool } from "./save_prompt_in_prompt_library.js";
import { listAvailablePromptsInPromptLibraryTool } from "./list_available_prompts_in_prompt_library.js";
import { deletePromptFromPromptLibraryTool } from "./delete_prompt_from_prompt_library.js";
import { isSubAgentRestrictedTool } from "./subAgentRestrictedTools.js";
import { allowedCeoAgentTools, allowedTeamAgentTools } from "./teamTools.js";
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

describe("save_prompt_in_prompt_library tool", () => {
  const registry = new ToolRegistry().registerAll([
    savePromptInPromptLibraryTool,
    listAvailablePromptsInPromptLibraryTool,
    deletePromptFromPromptLibraryTool,
  ]);

  it("is registered with the documented required schema", () => {
    assert.ok(registry.has("save_prompt_in_prompt_library"));
    const schema = registry.schemas.find(
      (s) => s.function.name === "save_prompt_in_prompt_library",
    );
    assert.ok(schema, "save_prompt_in_prompt_library must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.title && props.description && props.prompt);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual([...required].sort(), ["description", "prompt", "title"]);
    assert.equal(schema!.function.parameters.additionalProperties, false);
  });

  it("saves the prompt, persists it, emits prompt_library_updated, and lists it back", async () => {
    const { appState, docs } = createAppState();
    const { ctx, events } = ctxFor(new PromptLibraryManager(appState));
    const promptText = "You are a code reviewer.\n\nFind every bug.\nKeep the diff minimal.";

    const saved = await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "Strict code review", description: "Reviews a diff for bugs.", prompt: promptText },
      ctx,
    );
    assert.equal(saved.ok, true);
    const data = saved.data as {
      saved: boolean;
      prompt: { id: string; title: string; description: string };
    };
    assert.equal(data.saved, true);
    assert.match(data.prompt.id, /^[0-9A-Za-z]{20}$/);
    assert.equal(data.prompt.title, "Strict code review");
    assert.equal(data.prompt.description, "Reviews a diff for bugs.");

    // The mutation is persisted into the SAME app_state document the frontend syncs.
    const stored = docs.get("promptLibrary") as Array<Record<string, unknown>>;
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.id, data.prompt.id);
    assert.equal(stored[0]!.content, promptText);

    // The frontend is told to mirror the complete library immediately.
    assert.equal(events.at(-1)!.event, "prompt_library_updated");
    const mirrored = events.at(-1)!.data.prompts as Array<Record<string, unknown>>;
    assert.equal(mirrored.length, 1);
    assert.equal(mirrored[0]!.content, promptText);

    // The list tool sees it — id, title, and description only (never the prompt text).
    const list = await registry.execute("list_available_prompts_in_prompt_library", {}, ctx);
    const listed = list.data as { count: number; prompts: Array<Record<string, unknown>> };
    assert.equal(listed.count, 1);
    assert.deepEqual(Object.keys(listed.prompts[0]!).sort(), ["description", "id", "title"]);
  });

  it("preserves the prompt's formatting (newlines, tabs, unicode) when stored", async () => {
    const { appState } = createAppState();
    const { ctx } = ctxFor(new PromptLibraryManager(appState));
    const saved = await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "Formatting", description: "", prompt: "  step 1 — line\n\tindented\nemoji ✅  " },
      ctx,
    );
    assert.equal(saved.ok, true);
    const stored = new PromptLibraryManager(appState).list()[0]!;
    // The shared library normalization trims only the surrounding whitespace — exactly like a
    // prompt saved from the UI — and keeps every inner character intact.
    assert.equal(stored.content, "step 1 — line\n\tindented\nemoji ✅");
  });

  it("keeps multiple saves newest-first and gives each prompt a unique id", async () => {
    const { appState } = createAppState();
    const { ctx } = ctxFor(new PromptLibraryManager(appState));
    const first = await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "First", description: "one", prompt: "prompt one" },
      ctx,
    );
    const second = await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "Second", description: "two", prompt: "prompt two" },
      ctx,
    );
    const firstId = (first.data as { prompt: { id: string } }).prompt.id;
    const secondId = (second.data as { prompt: { id: string } }).prompt.id;
    assert.notEqual(firstId, secondId);

    const list = await registry.execute("list_available_prompts_in_prompt_library", {}, ctx);
    const prompts = (list.data as { prompts: Array<{ id: string; title: string }> }).prompts;
    assert.deepEqual(prompts.map((p) => p.title), ["Second", "First"]);
  });

  it("rejects an empty title with a structured error and persists nothing", async () => {
    const { appState, docs } = createAppState();
    const { ctx } = ctxFor(new PromptLibraryManager(appState));
    const result = await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "   ", description: "x", prompt: "hello" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "prompt_title_required");
    assert.equal(docs.has("promptLibrary"), false);
  });

  it("rejects empty prompt content with a structured error", async () => {
    const { appState } = createAppState();
    const { ctx } = ctxFor(new PromptLibraryManager(appState));
    const result = await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "Empty", description: "x", prompt: "\n  \n" },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "prompt_content_required");
  });

  it("rejects unknown arguments (strict schema) through the registry boundary", async () => {
    const { appState } = createAppState();
    const { ctx } = ctxFor(new PromptLibraryManager(appState));
    const result = await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "T", description: "D", prompt: "P", unexpected: true },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "invalid_arguments");
  });

  it("errors with a structured unavailable result outside the prompt-library surfaces", async () => {
    const subAgentCtx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute(
      "save_prompt_in_prompt_library",
      { title: "T", description: "D", prompt: "P" },
      subAgentCtx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "prompt_library_unavailable");
  });

  it("is restricted from the sub-agent system", () => {
    assert.equal(isSubAgentRestrictedTool("save_prompt_in_prompt_library"), true);
    assert.equal(isSubAgentRestrictedTool("delete_prompt_from_prompt_library"), true);
    assert.equal(isSubAgentRestrictedTool("list_available_prompts_in_prompt_library"), true);
  });

  it("is granted to every multi-agent role (team leader/member, CEO, CEO leader/member)", () => {
    const names = [
      "save_prompt_in_prompt_library",
      "delete_prompt_from_prompt_library",
      "list_available_prompts_in_prompt_library",
    ];
    const granted = (
      toolNames: readonly string[],
      allowed: string[],
    ): string[] => allowed.filter((name) => toolNames.includes(name));
    for (const role of ["leader", "member"] as const) {
      assert.deepEqual(granted(names, allowedTeamAgentTools(names, role, true, [], [])), names);
      assert.deepEqual(granted(names, allowedCeoAgentTools(names, role, true, [], [])), names);
    }
    assert.deepEqual(granted(names, allowedCeoAgentTools(names, "ceo", true, [], [])), names);
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      savePromptInPromptLibraryTool.label({ title: "Review", description: "d", prompt: "p" }),
      'Prompt library: save "Review"',
    );
  });
});
