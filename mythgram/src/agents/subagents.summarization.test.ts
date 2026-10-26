import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./tools/registry.js";
import { createSubAgentRuntime } from "./subagents.js";
import { subAgentSessionStore } from "./subAgentSessionStore.js";
import { clearSubAgentHandoffHistory, clearSubAgentHandoffJobs } from "./summarization/index.js";
import type { AppConfig } from "../config.js";
import type { Provider, StreamDelta } from "./providers/types.js";
import type { SubAgentDefinition, SubAgentRuntime, ToolContext } from "./tools/types.js";

const SUMMARY_TEXT =
  "Goal: test summarization. Completed: listed files via file_list, got ok. " +
  "Decisions: none. Remaining: produce final report and finish the delegated task.";

function makeProvider(): {
  provider: Provider;
  requests: Array<Array<Record<string, unknown>>>;
} {
  const requests: Array<Array<Record<string, unknown>>> = [];
  let subCalls = 0;
  const provider = {
    metadata: { id: "fake", label: "Fake", defaultBaseUrl: "" },
    async listModels() {
      return [];
    },
    async *streamChatCompletion(opts: {
      messages: Array<Record<string, unknown>>;
      tools?: Array<{ function: { name: string } }>;
    }): AsyncGenerator<StreamDelta, void, unknown> {
      requests.push(opts.messages);
      const system = String(
        (opts.messages[0] as { content?: unknown })?.content ?? "",
      );
      // Summary-agent path: same prompts + runner as the main agent.
      if (system.includes("context summary agent")) {
        yield { text: SUMMARY_TEXT };
        return;
      }
      // Sub-agent path.
      subCalls += 1;
      if (subCalls === 1) {
        // First generation: do a tool call and report 95% utilization.
        yield {
          toolCalls: [
            { index: 0, id: "call_1", function: { name: "file_list", arguments: "{}" } },
          ],
        };
        yield { usage: { prompt_tokens: 95_000, completion_tokens: 10, total_tokens: 95_010 } };
        return;
      }
      // Second generation (after handoff): final answer, low usage.
      yield { text: "FINAL DONE AFTER SUMMARY" };
      yield { usage: { prompt_tokens: 5_000, completion_tokens: 10, total_tokens: 5_010 } };
    },
  } as unknown as Provider;
  return { provider, requests };
}

describe("sub-agent automatic summarization at 90%", () => {
  it("pauses at threshold, summarizes with main-agent pipeline, clears context, and continues", async () => {
    clearSubAgentHandoffJobs();
    clearSubAgentHandoffHistory();
    const chatId = "chat-sub-sum-1";
    subAgentSessionStore.clear(chatId);
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-subsum-"));
    const tools = new ToolRegistry();
    const config = { workspaceRoot, shellTimeoutMs: 10_000, summaryThreshold: 0.9 } as AppConfig;
    const { provider, requests } = makeProvider();
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const definitions: SubAgentDefinition[] = [
      { name: "worker", description: "w", system_prompt: "You are worker.", tools: [] },
    ];
    const runtime: SubAgentRuntime = createSubAgentRuntime({
      provider,
      tools,
      config,
      chatId,
      definitions,
      model: "fake-model",
      apiKey: "key",
      send: (event, data) => events.push({ event, data }),
      contextLimit: 100_000,
      summaryThreshold: 0.9,
    });
    const ctx: ToolContext = {
      workspaceRoot,
      shellTimeoutMs: 10_000,
      toolCallId: "t1",
      subAgents: runtime,
    };

    const result = await runtime.run(
      { agent: "worker", task: "Do the delegated thing", wait_for_output: true },
      ctx,
    );

    assert.equal(result.ok, true);
    const output = String((result.data as { output?: unknown })?.output ?? "");
    assert.match(output, /FINAL DONE AFTER SUMMARY/);

    // Handoff events streamed live (one job, correlated to the sub-agent session).
    const kinds = events.map((e) => e.event);
    assert.ok(kinds.includes("sub_agent_summary_execution_started"), "must start handoff");
    assert.ok(kinds.includes("sub_agent_paused"), "must pause like main agent");
    assert.ok(kinds.includes("sub_agent_summary_output_chunk"), "must stream live output");
    assert.ok(kinds.includes("sub_agent_final_summary_validated"), "must validate");
    assert.ok(kinds.includes("sub_agent_context_replaced"), "must replace");
    assert.ok(kinds.includes("sub_agent_execution_resumed"), "must resume and continue");

    // All handoff events carry the sub-agent session id.
    const handoffEvents = events.filter((e) => e.event.startsWith("sub_agent_summary") || e.event.startsWith("sub_agent_pause") || e.event === "sub_agent_paused" || e.event === "sub_agent_context_replaced" || e.event === "sub_agent_execution_resumed" || e.event === "sub_agent_final_summary_validated" || e.event === "sub_agent_final_summary_received");
    assert.ok(handoffEvents.length > 0);
    for (const e of handoffEvents) {
      assert.ok(typeof e.data.sub_session_id === "string" && (e.data.sub_session_id as string).length > 0, `${e.event} must carry sub_session_id`);
    }

    // The post-handoff LLM request sends the system prompt again + summary + latest task input,
    // with the ENTIRE old context cleared (no file_list leakage except inside the summary).
    assert.ok(requests.length >= 3, `expected >=3 LLM requests (sub, summary, sub-resumed), got ${requests.length}`);
    const resumed = requests[requests.length - 1]!;
    const resumedText = JSON.stringify(resumed);
    // System prompt re-sent (identity preserved).
    assert.ok(String((resumed[0] as { content?: unknown })?.content ?? "").includes("You are worker"), "system prompt must be sent again");
    // Summary present.
    assert.ok(resumedText.includes("<context_summary>"), "summary must be sent after replacement");
    // Latest task input present.
    assert.ok(resumedText.includes("Do the delegated thing"), "latest task input must be sent again");
    // Old tool traffic cleared: only one user message remains (summary + task).
    const userMsgs = resumed.filter((m) => m.role === "user");
    assert.equal(userMsgs.length, 1, "entire context must be cleared to a single continuation message");

    // Session store reflects the replaced transcript (it continues, not forks).
    const sessions = runtime.listSessions();
    assert.ok(sessions.length >= 1);
  });

  it("never triggers without a context limit (safe, handoff disabled)", async () => {
    clearSubAgentHandoffJobs();
    clearSubAgentHandoffHistory();
    const chatId = "chat-sub-sum-2";
    subAgentSessionStore.clear(chatId);
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-subsum-"));
    const tools = new ToolRegistry();
    const config = { workspaceRoot, shellTimeoutMs: 10_000 } as AppConfig;
    const { provider } = makeProvider();
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const runtime: SubAgentRuntime = createSubAgentRuntime({
      provider,
      tools,
      config,
      chatId,
      definitions: [{ name: "worker", description: "w", system_prompt: "You are worker.", tools: [] }],
      model: "fake-model",
      apiKey: "key",
      send: (event, data) => events.push({ event, data }),
      // No contextLimit → handoff disabled, same as main agent.
    });
    const ctx: ToolContext = {
      workspaceRoot,
      shellTimeoutMs: 10_000,
      toolCallId: "t1",
      subAgents: runtime,
    };
    const result = await runtime.run(
      { agent: "worker", task: "Do the delegated thing", wait_for_output: true },
      ctx,
    );
    assert.equal(result.ok, true);
    const kinds = events.map((e) => e.event);
    assert.ok(!kinds.includes("sub_agent_summary_execution_started"), "must not summarize without a limit");
  });
});
