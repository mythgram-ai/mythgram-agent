import type { Provider, ToolCall, ToolCallDelta } from "../providers/types.js";
import type { ToolRegistry, OpenAIToolSchema } from "../tools/registry.js";
import type { StoredMessage } from "../../services/sessionStore.js";
import type { ToolContext, ToolResult } from "../tools/types.js";
import { safeJsonParse } from "../../utils/json.js";
import {
  buildImageMessage,
  extractImageAttachment,
  withoutImageAttachment,
} from "../tools/readImage.js";
import type { ConnectorRuntime } from "../connectors/runtime.js";
import type { McpRuntime } from "../mcp/runtime.js";
import {
  EV_AGENT_REASONING,
  EV_AGENT_SEGMENT,
  EV_AGENT_TOKEN,
  EV_AGENT_TOOL_CALL,
  EV_AGENT_TOOL_RESULT,
  type TeamAgentRunResult,
} from "./types.js";
import {
  createSlidingWindowTruncationId,
  executeSlidingWindowTruncation,
  normalizeContextManagementMethod,
  normalizeSlidingWindowTruncatePercent,
  shouldTriggerSlidingWindow,
  slidingWindowUtilizationOf,
} from "../slidingWindow.js";

/**
 * Parameters for one team agent's streaming Thought -> Action -> Observation loop. `messages` is
 * mutated in place so the caller keeps the agent's growing conversation. Every event is emitted via
 * `send`, which the caller has already stamped with the agent id/role so the UI can attribute it.
 */
export interface TeamAgentLoopParams {
  provider: Provider;
  tools: ToolRegistry;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  effort?: string;
  systemPrompt: string;
  /** The agent's conversation (mutated in place). */
  messages: StoredMessage[];
  /** Tool names this agent may actually execute. */
  allowedTools: Set<string>;
  /** OpenAI tool schemas advertised to the model for this agent. */
  toolSchemas: OpenAIToolSchema[];
  /** The tool-execution context (already carries the team runtime + shared runtimes). */
  toolCtx: ToolContext;
  /**
   * The turn's connector runtime (connected Composio apps). Team agents execute connector
   * tools natively through it. Absent when no connector is connected this turn.
   */
  connectors?: ConnectorRuntime;
  /**
   * The turn's MCP runtime (connected MCP servers). Team agents execute MCP
   * tools natively through it. Absent when no MCP server is connected.
   */
  mcp?: McpRuntime;
  /** Emit an SSE event already stamped with this agent's id/role. */
  send: (event: string, data: Record<string, unknown>) => void;
  signal?: AbortSignal;
  /**
   * Usage scope tag for the context meter: "team" for ordinary team runs,
   * "ceo" for CEO-system runs (CEO + leaders + members under a CEO).
   * Defaults to "team". The `send` wrapper already stamps `agent_id`/`role`,
   * so the frontend can attribute usage to the exact leader/member/CEO.
   */
  usageScope?: "team" | "ceo";
  /** Provider id snapshot for display (when known). */
  providerId?: string;
  /** Effective context-window limit (tokens) for sliding-window truncation. */
  contextLimit?: number | null;
  /** Context-management method ("summarization" default, or "sliding_window"). */
  contextManagementMethod?: string;
  /** Fraction freed per sliding-window trigger (default 0.3). */
  slidingWindowTruncatePercent?: number;
}

/**
 * Execute one team agent's UNBOUNDED agentic loop (no iteration limit — the agent stops only when it
 * produces a final message with no tool calls, or the turn is aborted). Streams team_agent_* events.
 * Returns the agent's final output text. Never throws — provider/tool failures resolve to a failed
 * result so the orchestrator keeps the team alive.
 */
export async function runTeamAgentLoop(params: TeamAgentLoopParams): Promise<TeamAgentRunResult> {
  const { provider, tools, messages, allowedTools, toolSchemas, toolCtx, send, signal } = params;
  const connectors = params.connectors;
  const mcp = params.mcp;

  const answerAcrossTurns: string[] = [];
  let lastPromptTokens: number | undefined;
  let slidingWindowFailedThisRun = false;
  let completedTruncations = 0;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal?.aborted) return { ok: false, aborted: true, output: "" };

      const answerParts: string[] = [];
      const reasoningParts: string[] = [];
      let toolCalls: ToolCall[] = [];
      let finishReason: string | null = null;
      let requestUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

      try {
        const stream = provider.streamChatCompletion({
          apiKey: params.apiKey,
          model: params.model,
          messages: buildProviderMessages(params.systemPrompt, messages),
          tools: toolSchemas,
          baseUrl: params.baseUrl,
          temperature: params.temperature,
          effort: params.effort,
          signal,
        });

        for await (const delta of stream) {
          if (delta.reasoning) {
            const cleaned = normalize(delta.reasoning);
            reasoningParts.push(cleaned);
            send(EV_AGENT_REASONING, { value: cleaned });
          }
          if (delta.text) {
            const cleaned = normalize(delta.text);
            answerParts.push(cleaned);
            send(EV_AGENT_TOKEN, { value: cleaned });
          }
          if (delta.toolCalls) toolCalls = mergeToolCalls(toolCalls, delta.toolCalls);
          if (delta.finishReason) finishReason = delta.finishReason;
          const usage = sanitizeTeamUsage(delta.usage);
          if (usage) requestUsage = usage;
        }
      } catch (error) {
        if (signal?.aborted) return { ok: false, aborted: true, output: "" };
        const message = `Provider error: ${messageOf(error)}`;
        return { ok: false, aborted: false, output: "", error: message };
      }

      // Context meter signal for this team/CEO agent run. `send` is already
      // stamped with `agent_id`/`role` by the orchestrator, so the frontend can
      // attribute this usage to the exact leader/member/CEO.
      if (requestUsage) {
        send("context_usage", {
          agent: params.usageScope ?? "team",
          model: params.model,
          ...(params.providerId ? { provider: params.providerId } : {}),
          prompt_tokens: requestUsage.prompt_tokens,
          completion_tokens: requestUsage.completion_tokens,
          total_tokens: requestUsage.total_tokens,
        });
        if (typeof requestUsage.prompt_tokens === "number") {
          lastPromptTokens = requestUsage.prompt_tokens;
        }
      }

      const namedCalls = toolCalls.filter((c) => c.function.name);
      const hasToolCalls = namedCalls.length > 0 || finishReason === "tool_calls";

      if (hasToolCalls && namedCalls.length > 0) {
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
        messages.push(assistantMessage);
        if (answerParts.length > 0) answerAcrossTurns.push(answerParts.join(""));

        const imageMessages: StoredMessage[] = [];

        for (const toolCall of namedCalls) {
          const name = toolCall.function.name;
          const args = safeJsonParse(toolCall.function.arguments);
          // Connector/MCP tools run through the turn's runtimes; the grant
          // check (`allowedTools`) already covers them, so no second gate is needed here.
          const isConnectorTool = connectors?.has(name) ?? false;
          const isMcpTool = !isConnectorTool && (mcp?.has(name) ?? false);
          const label = isConnectorTool
            ? connectors!.label(name)
            : isMcpTool
              ? mcp!.label(name)
              : tools.label(name, args);

          send(EV_AGENT_TOOL_CALL, { tool_id: toolCall.id, name, args, label });

          const result: ToolResult = isConnectorTool
            ? await connectors!.execute(name, args)
            : isMcpTool
              ? await mcp!.execute(name, args)
              : allowedTools.has(name)
            ? await tools.execute(name, args, toolCtx)
            : {
                ok: false,
                error: {
                  code: "tool_not_permitted",
                  message: `This team agent is not permitted to use the tool "${name}".`,
                },
              };

          const resultForModel = withoutImageAttachment(result);
          const imageAttachment = extractImageAttachment(result);

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id ?? undefined,
            name,
            content: JSON.stringify(resultForModel),
          });

          if (imageAttachment) imageMessages.push(buildImageMessage(imageAttachment));

          send(EV_AGENT_TOOL_RESULT, {
            tool_id: toolCall.id,
            name,
            ok: result.ok,
            result: resultForModel,
            label,
          });
        }

        for (const imageMessage of imageMessages) messages.push(imageMessage);

        // Sliding-window context management (secondary method): when the
        // window hits 99%, stop (all tools done — safe pause point), delete
        // the oldest ~30% tokens, then resume on the next loop iteration.
        // Only runs when Settings selects sliding_window; summarization is
        // the default and team agents otherwise run unbounded.
        if (!slidingWindowFailedThisRun) {
          const teamMethod = normalizeContextManagementMethod(params.contextManagementMethod);
          if (teamMethod === "sliding_window") {
            const teamLimit =
              typeof params.contextLimit === "number" ? params.contextLimit : null;
            if (shouldTriggerSlidingWindow(lastPromptTokens, teamLimit) && teamLimit) {
              const truncatePercent = normalizeSlidingWindowTruncatePercent(
                params.slidingWindowTruncatePercent,
              );
              const utilizationBefore = slidingWindowUtilizationOf(lastPromptTokens, teamLimit);
              const truncation = executeSlidingWindowTruncation({
                messages,
                contextLimit: teamLimit,
                truncatePercent,
              });
              if (truncation.removed.length > 0) {
                const truncationId = createSlidingWindowTruncationId();
                messages.splice(0, messages.length, ...truncation.kept);
                completedTruncations += 1;
                lastPromptTokens = undefined;
                send("sliding_window_truncated", {
                  truncation_id: truncationId,
                  utilization_before: utilizationBefore,
                  context_limit: teamLimit,
                  removed_messages: truncation.removed.length,
                  freed_tokens_estimate: truncation.freedTokens,
                  target_tokens: truncation.targetTokens,
                  truncate_percent: truncatePercent,
                  completed_truncations: completedTruncations,
                  preview: truncation.preview,
                  id: truncationId,
                  name: "sliding_window_truncated",
                  label: `Sliding window: removed ${truncation.removed.length} old message(s) (~${truncation.freedTokens.toLocaleString("en-US")} tokens)`,
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
        }
        continue;
      }

      // No tool calls -> the agent's final message for this run.
      const finalContent = answerParts.join("");
      const finalMessage: StoredMessage = { role: "assistant", content: finalContent };
      if (reasoningParts.length > 0) finalMessage.reasoning_content = reasoningParts.join("");
      messages.push(finalMessage);

      const output = finalContent.trim() || answerAcrossTurns.join("\n").trim();
      send(EV_AGENT_SEGMENT, { content: output });
      return { ok: true, aborted: false, output };
    }
  } catch (error) {
    return { ok: false, aborted: false, output: "", error: `Agent failed: ${messageOf(error)}` };
  }
}

/** Build provider (OpenAI) messages: system prompt followed by the agent's conversation. */
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
    if (message.reasoning_content) entry.reasoning_content = message.reasoning_content;
    built.push(entry);
  }
  return built;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Sanitize a provider-reported usage payload for team/CEO agent runs.
 * Returns cleaned usage when at least one count is present, else null.
 * Never throws.
 */
function sanitizeTeamUsage(
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
