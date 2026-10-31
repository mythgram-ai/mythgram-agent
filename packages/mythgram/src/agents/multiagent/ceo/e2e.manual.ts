/**
 * Manual end-to-end harness for the CEO multi-agent system. NOT part of the test suite — run it with
 * `npx tsx src/agents/multiagent/ceo/e2e.manual.ts`. It drives the REAL CeoAgentRunner (the exact
 * integration chat.ts uses) with a scripted OpenAI-compatible provider registered in a real
 * ProviderRegistry, over a real SessionEventBuffer + ChatSession, across TWO turns — verifying:
 *   1. the full CEO -> leaders -> members -> reports -> CEO-final flow reaches `done ok:true`,
 *   2. tasks the CEO assigns carry the "assigned by the CEO / report back" framing,
 *   3. a second turn re-activates the SAME leaders with their PRIOR context preserved.
 */
import { ProviderRegistry } from "../../providers/registry.js";
import { OpenAICompatibleProvider } from "../../providers/base.js";
import type { Provider, StreamDelta } from "../../providers/types.js";
import { createToolRegistry } from "../../tools/index.js";
import { CeoAgentRunner } from "./index.js";
import type { RunCeoRequest } from "./types.js";
import { SessionEventBuffer } from "../../../services/eventBuffer.js";
import type { ChatSession } from "../../../services/sessionStore.js";
import type { AppConfig } from "../../../config.js";

const config: AppConfig = {
  port: 0,
  workspaceRoot: "/tmp/ceo-e2e",
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
} as AppConfig;

function has(msgs: ReadonlyArray<Record<string, unknown>>, tool: string): boolean {
  return msgs.some(
    (m) =>
      m.role === "assistant" &&
      Array.isArray(m.tool_calls) &&
      (m.tool_calls as Array<{ function?: { name?: string } }>).some((t) => t.function?.name === tool),
  );
}

/** A scripted provider (extends the real OpenAI-compatible base but overrides the stream). */
class ScriptedProvider extends OpenAICompatibleProvider implements Provider {
  constructor() {
    super({ id: "scripted", label: "Scripted", defaultBaseUrl: "http://localhost" });
  }
  override async *streamChatCompletion(opts: {
    messages: Array<Record<string, unknown>>;
  }): AsyncGenerator<StreamDelta, void, unknown> {
    const sys = String(opts.messages[0]?.content ?? "");
    const msgs = opts.messages;

    if (sys.includes('You are "Vera", the CEO')) {
      // Assign whenever a FRESH user request has arrived after the most recent assign (so each turn
      // triggers a new assignment even though the CEO's full prior context is preserved).
      const lastAssignIdx = msgs.reduce(
        (acc, m, i) =>
          m.role === "assistant" &&
          Array.isArray(m.tool_calls) &&
          (m.tool_calls as Array<{ function?: { name?: string } }>).some(
            (t) => t.function?.name === "assign_tasks_to_teams",
          )
            ? i
            : acc,
        -1,
      );
      const lastUserReqIdx = msgs.reduce(
        (acc, m, i) =>
          m.role === "user" && !String(m.content).includes("team leader") ? i : acc,
        -1,
      );
      if (lastUserReqIdx > lastAssignIdx) {
        yield {
          toolCalls: [
            {
              index: 0,
              id: "c1",
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
      const reports = msgs.filter((m) => m.role === "user" && String(m.content).includes("team leader")).length;
      if (reports < 1) {
        yield { text: "Assigned; awaiting reports." };
        return;
      }
      yield { text: "All done — the organization completed the dashboard." };
      return;
    }

    const leader = sys.match(/You are "(Fenn|Baz)", the HEAD/);
    if (leader) {
      const memberId = leader[1] === "Fenn" ? "Ui" : "Api";
      if (!has(msgs, "delegate_task_or_send_message")) {
        yield {
          toolCalls: [
            {
              index: 0,
              id: "l1",
              type: "function",
              function: {
                name: "delegate_task_or_send_message",
                arguments: JSON.stringify({ messages: [{ agent_id: memberId, message: "Do your part." }] }),
              },
            },
          ],
          finishReason: "tool_calls",
        };
        return;
      }
      const gotReport = msgs.some((m) => m.role === "user" && String(m.content).includes("report from a team member"));
      if (gotReport && !has(msgs, "report_task_completion_to_ceo")) {
        yield {
          toolCalls: [
            {
              index: 0,
              id: "l2",
              type: "function",
              function: {
                name: "report_task_completion_to_ceo",
                arguments: JSON.stringify({ summary: `${leader[1]}'s team finished.` }),
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

    // Members
    if (!has(msgs, "message_team_leader")) {
      const memberName = sys.includes('You are "Ui"') ? "Ui" : "Api";
      yield {
        toolCalls: [
          {
            index: 0,
            id: "m1",
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
    yield { text: "Finished." };
  }
}

const ceo: RunCeoRequest["ceo"] = {
  id: "ceo1",
  name: "Vera",
  description: "CEO",
  system_prompt: "Run the org.",
  teams: [
    {
      id: "frontend",
      name: "Frontend Team",
      leader_name: "Fenn",
      leader_system_prompt: "Lead frontend.",
      members: [{ name: "Ui", description: "UI", system_prompt: "Build UIs." }],
    },
    {
      id: "backend",
      name: "Backend Team",
      leader_name: "Baz",
      leader_system_prompt: "Lead backend.",
      members: [{ name: "Api", description: "API", system_prompt: "Build APIs." }],
    },
  ],
};

function newSession(): ChatSession {
  return {
    chatId: "chat-e2e",
    messages: [],
    eventBuffer: null,
    abortController: null,
    running: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function runTurn(runner: CeoAgentRunner, session: ChatSession, userMessage: string) {
  const events: Array<{ e: string; d: Record<string, unknown> }> = [];
  const buffer = new SessionEventBuffer((_id, e, d) => events.push({ e, d }));
  session.eventBuffer = buffer;
  session.running = true;
  const controller = new AbortController();
  const req: RunCeoRequest = {
    chatId: "chat-e2e",
    userMessage,
    ceo,
    sendMessageToTeamEnabled: false,
    provider: "scripted",
    model: "mock",
    apiKey: "k",
  };
  await runner.run(req, session, buffer, controller.signal);
  return events;
}

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok  - ${msg}`);
}

async function main() {
  const providers = new ProviderRegistry().registerAll([new ScriptedProvider()]);
  const tools = createToolRegistry();
  const runner = new CeoAgentRunner(providers, tools, config);
  const session = newSession();

  // ---- Turn 1 ----
  const e1 = await runTurn(runner, session, "Build a dashboard.");
  const msg = (to: string, kind: string) =>
    e1.find((x) => x.e === "team_message" && x.d.to === to && x.d.kind === kind);

  assert(msg("Fenn", "delegate"), "CEO assigns to Fenn");
  assert(msg("Baz", "delegate"), "CEO assigns to Baz");
  assert(/assigned to you by the CEO/.test(String(msg("Fenn", "delegate")!.d.message)), "task carries CEO framing");
  assert(/report_task_completion_to_ceo/.test(String(msg("Fenn", "delegate")!.d.message)), "task tells leader to report to CEO");
  assert(e1.find((x) => x.e === "team_message" && x.d.to === "Ui" && x.d.from === "Fenn"), "Fenn delegates to Ui");
  assert(e1.find((x) => x.e === "team_message" && x.d.to === "Api" && x.d.from === "Baz"), "Baz delegates to Api");
  assert(msg("Fenn", "to_leader"), "Ui reports to Fenn");
  assert(e1.filter((x) => x.e === "team_message" && x.d.to === "Vera" && x.d.kind === "to_leader").length >= 1, "leaders report to CEO");
  assert(
    e1.find((x) => x.e === "team_agent_segment" && x.d.agent_id === "Vera" && String(x.d.content).includes("All done")),
    "CEO produces final answer",
  );
  assert(e1.find((x) => x.e === "done" && x.d.ok === true), "turn 1 completes with done ok:true");

  // ---- Turn 2 (same chat → contexts preserved) ----
  const e2 = await runTurn(runner, session, "Now add dark mode.");
  assert(e2.find((x) => x.e === "team_message" && x.d.to === "Fenn" && x.d.kind === "delegate"), "turn 2 re-activates Fenn");
  assert(e2.find((x) => x.e === "done" && x.d.ok === true), "turn 2 completes with done ok:true");

  console.log("\nALL CEO END-TO-END CHECKS PASSED");
}

void main();
