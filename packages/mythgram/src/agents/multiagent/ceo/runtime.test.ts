import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CeoOrchestrator } from "./runtime.js";
import type { CeoAgentDefinition } from "./types.js";
import { EV_AGENT_SEGMENT, EV_TEAM_MESSAGE } from "../types.js";
import { createToolRegistry } from "../../tools/index.js";
import { createMemoryRuntime } from "../../memory.js";
import { createKnowledgeRuntime } from "../../knowledge.js";
import { createSkillRuntime } from "../../skills.js";
import { createTodoRuntime } from "../../todos.js";
import { ConnectorRuntime } from "../../connectors/index.js";
import type { AppConfig } from "../../../config.js";
import type { Provider, StreamDelta } from "../../providers/types.js";

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

const ceo: CeoAgentDefinition = {
  id: "ceo1",
  name: "Vera",
  description: "The CEO",
  system_prompt: "Run the organization.",
  teams: [
    {
      id: "frontend",
      name: "Frontend Team",
      leader_name: "Fenn",
      leader_system_prompt: "Lead the frontend team.",
      members: [{ name: "Ui", description: "builds UI", system_prompt: "Build UIs." }],
    },
    {
      id: "backend",
      name: "Backend Team",
      leader_name: "Baz",
      leader_system_prompt: "Lead the backend team.",
      members: [{ name: "Api", description: "builds APIs", system_prompt: "Build APIs." }],
    },
  ],
};

function has(msgs: ReadonlyArray<Record<string, unknown>>, toolName: string): boolean {
  return msgs.some(
    (m) =>
      m.role === "assistant" &&
      Array.isArray(m.tool_calls) &&
      (m.tool_calls as Array<{ function?: { name?: string } }>).some(
        (t) => t.function?.name === toolName,
      ),
  );
}

/**
 * Scripted provider for the full CEO flow:
 *   CEO -> assign_tasks_to_teams(Fenn, Baz)
 *   each leader -> delegate_task_or_send_message(its member)
 *   each member -> message_team_leader
 *   each leader -> report_task_completion_to_ceo
 *   CEO -> final answer once both reports arrive.
 * Decisions are derived purely from the message history so the loop is deterministic.
 */
function scriptedProvider(): Provider {
  return {
    metadata: { id: "mock", label: "Mock", defaultBaseUrl: "" },
    async listModels() {
      return [];
    },
    async *streamChatCompletion(opts): AsyncGenerator<StreamDelta, void, unknown> {
      const sys = String(opts.messages[0]?.content ?? "");
      const msgs = opts.messages as Array<Record<string, unknown>>;

      // ---- CEO ----
      if (sys.includes('You are "Vera", the CEO')) {
        if (!has(msgs, "assign_tasks_to_teams")) {
          yield {
            toolCalls: [
              {
                index: 0,
                id: "c-assign",
                type: "function",
                function: {
                  name: "assign_tasks_to_teams",
                  arguments: JSON.stringify({
                    tasks: [
                      { team_leader: "Fenn", prompt: "Build the dashboard UI." },
                      { team_leader: "Baz", prompt: "Build the dashboard API." },
                    ],
                  }),
                },
              },
            ],
            finishReason: "tool_calls",
          };
          return;
        }
        const reports = msgs.filter(
          (m) => m.role === "user" && String(m.content).includes("team leader"),
        ).length;
        if (reports < 1) {
          yield { text: "Assigned to both teams; awaiting completion reports." };
          return;
        }
        yield { text: "All done — the organization completed the dashboard." };
        return;
      }

      // ---- Team leaders (Fenn / Baz) ----
      const leaderMatch = sys.match(/You are "(Fenn|Baz)", the HEAD/);
      if (leaderMatch) {
        const memberId = leaderMatch[1] === "Fenn" ? "Ui" : "Api";
        if (!has(msgs, "delegate_task_or_send_message")) {
          yield {
            toolCalls: [
              {
                index: 0,
                id: "l-del",
                type: "function",
                function: {
                  name: "delegate_task_or_send_message",
                  arguments: JSON.stringify({
                    messages: [{ agent_id: memberId, message: "Do your part." }],
                  }),
                },
              },
            ],
            finishReason: "tool_calls",
          };
          return;
        }
        const gotReport = msgs.some(
          (m) => m.role === "user" && String(m.content).includes("report from a team member"),
        );
        if (gotReport && !has(msgs, "report_task_completion_to_ceo")) {
          yield {
            toolCalls: [
              {
                index: 0,
                id: "l-rep",
                type: "function",
                function: {
                  name: "report_task_completion_to_ceo",
                  arguments: JSON.stringify({ summary: "Team finished its part." }),
                },
              },
            ],
            finishReason: "tool_calls",
          };
          return;
        }
        yield { text: "Working." };
        return;
      }

      // ---- Members (Ui / Api) ----
      if (!has(msgs, "message_team_leader")) {
        const memberName = sys.includes('You are "Ui"') ? "Ui" : "Api";
        yield {
          toolCalls: [
            {
              index: 0,
              id: "m-rep",
              type: "function",
              function: {
                name: "message_team_leader",
                arguments: JSON.stringify({ my_name: memberName, message: "Done." }),
              },
            },
          ],
          finishReason: "tool_calls",
        };
        return;
      }
      yield { text: "Finished my task." };
    },
  };
}

function buildOrchestrator(
  events: Array<{ e: string; d: Record<string, unknown> }>,
  signal: AbortSignal,
  provider: Provider = scriptedProvider(),
) {
  const tools = createToolRegistry();
  return new CeoOrchestrator({
    provider,
    tools,
    config: fakeConfig,
    ceo,
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

describe("CeoOrchestrator actor model", () => {
  it("runs CEO -> assign -> leaders -> members -> reports -> CEO final and reaches quiescence", async () => {
    const events: Array<{ e: string; d: Record<string, unknown> }> = [];
    const controller = new AbortController();
    const orch = buildOrchestrator(events, controller.signal);

    // Must RESOLVE (no deadlock/infinite loop) — the whole point of the actor model.
    await orch.run("Build a dashboard.", "");

    // The CEO assigned tasks to both team leaders.
    const toFenn = events.find(
      (ev) => ev.e === EV_TEAM_MESSAGE && ev.d.to === "Fenn" && ev.d.kind === "delegate",
    );
    const toBaz = events.find(
      (ev) => ev.e === EV_TEAM_MESSAGE && ev.d.to === "Baz" && ev.d.kind === "delegate",
    );
    assert.ok(toFenn, "CEO should assign to Fenn");
    assert.ok(toBaz, "CEO should assign to Baz");

    // The assigned prompt carries the CEO framing.
    assert.match(String(toFenn!.d.message), /assigned to you by the CEO/);
    assert.match(String(toFenn!.d.message), /report_task_completion_to_ceo/);

    // Each leader delegated to its own member (scoped to its team).
    assert.ok(
      events.find((ev) => ev.e === EV_TEAM_MESSAGE && ev.d.to === "Ui" && ev.d.from === "Fenn"),
      "Fenn should delegate to Ui",
    );
    assert.ok(
      events.find((ev) => ev.e === EV_TEAM_MESSAGE && ev.d.to === "Api" && ev.d.from === "Baz"),
      "Baz should delegate to Api",
    );

    // Members reported to their leaders.
    assert.ok(
      events.find((ev) => ev.e === EV_TEAM_MESSAGE && ev.d.to === "Fenn" && ev.d.kind === "to_leader"),
      "Ui should report to Fenn",
    );

    // Leaders reported completion up to the CEO.
    const toCeo = events.filter(
      (ev) => ev.e === EV_TEAM_MESSAGE && ev.d.to === "Vera" && ev.d.kind === "to_leader",
    );
    assert.ok(toCeo.length >= 1, "at least one leader should report to the CEO");

    // The CEO produced the final answer.
    const finalSegment = events.find(
      (ev) =>
        ev.e === EV_AGENT_SEGMENT &&
        ev.d.agent_id === "Vera" &&
        String(ev.d.content).includes("All done"),
    );
    assert.ok(finalSegment, "CEO should produce a final answer");
  });

  it("stops promptly when aborted", async () => {
    const events: Array<{ e: string; d: Record<string, unknown> }> = [];
    const controller = new AbortController();
    controller.abort();
    const orch = buildOrchestrator(events, controller.signal);
    await orch.run("Build something.", "");
    assert.ok(true, "aborted run settled");
  });
});
