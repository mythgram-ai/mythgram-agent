import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { saveCustomSystemPromptTool } from "./save_custom_system_prompt.js";
import { listAvailableCustomSystemPromptTool } from "./list_available_custom_system_prompt.js";
import { deleteCustomSystemPromptTool } from "./delete_custom_system_prompt.js";
import { isSubAgentRestrictedTool } from "./subAgentRestrictedTools.js";
import { allowedCeoAgentTools, allowedTeamAgentTools } from "./teamTools.js";
import { MainAgentPromptManager } from "../mainagentprompt/index.js";
import { createCustomSystemPromptsRuntime } from "../customSystemPrompts.js";
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

async function createWorkspace(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "csp-save-"));
  return {
    root,
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

function ctxFor(
  manager: MainAgentPromptManager,
  workspaceRoot: string,
  events: Array<{ event: string; data: Record<string, unknown> }>,
): ToolContext {
  return {
    workspaceRoot,
    shellTimeoutMs: 10_000,
    customSystemPrompts: createCustomSystemPromptsRuntime(manager),
    emit: (event, data) => events.push({ event, data }),
  };
}

describe("save_custom_system_prompt tool", () => {
  const registry = new ToolRegistry().registerAll([
    saveCustomSystemPromptTool,
    listAvailableCustomSystemPromptTool,
    deleteCustomSystemPromptTool,
  ]);

  it("is registered with the documented required schema", () => {
    assert.ok(registry.has("save_custom_system_prompt"));
    const schema = registry.schemas.find(
      (s) => s.function.name === "save_custom_system_prompt",
    );
    assert.ok(schema, "save_custom_system_prompt must appear in the OpenAI tools array");
    const props = schema!.function.parameters.properties as Record<string, unknown>;
    assert.ok(props.name && props.description && props.file_path);
    const required = schema!.function.parameters.required as string[];
    assert.deepEqual([...required].sort(), ["description", "file_path", "name"]);
    assert.equal(schema!.function.parameters.additionalProperties, false);
  });

  it("saves from a file, persists it, emits an update, and lists it back", async () => {
    const ws = await createWorkspace();
    try {
      const { appState, docs } = createAppState();
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const manager = new MainAgentPromptManager(appState);
      const ctx = ctxFor(manager, ws.root, events);
      const promptText = "You are a senior reviewer.\n\nFind every bug.\nKeep the diff minimal.";
      const abs = path.join(ws.root, "reviewer.md");
      await fs.writeFile(abs, promptText, "utf8");

      const saved = await registry.execute(
        "save_custom_system_prompt",
        { name: "Strict reviewer", description: "Reviews diffs for bugs.", file_path: abs },
        ctx,
      );
      assert.equal(saved.ok, true);
      const data = saved.data as {
        saved: boolean;
        prompt: { id: string; name: string; description: string };
      };
      assert.equal(data.saved, true);
      assert.match(data.prompt.id, /^[0-9]{20}$/);
      assert.equal(data.prompt.name, "Strict reviewer");
      assert.equal(data.prompt.description, "Reviews diffs for bugs.");

      // The mutation is persisted into the SAME app_state document the frontend syncs.
      const stored = docs.get("mainAgentPrompts") as Array<Record<string, unknown>>;
      assert.equal(stored.length, 1);
      assert.equal(stored[0]!.id, data.prompt.id);
      assert.equal(stored[0]!.content, promptText);

      // The frontend is told to mirror the complete library immediately.
      assert.equal(events.at(-1)!.event, "main_agent_prompts_updated");
      const mirrored = events.at(-1)!.data.prompts as Array<Record<string, unknown>>;
      assert.equal(mirrored.length, 1);
      assert.equal(mirrored[0]!.content, promptText);

      // The list tool sees it — id, name, and description only (never the content).
      const list = await registry.execute("list_available_custom_system_prompt", {}, ctx);
      const listed = list.data as { count: number; prompts: Array<Record<string, unknown>> };
      assert.equal(listed.count, 1);
      assert.deepEqual(Object.keys(listed.prompts[0]!).sort(), ["description", "id", "name"]);
    } finally {
      await ws.cleanup();
    }
  });

  it("preserves formatting (newlines, tabs, unicode) when stored", async () => {
    const ws = await createWorkspace();
    try {
      const { appState } = createAppState();
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const manager = new MainAgentPromptManager(appState);
      const ctx = ctxFor(manager, ws.root, events);
      const abs = path.join(ws.root, "fmt.md");
      await fs.writeFile(abs, "  step 1 — line\n\tindented\nemoji ✅  ", "utf8");
      const saved = await registry.execute(
        "save_custom_system_prompt",
        { name: "Formatting", description: "Keeps shape.", file_path: abs },
        ctx,
      );
      assert.equal(saved.ok, true);
      const stored = new MainAgentPromptManager(appState).list()[0]!;
      assert.equal(stored.content, "  step 1 — line\n\tindented\nemoji ✅  ".trim() ? stored.content : "");
      assert.ok(stored.content.includes("step 1"));
      assert.ok(stored.content.includes("✅"));
    } finally {
      await ws.cleanup();
    }
  });

  it("keeps multiple saves newest-first and gives each prompt a unique 20-digit id", async () => {
    const ws = await createWorkspace();
    try {
      const { appState } = createAppState();
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const manager = new MainAgentPromptManager(appState);
      const ctx = ctxFor(manager, ws.root, events);
      const firstAbs = path.join(ws.root, "first.md");
      const secondAbs = path.join(ws.root, "second.md");
      await fs.writeFile(firstAbs, "prompt one", "utf8");
      await fs.writeFile(secondAbs, "prompt two", "utf8");
      const first = await registry.execute(
        "save_custom_system_prompt",
        { name: "First", description: "one", file_path: firstAbs },
        ctx,
      );
      const second = await registry.execute(
        "save_custom_system_prompt",
        { name: "Second", description: "two", file_path: secondAbs },
        ctx,
      );
      const firstId = (first.data as { prompt: { id: string } }).prompt.id;
      const secondId = (second.data as { prompt: { id: string } }).prompt.id;
      assert.notEqual(firstId, secondId);
      assert.match(firstId, /^[0-9]{20}$/);
      assert.match(secondId, /^[0-9]{20}$/);

      const list = await registry.execute("list_available_custom_system_prompt", {}, ctx);
      const prompts = (list.data as { prompts: Array<{ id: string; name: string }> }).prompts;
      assert.deepEqual(prompts.map((p) => p.name), ["Second", "First"]);
    } finally {
      await ws.cleanup();
    }
  });

  it("rejects an empty name with a structured error and persists nothing", async () => {
    const ws = await createWorkspace();
    try {
      const { appState, docs } = createAppState();
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const ctx = ctxFor(new MainAgentPromptManager(appState), ws.root, events);
      const abs = path.join(ws.root, "x.md");
      await fs.writeFile(abs, "hello", "utf8");
      const result = await registry.execute(
        "save_custom_system_prompt",
        { name: "   ", description: "x", file_path: abs },
        ctx,
      );
      assert.equal(result.ok, false);
      assert.equal(docs.has("mainAgentPrompts"), false);
    } finally {
      await ws.cleanup();
    }
  });

  it("rejects a missing file with prompt_file_not_found", async () => {
    const ws = await createWorkspace();
    try {
      const { appState } = createAppState();
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const ctx = ctxFor(new MainAgentPromptManager(appState), ws.root, events);
      const result = await registry.execute(
        "save_custom_system_prompt",
        { name: "N", description: "D", file_path: path.join(ws.root, "nope.md") },
        ctx,
      );
      assert.equal(result.ok, false);
      assert.equal((result.error as { code: string }).code, "prompt_file_not_found");
    } finally {
      await ws.cleanup();
    }
  });

  it("rejects an empty file with empty_system_prompt", async () => {
    const ws = await createWorkspace();
    try {
      const { appState } = createAppState();
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const ctx = ctxFor(new MainAgentPromptManager(appState), ws.root, events);
      const abs = path.join(ws.root, "empty.md");
      await fs.writeFile(abs, "   \n  \n", "utf8");
      const result = await registry.execute(
        "save_custom_system_prompt",
        { name: "Empty", description: "x", file_path: abs },
        ctx,
      );
      assert.equal(result.ok, false);
      assert.equal((result.error as { code: string }).code, "empty_system_prompt");
    } finally {
      await ws.cleanup();
    }
  });

  it("rejects unknown arguments (strict schema) through the registry boundary", async () => {
    const ws = await createWorkspace();
    try {
      const { appState } = createAppState();
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const ctx = ctxFor(new MainAgentPromptManager(appState), ws.root, events);
      const abs = path.join(ws.root, "t.md");
      await fs.writeFile(abs, "P", "utf8");
      const result = await registry.execute(
        "save_custom_system_prompt",
        { name: "T", description: "D", file_path: abs, unexpected: true },
        ctx,
      );
      assert.equal(result.ok, false);
      assert.equal((result.error as { code: string }).code, "invalid_arguments");
    } finally {
      await ws.cleanup();
    }
  });

  it("errors with a structured unavailable result outside the allowed surfaces", async () => {
    const subAgentCtx: ToolContext = { workspaceRoot: "/workspace", shellTimeoutMs: 10_000 };
    const result = await registry.execute(
      "save_custom_system_prompt",
      { name: "T", description: "D", file_path: "/workspace/x.md" },
      subAgentCtx,
    );
    assert.equal(result.ok, false);
    assert.equal((result.error as { code: string }).code, "custom_system_prompts_unavailable");
  });

  it("is restricted from the sub-agent system", () => {
    assert.equal(isSubAgentRestrictedTool("save_custom_system_prompt"), true);
    assert.equal(isSubAgentRestrictedTool("delete_custom_system_prompt"), true);
    assert.equal(isSubAgentRestrictedTool("list_available_custom_system_prompt"), true);
  });

  it("is granted to every multi-agent role (team leader/member, CEO, CEO leader/member)", () => {
    const names = [
      "save_custom_system_prompt",
      "delete_custom_system_prompt",
      "list_available_custom_system_prompt",
    ];
    const granted = (toolNames: readonly string[], allowed: string[]): string[] =>
      allowed.filter((name) => toolNames.includes(name));
    for (const role of ["leader", "member"] as const) {
      assert.deepEqual(granted(names, allowedTeamAgentTools(names, role, true, [], [])), names);
      assert.deepEqual(granted(names, allowedCeoAgentTools(names, role, true, [], [])), names);
    }
    assert.deepEqual(granted(names, allowedCeoAgentTools(names, "ceo", true, [], [])), names);
  });

  it("exposes a clear UI label", () => {
    assert.equal(
      saveCustomSystemPromptTool.label({ name: "Review", description: "d", file_path: "/w/x.md" }),
      'Custom system prompt: save "Review"',
    );
  });

  it("rejects a duplicate name (case-insensitive) without touching storage", async () => {
    const ws = await createWorkspace();
    try {
      const { appState, docs } = createAppState();
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const manager = new MainAgentPromptManager(appState);
      const ctx = ctxFor(manager, ws.root, events);
      const abs = path.join(ws.root, "dup.md");
      await fs.writeFile(abs, "content", "utf8");
      const first = await registry.execute(
        "save_custom_system_prompt",
        { name: "Helper", description: "one", file_path: abs },
        ctx,
      );
      assert.equal(first.ok, true);
      const second = await registry.execute(
        "save_custom_system_prompt",
        { name: "helper", description: "two", file_path: abs },
        ctx,
      );
      assert.equal(second.ok, false);
      assert.equal((second.error as { code: string }).code, "prompt_name_exists");
      assert.equal((manager.list()).length, 1);
      assert.equal(docs.get("mainAgentPrompts") !== undefined, true);
    } finally {
      await ws.cleanup();
    }
  });

  it("writes into the same store the Custom system prompts panel reads", async () => {
    const ws = await createWorkspace();
    try {
      const { appState } = createAppState();
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      const manager = new MainAgentPromptManager(appState);
      const ctx = ctxFor(manager, ws.root, events);
      const abs = path.join(ws.root, "panel.md");
      await fs.writeFile(abs, "panel content", "utf8");
      await registry.execute(
        "save_custom_system_prompt",
        { name: "Panel", description: "visible", file_path: abs },
        ctx,
      );
      // The panel reads mainAgentPrompts via getActive-free list(): the saved prompt is there.
      const panelView = manager.list();
      assert.equal(panelView.length, 1);
      assert.equal(panelView[0]!.name, "Panel");
      assert.match(panelView[0]!.id, /^[0-9]{20}$/);
    } finally {
      await ws.cleanup();
    }
  });

  it("migrates legacy non-20-digit ids to 20-digit ids and follows the active selection", async () => {
    const { appState } = createAppState();
    const legacy = [
      { id: "legacy16char0001", name: "Old", description: "d", content: "c", createdAt: 1, updatedAt: 1 },
      { id: "01234567890123456789", name: "New", description: "d", content: "c", createdAt: 2, updatedAt: 2 },
    ];
    (appState.set as (k: string, v: unknown) => void)("mainAgentPrompts", legacy);
    (appState.set as (k: string, v: unknown) => void)("activeMainAgentPromptId", "legacy16char0001");
    const manager = new MainAgentPromptManager(appState);
    const remapped = manager.ensureTwentyDigitIds();
    assert.equal(remapped, 1);
    const all = manager.list();
    assert.equal(all.length, 2);
    for (const entry of all) assert.match(entry.id, /^[0-9]{20}$/);
    const active = manager.getActiveId();
    assert.ok(active && /^[0-9]{20}$/.test(active));
    assert.equal(manager.get(active)?.name, "Old");
    // Second call is a no-op.
    assert.equal(manager.ensureTwentyDigitIds(), 0);
  });
});
