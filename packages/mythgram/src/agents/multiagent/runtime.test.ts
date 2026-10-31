import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TeamOrchestrator } from "./runtime.js";
import { EV_AGENT_SEGMENT, EV_TEAM_MESSAGE, type AgentTeamDefinition } from "./types.js";
import { createToolRegistry } from "../tools/index.js";
import { createMemoryRuntime } from "../memory.js";
import { createKnowledgeRuntime } from "../knowledge.js";
import { createSkillRuntime } from "../skills.js";
import { createTodoRuntime } from "../todos.js";
import { ConnectorRuntime } from "../connectors/index.js";
import type { AppConfig } from "../../config.js";
import type { Provider, StreamDelta } from "../providers/types.js";

const fakeConfig: AppConfig = {
  port: 0,
  workspaceRoot: "/tmp",
  maxIterations: 1000,
  corsOrigins: "*",
  shellTimeoutMs: 10_000,
  planApprovalTimeoutMs: 0,
  questionTimeoutMs: 0,
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
};

const team: AgentTeamDefinition = {
  id: "t1",
  name: "test team",
  leader_name: "Elio",
  leader_system_prompt: "Lead the team.",
  members: [{ name: "Niko", description: "designer", system_prompt: "Design things." }],
};

/**
 * A scripted provider that plays out: head delegates to Niko -> head ends its run -> Niko reports
 * back -> Niko ends -> head reviews and gives the final answer. Decisions are derived purely from
 * the message history so the loop is deterministic.
 */
function scriptedProvider(): Provider {
  return {
    metadata: { id: "mock", label: "Mock", defaultBaseUrl: "" },
    async listModels() {
      return [];
    },
    async *streamChatCompletion(opts): AsyncGenerator<StreamDelta, void, unknown> {
      const sys = String(opts.messages[0]?.content ?? "");
      const isLeader = sys.includes('You are "Elio"');
      const msgs = opts.messages;

      if (isLeader) {
        const hasDelegated = msgs.some(
          (m) =>
            m.role === "assistant" &&
            Array.isArray(m.tool_calls) &&
            (m.tool_calls as Array<{ function?: { name?: string } }>).some(
              (t) => t.function?.name === "delegate_task_or_send_message",
            ),
        );
        const gotReport = msgs.some(
          (m) => m.role === "user" && String(m.content).includes("report from a team member"),
        );
        if (!hasDelegated) {
          yield {
            toolCalls: [
              {
                index: 0,
                id: "t-del",
                type: "function",
                function: {
                  name: "delegate_task_or_send_message",
                  arguments: JSON.stringify({
                    messages: [{ agent_id: "Niko", message: "Design the landing page." }],
                  }),
                },
              },
            ],
            finishReason: "tool_calls",
          };
          return;
        }
        if (!gotReport) {
          yield { text: "Delegated to Niko; awaiting the design." };
          return;
        }
        yield { text: "All done — the team completed the landing page." };
        return;
      }

      // Niko
      const hasReported = msgs.some(
        (m) =>
          m.role === "assistant" &&
          Array.isArray(m.tool_calls) &&
          (m.tool_calls as Array<{ function?: { name?: string } }>).some(
            (t) => t.function?.name === "message_team_leader",
          ),
      );
      if (!hasReported) {
        yield {
          toolCalls: [
            {
              index: 0,
              id: "n-rep",
              type: "function",
              function: {
                name: "message_team_leader",
                arguments: JSON.stringify({
                  my_name: "Niko",
                  message: "Design complete in index.html.",
                }),
              },
            },
          ],
          finishReason: "tool_calls",
        };
        return;
      }
      yield { text: "Finished the design task." };
    },
  };
}

/**
 * A scripted provider where the member finishes its FIRST run silently — producing a final text
 * answer without ever calling message_team_leader. Only after the orchestrator injects the automatic
 * "SYSTEM NOTICE" nudge does Niko report back. Exercises the auto-report safety net.
 */
function silentMemberProvider(): Provider {
  return {
    metadata: { id: "mock", label: "Mock", defaultBaseUrl: "" },
    async listModels() {
      return [];
    },
    async *streamChatCompletion(opts): AsyncGenerator<StreamDelta, void, unknown> {
      const sys = String(opts.messages[0]?.content ?? "");
      const isLeader = sys.includes('You are "Elio"');
      const msgs = opts.messages;

      if (isLeader) {
        const hasDelegated = msgs.some(
          (m) =>
            m.role === "assistant" &&
            Array.isArray(m.tool_calls) &&
            (m.tool_calls as Array<{ function?: { name?: string } }>).some(
              (t) => t.function?.name === "delegate_task_or_send_message",
            ),
        );
        if (!hasDelegated) {
          yield {
            toolCalls: [
              {
                index: 0,
                id: "t-del",
                type: "function",
                function: {
                  name: "delegate_task_or_send_message",
                  arguments: JSON.stringify({
                    messages: [{ agent_id: "Niko", message: "Design the landing page." }],
                  }),
                },
              },
            ],
            finishReason: "tool_calls",
          };
          return;
        }
        yield { text: "All done — the team completed the landing page." };
        return;
      }

      // Niko: report only once the automatic nudge has been delivered; otherwise finish silently.
      const hasReported = msgs.some(
        (m) =>
          m.role === "assistant" &&
          Array.isArray(m.tool_calls) &&
          (m.tool_calls as Array<{ function?: { name?: string } }>).some(
            (t) => t.function?.name === "message_team_leader",
          ),
      );
      if (hasReported) {
        yield { text: "Already reported." };
        return;
      }
      const wasNudged = msgs.some(
        (m) => m.role === "user" && String(m.content).includes("SYSTEM NOTICE"),
      );
      if (wasNudged) {
        yield {
          toolCalls: [
            {
              index: 0,
              id: "n-rep",
              type: "function",
              function: {
                name: "message_team_leader",
                arguments: JSON.stringify({
                  my_name: "Niko",
                  message: "Design complete in index.html.",
                }),
              },
            },
          ],
          finishReason: "tool_calls",
        };
        return;
      }
      // First run: finish silently WITHOUT reporting to the leader.
      yield { text: "I finished the design." };
    },
  };
}

function buildOrchestrator(
  events: Array<{ e: string; d: Record<string, unknown> }>,
  signal: AbortSignal,
  provider: Provider = scriptedProvider(),
) {
  const tools = createToolRegistry();
  return new TeamOrchestrator({
    provider,
    tools,
    config: fakeConfig,
    team,
    sendMessageToTeamEnabled: false,
    contexts: new Map(),
    chatId: "chat-1",
    model: "mock-model",
    apiKey: "key",
    web: { searchProvider: "duckduckgo", fetchProvider: "builtin" },
    memory: createMemoryRuntime([]),
    knowledge: createKnowledgeRuntime([]),
    skills: createSkillRuntime([]),
    todos: createTodoRuntime([]),
    subAgentDefinitions: [],
    userSubAgents: [],
    connectors: ConnectorRuntime.empty(),
    send: (e, d) => events.push({ e, d }),
    signal,
  });
}

describe("TeamOrchestrator actor model", () => {
  it("runs head -> delegate -> member -> report -> final and reaches quiescence", async () => {
    const events: Array<{ e: string; d: Record<string, unknown> }> = [];
    const controller = new AbortController();
    const orch = buildOrchestrator(events, controller.signal);

    // The whole point: this promise must RESOLVE (no deadlock, no infinite loop => no freeze).
    await orch.run("Build a landing page.", "");

    // The head delegated to Niko.
    const delegate = events.find(
      (ev) => ev.e === EV_TEAM_MESSAGE && ev.d.to === "Niko" && ev.d.kind === "delegate",
    );
    assert.ok(delegate, "head should delegate to Niko");

    // Niko reported back to the leader.
    const report = events.find(
      (ev) => ev.e === EV_TEAM_MESSAGE && ev.d.to === "Elio" && ev.d.kind === "to_leader",
    );
    assert.ok(report, "Niko should report to the leader");

    // The head produced a final answer segment.
    const finalSegment = events.find(
      (ev) => ev.e === EV_AGENT_SEGMENT && ev.d.agent_id === "Elio" && String(ev.d.content).includes("All done"),
    );
    assert.ok(finalSegment, "head should produce a final answer");
  });

  it("auto-nudges a member that finished without reporting, and it then reports to the leader", async () => {
    const events: Array<{ e: string; d: Record<string, unknown> }> = [];
    const controller = new AbortController();
    const orch = buildOrchestrator(events, controller.signal, silentMemberProvider());

    await orch.run("Build a landing page.", "");

    // Niko finished its first run silently, so the orchestrator injected the automatic nudge.
    const nudgeStart = events.find(
      (ev) =>
        ev.e === "team_agent_start" &&
        ev.d.agent_id === "Niko" &&
        ev.d.trigger === "team-coordination check",
    );
    assert.ok(nudgeStart, "orchestrator should nudge the silent member to report");

    // After the nudge, Niko reported back to the leader.
    const report = events.find(
      (ev) => ev.e === EV_TEAM_MESSAGE && ev.d.to === "Elio" && ev.d.kind === "to_leader",
    );
    assert.ok(report, "nudged member should report to the leader");

    // The head still produced its final answer, and the run reached quiescence (resolved).
    const finalSegment = events.find(
      (ev) =>
        ev.e === EV_AGENT_SEGMENT &&
        ev.d.agent_id === "Elio" &&
        String(ev.d.content).includes("All done"),
    );
    assert.ok(finalSegment, "head should produce a final answer after the nudged report");
  });

  it("stops promptly when aborted", async () => {
    const events: Array<{ e: string; d: Record<string, unknown> }> = [];
    const controller = new AbortController();
    controller.abort();
    const orch = buildOrchestrator(events, controller.signal);
    // Already-aborted run must resolve immediately without hanging.
    await orch.run("Build something.", "");
    assert.ok(true, "aborted run settled");
  });
});
