import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { Provider } from "./providers/types.js";
import type { ToolCall, ToolCallDelta } from "./providers/types.js";
import {
  buildImageMessage,
  extractImageAttachment,
  withoutImageAttachment,
} from "./tools/readImage.js";
import type { StoredMessage } from "../services/sessionStore.js";
import type {
  MultiSubAgentParam,
  SubAgentDefinition,
  SubAgentRuntime,
  ToolContext,
  ToolResult,
} from "./tools/types.js";
import { safeJsonParse } from "../utils/json.js";
import { safeResolve } from "../utils/paths.js";
import { createSubAgentSessionId, isSafeSessionId } from "../database/ids.js";
import { subAgentSessionStore, type SubAgentSessionStatus } from "./subAgentSessionStore.js";
import type { OpenAIToolSchema } from "./tools/registry.js";
import { SUB_AGENT_RESTRICTED_TOOLS } from "./tools/subAgentRestrictedTools.js";
import type { ConnectorRuntime } from "./connectors/runtime.js";
import type { McpRuntime } from "./mcp/runtime.js";
import {
  executeSubAgentHandoff,
  markSubAgentResumed,
  shouldTriggerSummarization,
} from "./summarization/index.js";
import {
  createSlidingWindowTruncationId,
  executeSlidingWindowTruncation,
  normalizeContextManagementMethod,
  normalizeSlidingWindowTruncatePercent,
  shouldTriggerSlidingWindow,
  slidingWindowUtilizationOf,
} from "./slidingWindow.js";

/**
 * Tools a sub-agent may never use. This is the single canonical restricted set
 * (SUB_AGENT_RESTRICTED_TOOLS) enforced at runtime for every sub-agent run: the sub-agent
 * delegation/meta tools (prevents recursive delegation and self-management), the human-in-the-loop
 * tools (only the main agent talks to the user / plans / presents), and the shared todo + skill
 * deletion tools. Every other registered tool (including the knowledge, memory, and skill
 * discovery tools) remains available to sub-agents.
 */
export const SUB_AGENT_EXCLUDED_TOOLS: readonly string[] = SUB_AGENT_RESTRICTED_TOOLS;

/** Directory (relative to the workspace root) where background sub-agent outputs are written. */
export const SUB_AGENT_OUTPUT_DIR = ".mythgram/sub-agent";

export interface SubAgentRuntimeDeps {
  /** The resolved provider serving this turn (built-in or custom). */
  provider: Provider;
  tools: ToolRegistry;
  config: AppConfig;
  chatId: string;
  definitions: SubAgentDefinition[];
  /** Provider/model/credentials — identical to the main agent's, but a separate API call. */
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  /** Reasoning effort (preset or custom string) forwarded to the provider. */
  effort?: string;
  /** Emit an SSE side-channel event onto the turn's event buffer. */
  send: (event: string, data: Record<string, unknown>) => void;
  /**
   * The turn's connector runtime (connected Composio apps). A sub-agent granted connector
   * tools executes them natively against the same connected accounts. Absent when no
   * connector is connected this turn.
   */
  connectors?: ConnectorRuntime;
  /**
   * The turn's MCP runtime (connected MCP servers). A sub-agent granted MCP
   * tools executes them natively against the same servers. Absent when no MCP
   * server is connected this turn.
   */
  mcp?: McpRuntime;
  /**
   * Snapshot the main agent's current conversation messages. Used only when a call_sub_agent
   * invocation sets `send_my_context: true`, so the sub-agent can be handed a readable summary of
   * the surrounding conversation. Returns the live message array; the runner copies/formats it.
   */
  getConversationContext?: () => StoredMessage[];
  /**
   * Effective context-window limit (tokens) for the model serving this turn, resolved by
   * the client from provider catalog metadata or manual entry. Used with the
   * provider-reported prompt_tokens to compute utilization for automatic
   * sub-agent summarization handoff. Absent = handoff disabled (safe, never triggers).
   * Same value the main agent uses — sub-agents run the same model.
   */
  contextLimit?: number | null;
  /**
   * Utilization fraction (0..1) that triggers sub-agent summarization handoff.
   * Defaults to the server summaryThreshold (90%). Per-turn override, same as main agent.
   */
  summaryThreshold?: number;
  /**
   * Context-management method inherited from the parent turn
   * ("summarization" default, or "sliding_window").
   */
  contextManagementMethod?: string;
  /** Fraction freed per sliding-window trigger (default 0.3). */
  slidingWindowTruncatePercent?: number;
}

/**
 * Build the SubAgentRuntime bound to a single main-agent turn. The returned object is injected
 * into the ToolContext so call_sub_agent / list_sub_agents can enumerate and execute sub-agents.
 */
export function createSubAgentRuntime(deps: SubAgentRuntimeDeps): SubAgentRuntime {
  const runner = new SubAgentRunner(deps);
  return {
    definitions: deps.definitions,
    available: () => runner.available(),
    register: (subAgent) => runner.register(subAgent),
    run: (params, ctx) => runner.run(params, ctx),
    runMany: (params, ctx) => runner.runMany(params, ctx),
    listSessions: () => runner.listSessions(),
    reuseSession: (params, ctx) => runner.reuseSession(params, ctx),
  };
}

/** Map a finished loop result to the session status recorded for the sub-agent session store. */
function statusFromResult(result: SubAgentLoopResult): SubAgentSessionStatus {
  if (result.aborted) return "aborted";
  return result.ok ? "completed" : "failed";
}

/** Internal result of running a sub-agent's Thought -> Action -> Observation loop to completion. */
interface SubAgentLoopResult {
  ok: boolean;
  aborted: boolean;
  output: string;
  error?: string;
}

class SubAgentRunner {
  constructor(private readonly deps: SubAgentRuntimeDeps) {}

  /** Enabled sub-agents exposed to the model via list_sub_agents. */
  available(): Array<{ name: string; description: string }> {
    return this.deps.definitions
      .filter((def) => def.enabled !== false && def.name.trim().length > 0)
      .map((def) => ({ name: def.name, description: def.description ?? "" }));
  }

  /**
   * Add a sub-agent definition to the live turn (or replace an existing one matched
   * case-insensitively by name). Mutates the shared `definitions` array in place so the runtime's
   * exposed `definitions`, `available()`, and `find()` all see the new sub-agent immediately.
   */
  register(subAgent: SubAgentDefinition): void {
    const target = subAgent.name.trim().toLowerCase();
    const index = this.deps.definitions.findIndex(
      (def) => def.name.trim().toLowerCase() === target,
    );
    if (index >= 0) {
      this.deps.definitions[index] = subAgent;
    } else {
      this.deps.definitions.push(subAgent);
    }
  }

  private find(name: string): SubAgentDefinition | undefined {
    const target = name.trim().toLowerCase();
    return this.deps.definitions.find(
      (def) => def.enabled !== false && def.name.trim().toLowerCase() === target,
    );
  }

  /**
   * Dispatch a sub-agent invocation. When `wait_for_output` is true (the default) the sub-agent
   * runs to completion and its final report is returned directly to the main agent. When it is
   * false the sub-agent is launched in the BACKGROUND — fully detached from the main agent's turn
   * (its own abort signal, so aborting/ending the main turn never stops it) — and the tool returns
   * immediately with the path of the ".mythgram/sub-agent" file where its output will be written.
   */
  async run(
    params: {
      agent: string;
      task: string;
      wait_for_output?: boolean;
      send_my_context?: boolean;
    },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const task = (params.task ?? "").trim();

    const definition = this.find(params.agent ?? "");
    if (!definition) {
      const names = this.available().map((a) => a.name);
      return {
        ok: false,
        error: {
          code: "unknown_sub_agent",
          message:
            `Unknown or disabled sub-agent "${params.agent}". ` +
            (names.length > 0
              ? `Available sub-agents: ${names.join(", ")}.`
              : "No sub-agents are currently available. The user can create one from Settings."),
        },
      };
    }

    if (!task) {
      return {
        ok: false,
        error: { code: "missing_task", message: "A non-empty task is required for the sub-agent." },
      };
    }

    // Default to waiting: only run in the background when explicitly asked to.
    const waitForOutput = params.wait_for_output !== false;

    // Only share the main conversation when explicitly requested (defaults to false). The context
    // is captured now, at call time, so it reflects the conversation up to this delegation.
    const contextText =
      params.send_my_context === true ? this.captureConversationContext() : undefined;

    // Every sub-agent invocation runs inside its own 10-character session id — this is
    // the key the database uses to store its stream, tool calls, and final output.
    const subSessionId = createSubAgentSessionId();

    return waitForOutput
      ? this.runForeground(definition, task, ctx, subSessionId, contextText)
      : this.runBackground(definition, task, ctx, subSessionId, contextText);
  }

  /**
   * Dispatch a BATCH of sub-agents concurrently from a single tool call. Each entry becomes a fully
   * independent sub-agent run — its own 10-character session id, system prompt, allowed tools, and
   * conversation — exactly like an individual call_sub_agent invocation. The runs execute in
   * parallel; the returned promise resolves once every `wait_for_output: true` entry has finished
   * (their outputs are returned inline) and every `wait_for_output: false` entry has been launched
   * detached in the background (each writing its final report to its own ".mythgram/sub-agent" file).
   *
   * Every child run streams the same `sub_agent_*` side-channel events as call_sub_agent, but each
   * is stamped with a unique child event id and the shared `parent_tool_id`, so the frontend renders
   * one live sub-agent block per entry, all grouped inside this batch tool's block.
   */
  async runMany(
    params: { agents: MultiSubAgentParam[] },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const specs = Array.isArray(params.agents) ? params.agents : [];
    if (specs.length === 0) {
      return {
        ok: false,
        error: {
          code: "no_sub_agents",
          message: "Provide at least one sub-agent to call in the 'agents' array.",
        },
      };
    }

    // The batch shares one parent tool-call id; each child gets a unique, stable event id derived
    // from it (index-based) so the UI can create and address one block per child.
    const parentToolId = ctx.toolCallId ?? `multi_subagent_${Date.now()}`;

    // Resolve every entry up front into a plan item — valid (has a definition + task) or invalid
    // (unknown/disabled agent, or empty prompt). Each carries its own fresh sub-agent session id.
    const plan = specs.map((spec, index) => {
      const agentName = (spec?.agent ?? "").trim();
      const task = (spec?.prompt ?? "").trim();
      const definition = this.find(agentName);
      const waitForOutput = spec?.wait_for_output !== false;
      const sendMyOutput = spec?.send_my_output === true;
      let error: string | undefined;
      if (!definition) {
        const names = this.available().map((a) => a.name);
        error =
          `Unknown or disabled sub-agent "${spec?.agent ?? ""}". ` +
          (names.length > 0
            ? `Available sub-agents: ${names.join(", ")}.`
            : "No sub-agents are currently available.");
      } else if (!task) {
        error = "A non-empty prompt is required for this sub-agent.";
      }
      return {
        index,
        childId: `${parentToolId}::${index}`,
        subSessionId: createSubAgentSessionId(),
        agentName,
        task,
        definition,
        waitForOutput,
        sendMyOutput,
        error,
      };
    });

    // Capture the main conversation once (shared by reference) if any valid entry asked for it.
    const wantsContext = plan.some((p) => p.sendMyOutput && !p.error);
    const contextText = wantsContext ? this.captureConversationContext() : undefined;

    // Announce the whole batch so the frontend can render one block per child immediately — before
    // any child streams — including the invalid entries (shown with their error).
    this.deps.send("multi_sub_agents_start", {
      id: parentToolId,
      count: plan.length,
      agents: plan.map((p) => ({
        id: p.childId,
        agent: p.definition?.name ?? p.agentName,
        task: p.task,
        background: !p.waitForOutput,
        context_shared: Boolean(p.sendMyOutput && !p.error && contextText !== undefined),
        sub_session_id: p.subSessionId,
        error: p.error,
      })),
    });

    // Launch every entry concurrently. Foreground (wait_for_output=true) entries are awaited to
    // completion; background entries resolve as soon as they are detached. Promise.all therefore
    // settles when the slowest foreground child finishes and all background children have started.
    const settled = await Promise.all(
      plan.map((p) => this.runOne(p, ctx, parentToolId, contextText)),
    );

    const waitedFor = settled.filter((r) => r.wait_for_output);
    const background = settled.filter((r) => !r.wait_for_output);
    const failures = settled.filter((r) => r.ok === false);

    return {
      ok: true,
      data: {
        parent_tool_id: parentToolId,
        count: settled.length,
        waited_for: waitedFor.length,
        running_in_background: background.length,
        failed: failures.length,
        agents: settled,
        message: buildMultiSummaryMessage(waitedFor.length, background.length, failures.length),
      },
    };
  }

  /**
   * Run a single planned entry of a call_multiple_sub_agents batch and normalize its outcome into a
   * compact, model-facing record. Invalid entries (unknown agent / empty prompt) emit a start +
   * error-done pair so the UI still shows their block, then report the error without running.
   */
  private async runOne(
    p: {
      index: number;
      childId: string;
      subSessionId: string;
      agentName: string;
      task: string;
      definition: SubAgentDefinition | undefined;
      waitForOutput: boolean;
      sendMyOutput: boolean;
      error?: string;
    },
    ctx: ToolContext,
    parentToolId: string,
    contextText: string | undefined,
  ): Promise<Record<string, unknown> & { wait_for_output: boolean; ok: boolean }> {
    if (p.error || !p.definition) {
      // No run happens — but surface a block in the UI with the error so nothing silently vanishes.
      const agent = p.definition?.name ?? p.agentName;
      this.deps.send("sub_agent_start", {
        id: p.childId,
        parent_tool_id: parentToolId,
        sub_session_id: p.subSessionId,
        agent,
        task: p.task,
        background: !p.waitForOutput,
        context_shared: false,
      });
      this.deps.send("sub_agent_done", {
        id: p.childId,
        parent_tool_id: parentToolId,
        sub_session_id: p.subSessionId,
        ok: false,
        output: "",
        error: p.error,
      });
      return {
        index: p.index,
        agent,
        session_id: p.subSessionId,
        wait_for_output: p.waitForOutput,
        ok: false,
        error: p.error ?? "The sub-agent could not be run.",
      };
    }

    const childContext = p.sendMyOutput ? contextText : undefined;

    if (p.waitForOutput) {
      const result = await this.runForeground(
        p.definition,
        p.task,
        ctx,
        p.subSessionId,
        childContext,
        p.childId,
        parentToolId,
      );
      if (result.ok) {
        const data = (result.data ?? {}) as { output?: unknown; context_shared?: unknown };
        return {
          index: p.index,
          agent: p.definition.name,
          session_id: p.subSessionId,
          wait_for_output: true,
          background: false,
          context_shared: data.context_shared === true,
          ok: true,
          output: typeof data.output === "string" ? data.output : "",
        };
      }
      return {
        index: p.index,
        agent: p.definition.name,
        session_id: p.subSessionId,
        wait_for_output: true,
        background: false,
        ok: false,
        error: result.error?.message ?? "The sub-agent failed.",
      };
    }

    const result = await this.runBackground(
      p.definition,
      p.task,
      ctx,
      p.subSessionId,
      childContext,
      p.childId,
      parentToolId,
    );
    if (result.ok) {
      const data = (result.data ?? {}) as { output_file?: unknown; context_shared?: unknown };
      return {
        index: p.index,
        agent: p.definition.name,
        session_id: p.subSessionId,
        wait_for_output: false,
        background: true,
        context_shared: data.context_shared === true,
        ok: true,
        output_file: typeof data.output_file === "string" ? data.output_file : undefined,
        message:
          `Sub-agent "${p.definition.name}" is running in the background. Read its output file with ` +
          `file_read when you need the result.`,
      };
    }
    return {
      index: p.index,
      agent: p.definition.name,
      session_id: p.subSessionId,
      wait_for_output: false,
      background: true,
      ok: false,
      error: result.error?.message ?? "The background sub-agent could not be started.",
    };
  }

  /**
   * Build a bounded, readable transcript of the main agent's current conversation to hand to a
   * sub-agent when `send_my_context` is true. Returns undefined when no context provider is wired
   * or when the conversation has nothing worth sharing.
   */
  private captureConversationContext(): string | undefined {
    const messages = this.deps.getConversationContext?.() ?? [];
    return buildMainContextBlock(messages);
  }

  /**
   * Run the sub-agent to completion within the main agent's turn and return its final output.
   * The sub-agent shares the main turn's abort signal, so cancelling the turn cancels it too.
   */
  private async runForeground(
    definition: SubAgentDefinition,
    task: string,
    ctx: ToolContext,
    subSessionId: string,
    contextText?: string,
    eventId?: string,
    parentToolId?: string,
  ): Promise<ToolResult> {
    const parentId = eventId ?? ctx.toolCallId ?? `subagent_${Date.now()}`;
    const result = await this.runLoop(definition, task, parentId, ctx, ctx.signal, {
      background: false,
      contextText,
      subSessionId,
      parentToolId,
    });

    if (result.aborted) {
      return { ok: false, error: { code: "aborted", message: "The sub-agent run was aborted." } };
    }
    if (!result.ok) {
      return {
        ok: false,
        error: { code: "sub_agent_failed", message: result.error ?? "The sub-agent failed." },
      };
    }
    return {
      ok: true,
      data: {
        agent: definition.name,
        session_id: subSessionId,
        wait_for_output: true,
        background: false,
        context_shared: contextText !== undefined,
        output: result.output,
      },
    };
  }

  /**
   * Launch the sub-agent in the background and return immediately. The run is fully detached from
   * the main agent's turn: it uses its own AbortController (never the turn's signal), so aborting,
   * stopping, or losing the connection to the main agent does NOT stop the sub-agent. Its final
   * report is written to a ".mythgram/sub-agent/<name>-output-<id>.md" file the main agent reads later.
   */
  private async runBackground(
    definition: SubAgentDefinition,
    task: string,
    ctx: ToolContext,
    subSessionId: string,
    contextText?: string,
    eventId?: string,
    parentToolId?: string,
  ): Promise<ToolResult> {
    const parentId = eventId ?? ctx.toolCallId ?? `subagent_${Date.now()}`;
    const fileName = `${slugifyName(definition.name)}-output-${random5()}.md`;
    const relPath = `${SUB_AGENT_OUTPUT_DIR}/${fileName}`;

    let outputAbs: string;
    try {
      outputAbs = safeResolve(ctx.workspaceRoot, relPath);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "sub_agent_output_path_error",
          message: `Could not resolve the background output file path: ${messageOf(error)}`,
        },
      };
    }

    // Write an initial "running" placeholder so the main agent can read the file immediately and
    // see the sub-agent is still working, even before it finishes.
    try {
      await fs.mkdir(path.dirname(outputAbs), { recursive: true });
      await fs.writeFile(
        outputAbs,
        renderOutputFile({ definition, task, status: "running", output: "" }),
        "utf8",
      );
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "sub_agent_output_write_error",
          message: `Could not create the background output file "${relPath}": ${messageOf(error)}`,
        },
      };
    }

    // A dedicated controller detached from the main turn. It is intentionally never aborted from
    // here, so the background sub-agent keeps running after the main agent aborts, stops, or the
    // connection drops. It only exists to satisfy tools that expect a signal in their context.
    const backgroundController = new AbortController();

    // The background context must NOT carry the main turn's abort signal.
    const backgroundCtx: ToolContext = {
      ...ctx,
      signal: backgroundController.signal,
      toolCallId: parentId,
    };

    this.deps.send("sub_agent_background_started", {
      id: parentId,
      ...(parentToolId ? { parent_tool_id: parentToolId } : {}),
      sub_session_id: subSessionId,
      agent: definition.name,
      task,
      output_file: relPath,
      context_shared: contextText !== undefined,
    });

    // Fire-and-forget: the loop runs independently of this tool call's returned promise.
    void this.runLoop(definition, task, parentId, backgroundCtx, backgroundController.signal, {
      background: true,
      contextText,
      subSessionId,
      parentToolId,
    })
      .then((result) =>
        writeOutputFile(outputAbs, {
          definition,
          task,
          status: result.aborted ? "aborted" : result.ok ? "completed" : "failed",
          output: result.output,
          error: result.error,
        }),
      )
      .catch((error) =>
        writeOutputFile(outputAbs, {
          definition,
          task,
          status: "failed",
          output: "",
          error: messageOf(error),
        }),
      );

    return {
      ok: true,
      data: {
        agent: definition.name,
        session_id: subSessionId,
        wait_for_output: false,
        background: true,
        context_shared: contextText !== undefined,
        output_file: relPath,
        message:
          `Sub-agent "${definition.name}" has started in the background. You can keep doing other ` +
          `work now — you do not need to wait. Its final output will be written to the file ` +
          `"${relPath}". Read that file with file_read when you need the result; while the sub-agent ` +
          `is still working the file shows a "running" status, and it is replaced with the complete ` +
          `report once the sub-agent finishes.`,
      },
    };
  }

  /**
   * List every sub-agent session created so far in this chat (by call_sub_agent /
   * call_multiple_sub_agents), returning the id + agent name + status of each. These ids are what
   * reuse_same_sub_agent_session accepts.
   */
  listSessions(): Array<{ session_id: string; agent: string; status: string }> {
    return subAgentSessionStore.list(this.deps.chatId).map((s) => ({
      session_id: s.sessionId,
      agent: s.agent,
      status: s.status,
    }));
  }

  /**
   * Continue an existing sub-agent session with a new prompt, preserving that session's full prior
   * conversation. The stored transcript is replayed as the sub-agent's context, the new prompt is
   * appended as the next user turn, and the sub-agent runs its Thought -> Action -> Observation loop
   * again — streaming the same `sub_agent_*` events as a fresh run (stamped with the session id) so
   * the frontend can render the continued run live inside the reuse tool block.
   */
  async reuseSession(
    params: { session_id: string; prompt: string },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const sessionId = (params.session_id ?? "").trim();
    const prompt = (params.prompt ?? "").trim();

    if (!isSafeSessionId(sessionId)) {
      return {
        ok: false,
        error: {
          code: "invalid_session_id",
          message:
            "A valid session id is required. Call list_sub_agent_sessions to get the session ids " +
            "of previously run sub-agents.",
        },
      };
    }
    if (!prompt) {
      return {
        ok: false,
        error: {
          code: "missing_prompt",
          message: "A non-empty prompt is required to continue the sub-agent session.",
        },
      };
    }

    const record = subAgentSessionStore.get(this.deps.chatId, sessionId);
    if (!record) {
      const known = subAgentSessionStore.list(this.deps.chatId).map((s) => s.sessionId);
      return {
        ok: false,
        error: {
          code: "unknown_session",
          message:
            `No sub-agent session with id "${sessionId}" exists in this chat. ` +
            (known.length > 0
              ? `Known session ids: ${known.join(", ")}. Call list_sub_agent_sessions first.`
              : "No sub-agent sessions have been created yet in this chat."),
        },
      };
    }

    const parentId = ctx.toolCallId ?? `reuse_${sessionId}`;
    const signal = ctx.signal;

    const eventStamp: Record<string, unknown> = { sub_session_id: sessionId };
    const send = (event: string, data: Record<string, unknown>): void =>
      this.deps.send(event, { ...eventStamp, ...data });

    const { allowed, toolSchemas } = this.buildToolAccess(record.definition);

    // Continue the SAME conversation: the stored transcript is the context, the new prompt is the
    // next user turn appended to it.
    const history: StoredMessage[] = [...record.messages, { role: "user", content: prompt }];

    subAgentSessionStore.update(this.deps.chatId, sessionId, { status: "running" });

    send("sub_agent_start", {
      id: parentId,
      agent: record.agent,
      task: prompt,
      background: false,
      context_shared: true,
    });

    const subToolCtx = this.buildSubToolCtx(ctx, signal);

    const result = await this.agenticLoop({
      definition: record.definition,
      systemPrompt: record.systemPrompt,
      history,
      allowed,
      toolSchemas,
      subToolCtx,
      send,
      parentId,
      signal,
      subSessionId: sessionId,
    });

    subAgentSessionStore.update(this.deps.chatId, sessionId, {
      messages: history,
      status: statusFromResult(result),
    });

    if (result.aborted) {
      return { ok: false, error: { code: "aborted", message: "The sub-agent run was aborted." } };
    }
    if (!result.ok) {
      return {
        ok: false,
        error: { code: "sub_agent_failed", message: result.error ?? "The sub-agent failed." },
      };
    }
    return {
      ok: true,
      data: {
        agent: record.agent,
        session_id: sessionId,
        reused: true,
        output: result.output,
        message: `Continued sub-agent session "${sessionId}" (${record.agent}).`,
      },
    };
  }

  /** Allowed tool set + advertised schemas for a sub-agent definition (meta tools stripped). */
  private buildToolAccess(definition: SubAgentDefinition): {
    allowed: Set<string>;
    toolSchemas: OpenAIToolSchema[];
  } {
    const { tools } = this.deps;
    const connectors = this.deps.connectors;
    const mcp = this.deps.mcp;
    // Connector + MCP tools granted to this sub-agent are allowed when the turn has them
    // (matched by exact name — neither catalog collides with registry names).
    const allowed = new Set(
      (definition.tools ?? []).filter(
        (name) =>
          (tools.has(name) && !SUB_AGENT_EXCLUDED_TOOLS.includes(name)) ||
          (connectors?.has(name) ?? false) ||
          (mcp?.has(name) ?? false),
      ),
    );
    const registrySchemas = tools.schemasFor(
      [...allowed].filter((name) => tools.has(name)),
    );
    const connectorSchemas = connectors
      ? connectors.schemas().filter((s) => allowed.has(s.function.name))
      : [];
    // No allowlist, subset, or cap is applied to connector/MCP tools here either: every
    // granted tool is advertised natively.
    const mcpSchemas = mcp ? mcp.schemas().filter((s) => allowed.has(s.function.name)) : [];
    return { allowed, toolSchemas: [...registrySchemas, ...connectorSchemas, ...mcpSchemas] };
  }

  /**
   * Tool-execution context for a sub-agent. It carries the sub-agent's own abort signal (the
   * background signal when detached) and forwards the shared memory / knowledge / skill runtimes
   * plus the schedule runtime and the SSE emitter from the main turn, so a sub-agent granted those tools (memory_*,
   * knowledge_*, skill_*, schedule_*) can actually use them. It
   * intentionally does NOT forward the sub-agent runtime (no recursion), the todo
   * runtime, or the human-in-the-loop runtimes — those tools are restricted from sub-agents.
   */
  private buildSubToolCtx(outerCtx: ToolContext, signal: AbortSignal | undefined): ToolContext {
    return {
      workspaceRoot: outerCtx.workspaceRoot,
      chatId: outerCtx.chatId,
      shellTimeoutMs: outerCtx.shellTimeoutMs,
      signal,
      web: outerCtx.web,
      model: this.deps.model,
      visionCapable: outerCtx.visionCapable,
      availableToolNames: this.deps.tools.names(),
      emit: outerCtx.emit,
      memory: outerCtx.memory,
      knowledge: outerCtx.knowledge,
      skills: outerCtx.skills,
      schedules: outerCtx.schedules,
      speech: outerCtx.speech,
      connectors: this.deps.connectors,
      mcp: this.deps.mcp,
    };
  }

  /**
   * Execute a sub-agent's unbounded Thought -> Action -> Observation loop to completion, streaming
   * progress as `sub_agent_*` events correlated to the parent tool-call id. Returns a structured
   * result (ok / aborted / output / error) rather than a ToolResult so both the foreground and
   * background callers can shape their own response. The `subSessionId` binds the run to a session
   * record so a later reuse_same_sub_agent_session can continue the exact same conversation.
   */
  private async runLoop(
    definition: SubAgentDefinition,
    task: string,
    parentId: string,
    outerCtx: ToolContext,
    signal: AbortSignal | undefined,
    options: {
      background: boolean;
      contextText?: string;
      subSessionId?: string;
      /** When set, every event of this run also carries `parent_tool_id` so the UI can group the
       * run inside a call_multiple_sub_agents batch block. */
      parentToolId?: string;
    },
  ): Promise<SubAgentLoopResult> {
    const { send: rawSend, config } = this.deps;
    // Stamp every event of this run with its 10-char sub-agent session id so the
    // database can attribute the stream, tool calls, and output to this exact run.
    const subSessionId = options.subSessionId ?? createSubAgentSessionId();
    // When this run belongs to a call_multiple_sub_agents batch, also stamp the parent tool-call id
    // so the frontend nests every event under the batch's tool block instead of a top-level chip.
    const eventStamp: Record<string, unknown> = options.parentToolId
      ? { sub_session_id: subSessionId, parent_tool_id: options.parentToolId }
      : { sub_session_id: subSessionId };
    const send = (event: string, data: Record<string, unknown>): void =>
      rawSend(event, { ...eventStamp, ...data });

    // Allowed tools = the sub-agent's chosen tools, minus the sub-agent meta tools, that
    // actually exist in the registry. This is the tool set both advertised and enforced.
    const { allowed, toolSchemas } = this.buildToolAccess(definition);

    // Each call_sub_agent invocation is an independent, fresh sub-agent conversation. When the main
    // agent opted to share its context, the surrounding conversation is prepended to the task as
    // background so the sub-agent understands the broader goal it is contributing to.
    const hasSharedContext = Boolean(options.contextText && options.contextText.trim().length > 0);
    const firstUserContent = hasSharedContext
      ? `${options.contextText!.trim()}\n\n---\n\n# Your task\n${task}`
      : task;
    const history: StoredMessage[] = [{ role: "user", content: firstUserContent }];

    const systemPrompt = buildSubAgentSystemPrompt(
      definition,
      config.workspaceRoot,
      hasSharedContext,
    );

    // Register the session so its transcript + status can later be continued with
    // reuse_same_sub_agent_session. `history` is stored by reference so the record always reflects
    // the live conversation; its final status is recorded when the loop returns.
    subAgentSessionStore.register({
      sessionId: subSessionId,
      chatId: this.deps.chatId,
      agent: definition.name,
      definition,
      systemPrompt,
      messages: history,
      task,
      background: options.background,
      hasSharedContext,
      status: "running",
    });

    send("sub_agent_start", {
      id: parentId,
      agent: definition.name,
      task,
      background: options.background,
      context_shared: hasSharedContext,
    });

    // Tool executions for a sub-agent must NOT see the sub-agent runtime (no recursion) and
    // carry the sub-agent's own signal (the background signal when detached).
    const subToolCtx = this.buildSubToolCtx(outerCtx, signal);

    const result = await this.agenticLoop({
      definition,
      systemPrompt,
      history,
      allowed,
      toolSchemas,
      subToolCtx,
      send,
      parentId,
      signal,
      subSessionId,
    });

    subAgentSessionStore.update(this.deps.chatId, subSessionId, {
      messages: history,
      status: statusFromResult(result),
    });

    return result;
  }

  /**
   * The shared streaming loop used by both a fresh sub-agent run (runLoop) and a continued session
   * (reuseSession). It drives the model against `history` (mutated in place so the caller can persist
   * the resulting transcript), executing tool calls and streaming `sub_agent_*` events via `send`,
   * until the model returns a final answer with no tool calls or the run is aborted.
   *
   * Automatic context summarization: when provider-reported prompt_tokens reach the
   * configured threshold (default 90%) of the turn's context limit, the sub-agent is
   * immediately stopped (no new generation/tools while summarizing — like the main
   * agent), its history is summarized with the SAME summarization pipeline the main
   * agent uses (chat data + tool calls/results in, system prompt + reasoning out),
   * the ENTIRE history is cleared and replaced with the summary + system-prompt
   * re-send + latest task input, and the loop continues working.
   */
  private async agenticLoop(args: {
    definition: SubAgentDefinition;
    systemPrompt: string;
    history: StoredMessage[];
    allowed: Set<string>;
    toolSchemas: OpenAIToolSchema[];
    subToolCtx: ToolContext;
    send: (event: string, data: Record<string, unknown>) => void;
    parentId: string;
    signal: AbortSignal | undefined;
    /** 10-char session id owning this run (correlates summarization events + history). */
    subSessionId: string;
  }): Promise<SubAgentLoopResult> {
    const { definition, systemPrompt, history, allowed, toolSchemas, subToolCtx, send, parentId, signal, subSessionId } =
      args;
    const { provider, tools } = this.deps;

    const answerAcrossTurns: string[] = [];
    // Handoff bookkeeping mirrors the main agent: a successful replacement resets
    // usage tracking so growth can trigger again; a failed job blocks further
    // auto-triggers for this run to avoid an indefinite retry loop.
    let lastPromptTokens: number | undefined;
    let handoffFailedThisRun = false;
    let slidingWindowFailedThisRun = false;
    let completedHandoffs = 0;
    let completedTruncations = 0;

    try {
      // Unbounded loop: the sub-agent has no iteration limit. It only stops when the model
      // returns a final answer (no tool calls) or the run is aborted via its own signal.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (signal?.aborted) {
          send("sub_agent_done", { id: parentId, ok: false, aborted: true, output: "" });
          return { ok: false, aborted: true, output: "" };
        }

        const answerParts: string[] = [];
        const reasoningParts: string[] = [];
        let toolCalls: ToolCall[] = [];
        let requestUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

        try {
          const stream = provider.streamChatCompletion({
            apiKey: this.deps.apiKey,
            model: this.deps.model,
            messages: buildProviderMessages(systemPrompt, history),
            tools: toolSchemas,
            baseUrl: this.deps.baseUrl,
            temperature: this.deps.temperature,
            effort: this.deps.effort,
            signal,
          });

          for await (const delta of stream) {
            if (delta.reasoning) {
              const cleaned = normalize(delta.reasoning);
              reasoningParts.push(cleaned);
              send("sub_agent_reasoning", { id: parentId, value: cleaned });
            }
            if (delta.text) {
              const cleaned = normalize(delta.text);
              answerParts.push(cleaned);
              send("sub_agent_token", { id: parentId, value: cleaned });
            }
            if (delta.toolCalls) {
              toolCalls = mergeToolCalls(toolCalls, delta.toolCalls);
            }
            const usage = sanitizeSubAgentUsage(delta.usage);
            if (usage) requestUsage = usage;
          }
        } catch (error) {
          if (signal?.aborted) {
            send("sub_agent_done", { id: parentId, ok: false, aborted: true, output: "" });
            return { ok: false, aborted: true, output: "" };
          }
          const message = `Sub-agent provider error: ${messageOf(error)}`;
          send("sub_agent_done", { id: parentId, ok: false, output: "", error: message });
          return { ok: false, aborted: false, output: "", error: message };
        }

        // Context meter signal for this sub-agent run. `send` is already stamped
        // with `sub_session_id` (and `parent_tool_id` for batch runs) by the caller,
        // so the frontend can attribute this usage to the exact runned sub-agent
        // session. Tagged `agent: "sub_agent"` to scope it separately from main.
        if (requestUsage) {
          send("context_usage", {
            agent: "sub_agent",
            sub_agent: definition.name,
            model: this.deps.model,
            prompt_tokens: requestUsage.prompt_tokens,
            completion_tokens: requestUsage.completion_tokens,
            total_tokens: requestUsage.total_tokens,
          });
          if (typeof requestUsage.prompt_tokens === "number") {
            lastPromptTokens = requestUsage.prompt_tokens;
          }
        }

        const namedCalls = toolCalls.filter((c) => c.function.name);

        if (namedCalls.length > 0) {
          const assistantMessage: StoredMessage = {
            role: "assistant",
            content: answerParts.join("") || null,
            tool_calls: namedCalls.map((c) => ({
              id: c.id,
              type: c.type,
              function: { name: c.function.name, arguments: c.function.arguments },
            })),
          };
          if (reasoningParts.length > 0) assistantMessage.reasoning_content = reasoningParts.join("");
          history.push(assistantMessage);
          if (answerParts.length > 0) answerAcrossTurns.push(answerParts.join(""));

          const imageMessages: StoredMessage[] = [];

          for (const toolCall of namedCalls) {
            const name = toolCall.function.name;
            const args2 = safeJsonParse(toolCall.function.arguments);
            const connectors = this.deps.connectors;
            const mcp = this.deps.mcp;
            // Connector/MCP tools execute through the turn's runtimes — but only when
            // this sub-agent was actually granted the tool (it must be in `allowed`).
            const isConnectorTool = allowed.has(name) && (connectors?.has(name) ?? false);
            const isMcpTool = !isConnectorTool && allowed.has(name) && (mcp?.has(name) ?? false);
            const label = isConnectorTool
              ? connectors!.label(name)
              : isMcpTool
                ? mcp!.label(name)
                : tools.label(name, args2);

            send("sub_agent_tool_call", {
              id: parentId,
              tool_id: toolCall.id,
              name,
              args: args2,
              label,
            });

            const result: ToolResult = isConnectorTool
              ? await connectors!.execute(name, args2)
              : isMcpTool
                ? await mcp!.execute(name, args2)
                : allowed.has(name)
                ? await tools.execute(name, args2, subToolCtx)
                : {
                    ok: false,
                    error: {
                      code: "tool_not_permitted",
                      message: `The sub-agent "${definition.name}" is not permitted to use the tool "${name}".`,
                    },
                  };

            // Mirror the main agent: strip any read_image attachment from the model-visible
            // tool message and inject the image as a vision content part afterwards.
            const resultForModel = withoutImageAttachment(result);
            const imageAttachment = extractImageAttachment(result);

            history.push({
              role: "tool",
              tool_call_id: toolCall.id ?? undefined,
              name,
              content: JSON.stringify(resultForModel),
            });

            if (imageAttachment) imageMessages.push(buildImageMessage(imageAttachment));

            send("sub_agent_tool_result", {
              id: parentId,
              tool_id: toolCall.id,
              name,
              ok: result.ok,
              result: resultForModel,
              label,
            });
          }

          // Append vision inputs after all tool responses for contiguous tool messages.
          for (const imageMessage of imageMessages) {
            history.push(imageMessage);
          }

          // Automatic context handoff: the current iteration's tools have fully
          // completed (no in-flight result is discarded), so this is the safe
          // pause point before the next LLM generation — same as the main agent.
          // May run multiple times per sub-agent run whenever utilization reaches
          // the threshold again.
          //
          // Two mutually exclusive methods: summarization (default) or
          // sliding_window (stop → delete oldest 30% → resume).
          const subContextMethod = normalizeContextManagementMethod(
            this.deps.contextManagementMethod,
          );
          if (subContextMethod === "sliding_window") {
            if (!slidingWindowFailedThisRun) {
              const contextLimit =
                typeof this.deps.contextLimit === "number" ? this.deps.contextLimit : null;
              if (shouldTriggerSlidingWindow(lastPromptTokens, contextLimit) && contextLimit) {
                const truncatePercent = normalizeSlidingWindowTruncatePercent(
                  this.deps.slidingWindowTruncatePercent ?? this.deps.config.slidingWindowTruncatePercent,
                );
                const utilizationBefore = slidingWindowUtilizationOf(lastPromptTokens, contextLimit);
                const truncation = executeSlidingWindowTruncation({
                  messages: history,
                  contextLimit,
                  truncatePercent,
                });
                if (truncation.removed.length > 0) {
                  const truncationId = createSlidingWindowTruncationId();
                  history.splice(0, history.length, ...truncation.kept);
                  completedTruncations += 1;
                  lastPromptTokens = undefined;
                  send("sub_agent_sliding_window_truncated", {
                    id: parentId,
                    truncation_id: truncationId,
                    sub_session_id: subSessionId,
                    sub_agent: definition.name,
                    removed_messages: truncation.removed.length,
                    freed_tokens_estimate: truncation.freedTokens,
                    target_tokens: truncation.targetTokens,
                    truncate_percent: truncatePercent,
                    utilization_before: utilizationBefore,
                    context_limit: contextLimit,
                    completed_truncations: completedTruncations,
                    preview: truncation.preview,
                    name: "sliding_window_truncated",
                    label: `Sliding window (${definition.name}): removed ${truncation.removed.length} old message(s) (~${truncation.freedTokens.toLocaleString("en-US")} tokens)`,
                    ok: true,
                    result: {
                      ok: true,
                      data: {
                        removed_messages: truncation.removed.length,
                        freed_tokens_estimate: truncation.freedTokens,
                        truncate_percent: truncatePercent,
                        preview: truncation.preview,
                      },
                    },
                  });
                } else {
                  slidingWindowFailedThisRun = true;
                }
              }
            }
          } else if (!handoffFailedThisRun) {
            const contextLimit =
              typeof this.deps.contextLimit === "number" ? this.deps.contextLimit : null;
            const threshold =
              typeof this.deps.summaryThreshold === "number"
                ? this.deps.summaryThreshold
                : (this.deps.config.summaryThreshold ?? 0.9);
            if (shouldTriggerSummarization(lastPromptTokens, contextLimit, { threshold })) {
              const handoffOutcome = await executeSubAgentHandoff({
                chatId: this.deps.chatId,
                subSessionId,
                subAgentName: definition.name,
                messages: history,
                systemPrompt,
                provider,
                model: this.deps.model,
                apiKey: this.deps.apiKey,
                baseUrl: this.deps.baseUrl,
                temperature: this.deps.temperature,
                effort: this.deps.effort,
                signal,
                send,
              });
              if (handoffOutcome.ok && handoffOutcome.replacement) {
                // Atomic replacement: clear the ENTIRE sub-agent context first, then
                // commit only the approved continuation inputs (summary + latest task
                // input). Splice in place so the session-store reference (registered
                // at run start) stays in sync without a re-registration.
                // The system prompt is NOT part of history — it is re-sent verbatim
                // on the very next LLM request via buildProviderMessages, so the
                // sub-agent never forgets its identity.
                history.splice(0, history.length, ...handoffOutcome.replacement);
                markSubAgentResumed(handoffOutcome.handoff, send);
                completedHandoffs += 1;
                // Fresh usage is required before another handoff: the stale high
                // reading must not retrigger before the next LLM call.
                lastPromptTokens = undefined;
              } else {
                // Failure preserves the original context for recovery. Never resume
                // with a missing summary; block further auto-triggers for this run
                // so a persistently high reading cannot loop forever.
                handoffFailedThisRun = true;
                send("sub_agent_recovery_required", {
                  id: parentId,
                  handoff_id: handoffOutcome.handoff.handoffId,
                  state: handoffOutcome.state,
                  code: handoffOutcome.code ?? "handoff_failed",
                  completed_handoffs: completedHandoffs,
                });
              }
            }
          }

          // Observation delivered — loop so the sub-agent can reason about the results.
          continue;
        }

        // No tool calls -> final answer for the sub-agent.
        const finalContent = answerParts.join("");
        const finalMessage: StoredMessage = { role: "assistant", content: finalContent };
        if (reasoningParts.length > 0) finalMessage.reasoning_content = reasoningParts.join("");
        history.push(finalMessage);

        const output = finalContent.trim() || answerAcrossTurns.join("\n").trim();
        send("sub_agent_done", { id: parentId, ok: true, output });

        return { ok: true, aborted: false, output };
      }
    } catch (error) {
      const message = `Sub-agent failed: ${messageOf(error)}`;
      send("sub_agent_done", { id: parentId, ok: false, output: "", error: message });
      return { ok: false, aborted: false, output: "", error: message };
    }
  }
}

/**
 * Human/model-facing summary line for a completed call_multiple_sub_agents batch: how many entries
 * were waited on (with their outputs inline), how many are still running detached in the background,
 * and how many failed.
 */
function buildMultiSummaryMessage(
  waitedFor: number,
  background: number,
  failures: number,
): string {
  const parts: string[] = [];
  if (waitedFor > 0) {
    parts.push(
      `Waited for ${waitedFor} sub-agent(s); their outputs are included above under each agent.`,
    );
  }
  if (background > 0) {
    parts.push(
      `${background} sub-agent(s) are running in the background — you do not need to wait. Read ` +
        `each one's output file with file_read when you need its result.`,
    );
  }
  if (failures > 0) {
    parts.push(`${failures} sub-agent(s) could not be run or failed; see their 'error' fields.`);
  }
  if (parts.length === 0) return "No sub-agents were run.";
  return parts.join(" ");
}

/** Terminal states a background sub-agent output file can record. */
type SubAgentOutputStatus = "running" | "completed" | "failed" | "aborted";

interface SubAgentOutputFile {
  definition: SubAgentDefinition;
  task: string;
  status: SubAgentOutputStatus;
  output: string;
  error?: string;
}

/** Render the markdown body of a background sub-agent's output file. */
function renderOutputFile(file: SubAgentOutputFile): string {
  const { definition, task, status, output, error } = file;
  const lines: string[] = [
    `# Sub-agent: ${definition.name}`,
    "",
    `- Status: ${status}`,
    "",
    "## Task",
    "",
    task.trim() || "(no task provided)",
    "",
    "## Output",
    "",
  ];
  if (status === "running") {
    lines.push("_The sub-agent is still working. Re-read this file later for the final report._");
  } else if (output.trim().length > 0) {
    lines.push(output.trim());
  } else {
    lines.push("_(the sub-agent produced no textual output)_");
  }
  if (error) {
    lines.push("", "## Error", "", error.trim());
  }
  return `${lines.join("\n")}\n`;
}

/** Best-effort write of a background sub-agent's output file; failures are swallowed. */
async function writeOutputFile(absPath: string, file: SubAgentOutputFile): Promise<void> {
  try {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, renderOutputFile(file), "utf8");
  } catch {
    // Best-effort: the background run has already completed; nothing more we can do.
  }
}

/** Turn a sub-agent name into a filesystem-safe slug for the output file name. */
function slugifyName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "sub-agent";
}

/** A random 5-digit id (10000–99999) used to keep background output file names unique. */
function random5(): string {
  return String(Math.floor(10000 + Math.random() * 90000));
}

/** Upper bound on the shared-context block so a long conversation never bloats the sub-agent call. */
const MAX_CONTEXT_CHARS = 12000;
/** Per-message cap so one huge message (e.g. a big tool result) cannot dominate the context block. */
const MAX_MESSAGE_CHARS = 2000;

/**
 * Turn the main agent's conversation into a bounded, readable transcript to hand to a sub-agent
 * when `send_my_context` is true. Skips the system prompt and empty messages, summarises tool
 * calls/results compactly, truncates each message, and keeps only the most recent messages within
 * an overall character budget (older turns are dropped first). Returns undefined when there is
 * nothing meaningful to share.
 */
function buildMainContextBlock(messages: StoredMessage[]): string | undefined {
  const rendered: string[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const line = renderContextMessage(message);
    if (line) rendered.push(line);
  }
  if (rendered.length === 0) return undefined;

  // Keep the most recent messages that fit within the budget (iterate newest-first, then restore
  // chronological order). This preserves the context closest to the delegation decision.
  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  for (let i = rendered.length - 1; i >= 0; i--) {
    const entry = rendered[i]!;
    const cost = entry.length + 2; // account for the joining blank line
    if (used + cost > MAX_CONTEXT_CHARS && kept.length > 0) {
      dropped = i + 1;
      break;
    }
    kept.push(entry);
    used += cost;
  }
  kept.reverse();

  const header =
    "# Main agent conversation context\n" +
    "The following is a summary of the main agent's conversation so far, shared to give you the " +
    'broader goal behind your task. Treat it as background only — your actual instructions are under ' +
    '"Your task" below.';
  const omitted =
    dropped > 0 ? `\n\n_(${dropped} earlier message(s) omitted to keep this context concise.)_` : "";

  return `${header}\n\n${kept.join("\n\n")}${omitted}`;
}

/** Render a single conversation message as a compact context line, or "" to skip it. */
function renderContextMessage(message: StoredMessage): string {
  const text = truncate(extractText(message.content), MAX_MESSAGE_CHARS);
  switch (message.role) {
    case "user":
      return text ? `## User\n${text}` : "";
    case "assistant": {
      const parts: string[] = [];
      if (text) parts.push(text);
      const toolNames = (message.tool_calls ?? [])
        .map((call) => {
          const fn = (call as { function?: { name?: unknown } }).function;
          return typeof fn?.name === "string" ? fn.name : undefined;
        })
        .filter((name): name is string => Boolean(name));
      if (toolNames.length > 0) parts.push(`(called tool(s): ${toolNames.join(", ")})`);
      return parts.length > 0 ? `## Assistant\n${parts.join("\n")}` : "";
    }
    case "tool":
      return text ? `## Tool result (${message.name ?? "tool"})\n${text}` : "";
    default:
      return "";
  }
}

/** Extract plain text from a StoredMessage's content (string, multimodal parts array, or null). */
function extractText(content: StoredMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") return text;
        const type = (part as { type?: unknown }).type;
        return typeof type === "string" && type !== "text" ? `[${type}]` : "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return "";
}

/** Truncate a string to at most `max` characters, appending an ellipsis marker when cut. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}… [truncated]`;
}

function buildSubAgentSystemPrompt(
  definition: SubAgentDefinition,
  workspaceRoot: string,
  hasSharedContext = false,
): string {
  const base = (definition.system_prompt ?? "").trim();
  const contextLine = hasSharedContext
    ? '- The main agent has shared a summary of its conversation with you under the "Main agent conversation context" section of your task message. Use it as background to understand the broader goal, but focus on completing "Your task"; if anything conflicts, the explicit task instructions win.'
    : "- You have NO access to the main agent's conversation. Everything you need is in the task you were given.";
  return `${base}

# Environment
- You are "${definition.name}", a specialized sub-agent working autonomously on a single delegated task.
- You run on the same machine and share the same workspace as the main agent: ${workspaceRoot}
- All file paths are relative to this workspace (file_read requires an absolute path). Shell commands run from it. Files you create persist on disk.
${contextLine}

# Tools (native function calling only)
- Use real tool calls only. Never describe a tool call in prose or output JSON/markdown pretending to be one.
- Only the tools provided to you are available — do not invent tools.

# Final answer (required)
- Keep working with your tools until the task is fully done.
- When finished, respond with NO tool calls and provide a COMPLETE, self-contained final report of exactly what you found, figured out, changed, or produced. This final message is the ONLY thing returned to the main agent, so it must stand on its own — include the concrete results, findings, file paths, and conclusions the main agent needs.`.trim();
}

/** Build provider (OpenAI) messages: system prompt followed by the sub-agent's conversation. */
function buildProviderMessages(
  systemPrompt: string,
  messages: StoredMessage[],
): Array<Record<string, unknown>> {
  const built: Array<Record<string, unknown>> = [{ role: "system", content: systemPrompt }];
  for (const message of messages) {
    const entry: Record<string, unknown> = { role: message.role };
    if (message.content !== undefined && message.content !== null) entry.content = message.content;
    else if (message.role === "assistant" && message.tool_calls) entry.content = null;
    if (message.tool_calls) entry.tool_calls = message.tool_calls;
    if (message.tool_call_id) entry.tool_call_id = message.tool_call_id;
    if (message.name) entry.name = message.name;
    // Reasoning-capable models require prior reasoning_content to be passed back unchanged.
    if (message.reasoning_content) entry.reasoning_content = message.reasoning_content;
    built.push(entry);
  }
  return built;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Sanitize a provider-reported usage payload for sub-agent runs.
 * Returns cleaned usage when at least one count is present, else null.
 * Never throws.
 */
function sanitizeSubAgentUsage(
  raw: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined,
): { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  const prompt_tokens = num((raw as Record<string, unknown>).prompt_tokens);
  const completion_tokens = num((raw as Record<string, unknown>).completion_tokens);
  const total_tokens = num((raw as Record<string, unknown>).total_tokens);
  if (prompt_tokens === undefined && completion_tokens === undefined && total_tokens === undefined) {
    return null;
  }
  return { prompt_tokens, completion_tokens, total_tokens };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Merge streamed tool-call fragments into complete tool calls, keyed by index. */
function mergeToolCalls(accumulated: ToolCall[], incoming: ToolCallDelta[]): ToolCall[] {
  const merged = accumulated.slice();
  for (const chunk of incoming) {
    const index = chunk.index ?? merged.length;
    while (merged.length <= index) {
      merged.push({ id: null, type: "function", function: { name: "", arguments: "" } });
    }
    const target = merged[index]!;
    if (chunk.id) target.id = chunk.id;
    if (chunk.function?.name) target.function.name += chunk.function.name;
    if (chunk.function?.arguments) target.function.arguments += chunk.function.arguments;
  }
  return merged;
}
