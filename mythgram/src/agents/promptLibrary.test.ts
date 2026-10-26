import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { ProviderRegistry } from "./providers/registry.js";
import { OpenAICompatibleProvider } from "./providers/base.js";
import type { Provider, StreamDelta } from "./providers/types.js";
import { createToolRegistry } from "./tools/index.js";
import { AgentRunner } from "./agent.js";
import { PromptLibraryManager } from "../prompt-library.js";
import { PlanApprovalStore } from "../services/planApprovalStore.js";
import { QuestionStore } from "../services/questionStore.js";
import { MythgramDatabase } from "../database/index.js";
import type { ChatSession } from "../services/sessionStore.js";
import { SessionEventBuffer, type BufferedEvent } from "../services/eventBuffer.js";

const config = {
  port: 0,
  workspaceRoot: "",
  maxIterations: 1000,
  corsOrigins: "*",
  shellTimeoutMs: 10_000,
  planApprovalTimeoutMs: 60_000,
  questionTimeoutMs: 180_000,
  searchProvider: "duckduckgo",
  fetchProvider: "builtin",
  tavilyApiKey: "",
  exaApiKey: "",
  serpapiApiKey: "",
  firecrawlApiKey: "",
  composioApiKey: "",
  visionModelPatterns: [],
  textOnlyModelPatterns: [],
  memoryAgentEnabled: true,
  memoryAgentInterval: 3,
} as AppConfig;

/** Scripted provider: each invocation yields the deltas the script returns. */
class ScriptedProvider extends OpenAICompatibleProvider implements Provider {
  calls = 0;
  systemPrompt = "";
  offeredToolNames: string[] = [];
  constructor(
    private readonly script: (
      messages: Array<Record<string, unknown>>,
      call: number,
    ) => StreamDelta[] | Promise<StreamDelta[]>,
  ) {
    super({ id: "scripted", label: "Scripted", defaultBaseUrl: "http://localhost" });
  }
  override async *streamChatCompletion(opts: {
    messages: Array<Record<string, unknown>>;
  }): AsyncGenerator<StreamDelta, void, unknown> {
    if (this.calls === 0) {
      const system = opts.messages.find((m) => m.role === "system");
      this.systemPrompt = typeof system?.content === "string" ? system.content : "";
      const offered = (opts as { tools?: Array<{ function?: { name?: string } }> }).tools ?? [];
      this.offeredToolNames = offered
        .map((t) => t.function?.name)
        .filter((n): n is string => typeof n === "string");
    }
    const deltas = await this.script(opts.messages, this.calls++);
    for (const delta of deltas) yield delta;
  }
}

function toolCall(id: string, name: string, args: Record<string, unknown>): StreamDelta {
  return {
    toolCalls: [
      { index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } },
    ],
    finishReason: "tool_calls",
  };
}

/** The most recent tool observation for a tool name, parsed from the model-visible transcript. */
function lastToolResult(
  msgs: Array<Record<string, unknown>>,
  tool: string,
): Record<string, unknown> | null {
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i]!;
    if (m.role === "tool" && m.name === tool && typeof m.content === "string") {
      try {
        return JSON.parse(m.content as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Collect the turn's events until the agent's final `done`. */
async function collectEvents(buffer: SessionEventBuffer): Promise<BufferedEvent[]> {
  const events: BufferedEvent[] = [];
  for await (const event of buffer.subscribe()) {
    events.push(event);
    if (event.event === "done") break;
  }
  return events;
}

describe("prompt library agent tools (main-agent turn)", () => {
  it("advertises the tools, executes real LLM tool calls, and keeps the library in sync", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-library-turn-"));
    const db = MythgramDatabase.open(dir);
    try {
      const cfg: AppConfig = { ...config, workspaceRoot: dir };
      const provider = new ScriptedProvider((msgs) => {
        if (!lastToolResult(msgs, "save_prompt_in_prompt_library")) {
          return [
            toolCall("call_save", "save_prompt_in_prompt_library", {
              title: "Release notes writer",
              description: "Turns a change list into release notes.",
              prompt: "Write release notes for: {{changes}}\nKeep it under 120 words.",
            }),
          ];
        }
        if (!lastToolResult(msgs, "list_available_prompts_in_prompt_library")) {
          return [toolCall("call_list", "list_available_prompts_in_prompt_library", {})];
        }
        const listed = lastToolResult(msgs, "list_available_prompts_in_prompt_library") as
          | { data?: { prompts?: Array<{ id?: string }> } }
          | null;
        const id = listed?.data?.prompts?.[0]?.id ?? "";
        if (!lastToolResult(msgs, "delete_prompt_from_prompt_library")) {
          return [toolCall("call_delete", "delete_prompt_from_prompt_library", { prompt_id: id })];
        }
        return [{ text: "Prompt library updated." }];
      });
      const providers = new ProviderRegistry().registerAll([provider]);
      const tools = createToolRegistry();
      const manager = new PromptLibraryManager(db.appState);
      const agent = new AgentRunner(
        providers,
        tools,
        cfg,
        new PlanApprovalStore(),
        new QuestionStore(),
      );
      // Boot-time wiring: the persistent library is attached to the core runtime.
      agent.setPromptLibrary(manager);

      const session: ChatSession = {
        chatId: "chat_prompt_library",
        messages: [],
        eventBuffer: null,
        abortController: null,
        running: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const buffer = new SessionEventBuffer();
      await agent.run(
        {
          chatId: "chat_prompt_library",
          userMessage: "Save my release-notes prompt, then clean it up.",
          provider: "scripted",
          model: "mock",
          apiKey: "k",
        },
        session,
        buffer,
        new AbortController().signal,
      );

      // The model was offered the three prompt-library tools natively and told how to use them.
      for (const name of [
        "save_prompt_in_prompt_library",
        "delete_prompt_from_prompt_library",
        "list_available_prompts_in_prompt_library",
      ]) {
        assert.ok(provider.offeredToolNames.includes(name), `${name} must be offered to the model`);
      }
      assert.match(provider.systemPrompt, /# Prompt library/);
      assert.match(provider.systemPrompt, /save_prompt_in_prompt_library/);

      const events = await collectEvents(buffer);
      const updated = events.filter((e) => e.event === "prompt_library_updated");
      assert.equal(updated.length, 2, "one event per mutation (save + delete)");

      // First mutation: the prompt is saved and mirrored to the frontend.
      const afterSave = updated[0]!.data.prompts as Array<Record<string, unknown>>;
      assert.equal(afterSave.length, 1);
      assert.equal(afterSave[0]!.title, "Release notes writer");
      assert.match(String(afterSave[0]!.content), /Write release notes/);

      // Second mutation: the delete removed it again.
      const afterDelete = updated[1]!.data.prompts as Array<Record<string, unknown>>;
      assert.equal(afterDelete.length, 0);

      // The persistent library (throwaway DB in the temp workspace) ends empty…
      assert.equal(manager.list().length, 0);
      assert.deepEqual(db.appState.get("promptLibrary"), []);
      // …and the whole flow ran through real tool calls, not simulated ones.
      const toolResults = events.filter((e) => e.event === "tool_result");
      assert.deepEqual(
        toolResults.map((e) => e.data.name),
        [
          "save_prompt_in_prompt_library",
          "list_available_prompts_in_prompt_library",
          "delete_prompt_from_prompt_library",
        ],
      );
      for (const result of toolResults) assert.equal(result.data.ok, true);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
