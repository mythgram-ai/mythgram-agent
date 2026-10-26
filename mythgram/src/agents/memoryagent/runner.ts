import type { Provider, ToolCall, ToolCallDelta } from "../providers/types.js";
import type { ToolRegistry } from "../tools/index.js";
import type { AppConfig } from "../../config.js";
import type { StoredMessage } from "../../services/sessionStore.js";
import { createMemoryRuntime } from "../memory.js";
import { safeJsonParse } from "../../utils/json.js";
import { buildMemoryAgentSystemPrompt } from "./systemprompt.js";
import { buildMemoryAgentUserMessage } from "./context.js";
import { MEMORY_AGENT_TOOLS, type MemoryAgentBuildRequest } from "./types.js";
import type { MemoryFile } from "../tools/types.js";

/** The outcome of a completed memory-agent run. */
export interface MemoryAgentRunOutcome {
  ok: boolean;
  /** The agent's final message — the run summary. */
  summary: string;
  error?: string;
  /** Memory paths the agent wrote/edited/deleted (deduped, in first-touch order). */
  updatedFiles: string[];
  /** The final state of the memory files after the run. */
  memoryFiles: MemoryFile[];
}

export interface RunMemoryAgentParams {
  provider: Provider;
  tools: ToolRegistry;
  config: AppConfig;
  request: MemoryAgentBuildRequest;
  /** Push one SSE event onto the run's stream (buffer + persistence handled by the caller). */
  send: (event: string, data: Record<string, unknown>) => void;
  /** Called on EVERY memory mutation with the full current file set, so memory persists live. */
  onMemoryChanged: (files: MemoryFile[]) => void;
}

/** Transient provider failures are retried this many times before the run fails. */
const PROVIDER_MAX_ATTEMPTS = 3;
const PROVIDER_RETRY_DELAY_MS = 2_000;

/**
 * Execute one full memory-agent run: an autonomous Thought -> Action -> Observation loop
 * over the memory operation tools ONLY, with NO iteration limit (unlike the main agent) —
 * the run ends when the model produces a final message with no further tool calls. Nobody
 * can abort it; it runs on its own path to completion.
 */
export async function runMemoryAgent(params: RunMemoryAgentParams): Promise<MemoryAgentRunOutcome> {
  const { provider, tools, config, request, send } = params;

  const memoryRuntime = createMemoryRuntime(request.memoryFiles);
  const updatedFiles: string[] = [];
  const recordUpdatedFile = (path: unknown): void => {
    if (typeof path !== "string" || path.trim().length === 0) return;
    const key = path.trim();
    if (!updatedFiles.some((p) => p.toLowerCase() === key.toLowerCase())) updatedFiles.push(key);
  };

  // Tool-context emit: forward every event onto the run stream, and persist memory live on
  // every mutation so the update survives even if the process dies mid-run.
  const emit = (event: string, data: Record<string, unknown>): void => {
    send(event, data);
    if (event === "memory_updated" && Array.isArray(data.memoryFiles)) {
      try {
        params.onMemoryChanged(data.memoryFiles as MemoryFile[]);
      } catch {
        // Persistence must never break the run.
      }
    }
  };

  const systemPrompt = buildMemoryAgentSystemPrompt();
  const messages: StoredMessage[] = [
    { role: "user", content: buildMemoryAgentUserMessage(request) },
  ];
  const toolSchemas = tools.schemasFor(MEMORY_AGENT_TOOLS);
  const finalParts: string[] = [];
  let iteration = 0;

  // NO iteration cap — the memory agent is unbounded by design and stops on its own.
  for (;;) {
    iteration += 1;
    send("iteration", { current: iteration });
    send("status", { state: "thinking", label: "Building memory..." });

    const answerParts: string[] = [];
    const reasoningParts: string[] = [];
    let toolCalls: ToolCall[] = [];
    let finishReason: string | null = null;

    try {
      await streamWithRetry(async () => {
        answerParts.length = 0;
        reasoningParts.length = 0;
        toolCalls = [];
        finishReason = null;

        const stream = provider.streamChatCompletion({
          apiKey: request.apiKey,
          model: request.model,
          messages: buildProviderMessages(systemPrompt, messages),
          tools: toolSchemas,
          baseUrl: request.baseUrl,
          temperature: request.temperature,
          effort: request.effort,
        });

        for await (const delta of stream) {
          if (delta.reasoning) {
            const cleaned = normalize(delta.reasoning);
            reasoningParts.push(cleaned);
            send("reasoning", { value: cleaned });
          }
          if (delta.text) {
            const cleaned = normalize(delta.text);
            answerParts.push(cleaned);
            send("token", { value: cleaned });
          }
          if (delta.toolCalls) {
            toolCalls = mergeToolCalls(toolCalls, delta.toolCalls);
          }
          if (delta.finishReason) finishReason = delta.finishReason;
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send("error", { code: "provider_api_error", message: `Provider API error: ${message}` });
      return {
        ok: false,
        summary: finalParts.join(""),
        error: message,
        updatedFiles,
        memoryFiles: memoryRuntime.files,
      };
    }

    const hasToolCalls = toolCalls.some((c) => c.function.name) || finishReason === "tool_calls";

    if (hasToolCalls) {
      const assistantMessage: StoredMessage = {
        role: "assistant",
        content: answerParts.join("") || null,
        tool_calls: toolCalls.map((c) => ({
          id: c.id,
          type: c.type,
          function: { name: c.function.name, arguments: c.function.arguments },
        })),
      };
      if (reasoningParts.length > 0) assistantMessage.reasoning_content = reasoningParts.join("");
      messages.push(assistantMessage);

      for (const toolCall of toolCalls) {
        if (!toolCall.function.name) continue;
        const args = safeJsonParse(toolCall.function.arguments);

        send("tool_call", {
          id: toolCall.id,
          name: toolCall.function.name,
          args,
          label: tools.label(toolCall.function.name, args),
        });

        // Guard the tool surface: the memory agent may only use the memory tools even if
        // the model hallucinates another name.
        const allowed = MEMORY_AGENT_TOOLS.includes(toolCall.function.name);
        const result = allowed
          ? await tools.execute(toolCall.function.name, args, {
              workspaceRoot: config.workspaceRoot,
              shellTimeoutMs: config.shellTimeoutMs,
              memory: memoryRuntime,
              chatId: request.chatId,
              toolCallId: toolCall.id ?? undefined,
              emit,
              model: request.model,
            })
          : {
              ok: false as const,
              error: {
                code: "tool_not_allowed",
                message:
                  `Tool '${toolCall.function.name}' is not available to the memory agent. ` +
                  `Only the memory tools are allowed: ${MEMORY_AGENT_TOOLS.join(", ")}.`,
              },
            };

        if (result.ok && isMemoryMutation(toolCall.function.name)) {
          recordUpdatedFile((args as Record<string, unknown>).path);
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id ?? undefined,
          name: toolCall.function.name,
          content: JSON.stringify(result),
        });

        send("tool_result", {
          id: toolCall.id,
          name: toolCall.function.name,
          ok: result.ok,
          result,
          label: tools.label(toolCall.function.name, args),
        });
      }

      continue;
    }

    // No tool calls -> the run's final summary message.
    const finalContent = answerParts.join("");
    finalParts.push(finalContent);
    messages.push({ role: "assistant", content: finalContent });

    send("message_complete", {
      content: finalContent,
      reasoning: reasoningParts.length > 0 ? reasoningParts.join("") : null,
      iteration_count: iteration,
    });

    return {
      ok: true,
      summary: finalContent,
      updatedFiles,
      memoryFiles: memoryRuntime.files,
    };
  }
}

/** True for the memory tools that mutate a file (used to track which paths a run touched). */
function isMemoryMutation(name: string): boolean {
  return name === "memory_write" || name === "memory_edit" || name === "memory_delete";
}

/** Run `attempt` with bounded retries + linear backoff for transient provider failures. */
async function streamWithRetry(attempt: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let i = 1; i <= PROVIDER_MAX_ATTEMPTS; i += 1) {
    try {
      await attempt();
      return;
    } catch (error) {
      lastError = error;
      if (i < PROVIDER_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, PROVIDER_RETRY_DELAY_MS * i));
      }
    }
  }
  throw lastError;
}

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
