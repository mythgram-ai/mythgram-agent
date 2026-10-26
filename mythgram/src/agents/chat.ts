import type { AppConfig } from "../config.js";
import type { ProviderRegistry } from "./providers/registry.js";
import { resolveProvider } from "./providers/registry.js";
import type { Provider } from "./providers/types.js";
import type { ToolRegistry } from "./tools/index.js";
import type { ToolCall, ToolCallDelta } from "./providers/types.js";
import type { ChatSession, StoredMessage } from "../services/sessionStore.js";
import type { SessionEventBuffer } from "../services/eventBuffer.js";
import { safeJsonParse } from "../utils/json.js";
import { createMemoryRuntime } from "./memory.js";
import { createKnowledgeRuntime } from "./knowledge.js";
import type {
  KnowledgeFile,
  MemoryFile,
  MemoryRuntime,
} from "./tools/types.js";
import type { MemoryAgentService } from "./memoryagent/index.js";

/**
 * Chat mode — a lightweight "talk to the LLM" mode.
 *
 * Unlike the full agent (AgentRunner), the chat runtime only exposes:
 *   - all memory tools (memory_list/search/read/write/edit/delete)
 *   - all knowledge tools (knowledge_list/search/read/create/edit/delete)
 *   - web_search + fatch_web_urls (fetch/scrape, incl. crawl)
 *
 * No file tools, no shell, no sub-agents, no skills, no todos, no connectors,
 * no MCP, no team/CEO tools, no human-in-the-loop plan/question tools.
 * It runs the same unbounded Thought -> Action -> Observation loop and streams
 * onto the same turn event buffer, so resume/replay/persistence work unchanged.
 */

/** The exact tool surface available in chat mode. */
export const CHAT_MODE_TOOLS: readonly string[] = [
  "memory_list",
  "memory_search",
  "memory_read",
  "memory_write",
  "memory_edit",
  "memory_delete",
  "knowledge_list",
  "knowledge_search",
  "knowledge_read",
  "knowledge_create",
  "knowledge_edit",
  "knowledge_delete",
  "web_search",
  "fatch_web_urls",
];

const CHAT_TOOL_SET = new Set<string>(CHAT_MODE_TOOLS);

/** True when a tool name is part of the chat-mode surface. */
export function isChatModeTool(name: string): boolean {
  return CHAT_TOOL_SET.has((name ?? "").trim());
}

/**
 * Build the chat-mode system prompt. Conversational first: answer directly,
 * reach for memory/knowledge/web only when they genuinely help, and never
 * pretend to have file/shell/agent capabilities that are not available.
 */
export function buildChatSystemPrompt(): string {
  return `
You are a helpful conversational AI assistant.

# How to behave
- Chat naturally and directly. Answer the user's questions clearly and concisely.
- You do NOT have access to files, shell commands, sub-agents, skills, or task tracking.
  Never claim you can read/write workspace files, run commands, or delegate work.
  If the user asks for something requiring those capabilities, say plainly that
  chat mode is for conversation only and suggest switching to agent mode.
- Keep going until the user's request is fully answered. Be concise in natural-language
  messages; explain at a high level and let the tools do the lookup work.

# Memory & knowledge
- You have a persistent memory (under /memory/) managed only through the memory tools
  (memory_list, memory_search, memory_read, memory_write, memory_edit, memory_delete).
  Four core files are pre-added and auto-loaded on the user's FIRST message of a chat:
  MEMORY.md (durable facts), SOUL.md (your persona), USER.md (who the user is),
  session-memory.md (short-term summary of the recent session, rebuilt automatically
  by a background memory agent after every completed turn). You may also keep custom
  uncapped files/folders (e.g. preferences.md, projects/app.md).
- At the START of every conversation the core files plus the full memory file structure
  are loaded into your context inside a <persistent_memory> block (first user message
  only). Treat memory as living: record durable facts/preferences/decisions silently
  as part of answering; do not narrate every write.
- Character limits are HARD: MEMORY.md 8000, SOUL.md 2000, USER.md 2000,
  session-memory.md 5000; custom files are uncapped. A write/edit that would exceed
  a limit fails WITHOUT applying — recover by condensing the whole file and rewriting it.
  The four core files cannot be deleted; clear one with memory_write instead.
- The user may also have a curated knowledge base (durable reference material). When it
  exists you see a <knowledge_base> notice on the first message listing its files.
  Discover it with knowledge_list, load relevant files with knowledge_read (knowledge_search
  to locate content), and keep it accurate with knowledge_create / knowledge_edit /
  knowledge_delete. Unlike memory it has no pre-added files and no character limits.

# Web
- Use web_search for up-to-date information (DuckDuckGo is free/keyless by default;
  Tavily/Exa/SerpAPI are used when configured). Use fatch_web_urls to fetch and extract
  clean content from a URL (single page or bounded same-site crawl).
- Only report information you actually verified through your tools for fast-moving facts;
  never invent sources, URLs, or statistics. Cite sources (name + URL) for key claims and
  flag uncertainty honestly.

# Tools (native function calling only)
You have exactly these tools. Use real tool calls — never describe a tool call in prose,
never output JSON/markdown pretending to be a tool call, and never invent tools.
- memory_list(), memory_search(query), memory_read(path, offset?, limit?),
  memory_write(path, content), memory_edit(path, old_str, new_str), memory_delete(path)
- knowledge_list(), knowledge_search(query), knowledge_read(knowledge_path, ...),
  knowledge_create(knowledge_path, content), knowledge_edit(knowledge_path, old_str, new_str),
  knowledge_delete(knowledge_path)
- web_search(query), fatch_web_urls(url, format?, crawl?, maxPages?, maxDepth?, ...)

# Output policy
- When a tool is needed, call it — do not narrate fake results.
- When no tool is needed, answer the user directly.
- Only use emojis if the user explicitly asks for them.
`.trim();
}

export interface RunChatRequest {
  chatId: string;
  userMessage: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** Full user-defined provider config, present when a `custom_` provider is selected. */
  customProvider?: unknown;
  temperature?: number;
  /**
   * Reasoning effort chosen in Settings: a preset (`low` | `medium` | `high` | `max`)
   * or a custom string. Forwarded to the provider; ignored by models without reasoning.
   */
  effort?: string;
  /** Per-request web tool keys/provider (from frontend Settings); falls back to env config. */
  tavilyApiKey?: string;
  exaApiKey?: string;
  serpapiApiKey?: string;
  searchProvider?: "duckduckgo" | "tavily" | "exa" | "serpapi";
  fetchProvider?: "builtin" | "firecrawl";
  firecrawlApiKey?: string;
  /** The user's memory files available this turn. */
  memory?: MemoryFile[];
  /** The user's knowledge base files available this turn. */
  knowledge?: KnowledgeFile[];
  /**
   * Whether the background memory agent may run after this turn. Mirrors the user's Settings
   * choice. Defaults to true (on).
   */
  memoryAgentEnabled?: boolean;
  /**
   * After how many completed user tasks the background memory agent runs. Defaults to 3.
   */
  memoryAgentInterval?: number;
}

export class ChatRunner {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly tools: ToolRegistry,
    private readonly config: AppConfig,
    /**
     * Optional background memory agent. When present, every completed chat turn enqueues a
     * memory-build run exactly like the full agent does.
     */
    private readonly memoryAgent?: MemoryAgentService,
  ) {}

  /**
   * Execute a full chat turn: stream reasoning + tokens, run the chat tools natively, and
   * loop (Thought -> Action -> Observation) until the model produces a final answer with
   * no further tool calls. The loop is UNBOUNDED — it keeps going until the model is done
   * or the turn is aborted.
   */
  async run(
    request: RunChatRequest,
    session: ChatSession,
    buffer: SessionEventBuffer,
    signal: AbortSignal,
  ): Promise<void> {
    const send = (event: string, data: Record<string, unknown>) => buffer.append(event, data);

    // Hoisted so the post-turn memory-agent trigger can hand over the FINAL memory state.
    let memoryRuntime: MemoryRuntime | undefined;
    let turnOk = false;

    try {
      let provider: Provider;
      try {
        provider = resolveProvider(this.providers, request.provider, request.customProvider);
      } catch (error) {
        send("error", { code: "provider_error", message: messageOf(error) });
        send("done", { ok: false });
        return;
      }

      memoryRuntime = createMemoryRuntime(request.memory ?? []);
      const knowledgeRuntime = createKnowledgeRuntime(request.knowledge ?? []);

      // First user message carries the persistent memory + knowledge context, exactly like
      // the full agent: core memory files auto-loaded, knowledge notice only when files exist.
      const isFirstUserMessage = !session.messages.some((m) => m.role === "user");
      const userContent = isFirstUserMessage
        ? withFirstMessageContext(
            request.userMessage,
            memoryRuntime.firstMessageContext(),
            knowledgeRuntime.firstMessageContext(),
          )
        : request.userMessage;

      session.messages.push({ role: "user", content: userContent });

      const systemPrompt = buildChatSystemPrompt();
      // Strict allow-list: only the 14 chat tools are ever advertised, regardless of what
      // the registry holds. Unknown names are dropped silently.
      const toolSchemas = this.tools.schemas.filter((s) => CHAT_TOOL_SET.has(s.function.name));

      const web = {
        searchProvider: request.searchProvider ?? this.config.searchProvider,
        fetchProvider: request.fetchProvider ?? this.config.fetchProvider,
        tavilyApiKey: request.tavilyApiKey || this.config.tavilyApiKey || undefined,
        exaApiKey: request.exaApiKey || this.config.exaApiKey || undefined,
        serpapiApiKey: request.serpapiApiKey || this.config.serpapiApiKey || undefined,
        firecrawlApiKey: request.firecrawlApiKey || this.config.firecrawlApiKey || undefined,
      };

      const visibleAnswer: string[] = [];
      const visibleReasoning: string[] = [];
      let iteration = 0;

      send("iteration", { current: 0, limit: null });

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (signal.aborted) {
          send("done", { ok: false, aborted: true });
          return;
        }

        iteration += 1;
        send("iteration", { current: iteration, limit: null });
        send("status", { state: "thinking", label: "Thinking..." });

        const answerParts: string[] = [];
        const reasoningParts: string[] = [];
        let toolCalls: ToolCall[] = [];
        let finishReason: string | null = null;
        // Per-request token usage reported by the provider for THIS LLM call.
        // `prompt_tokens` is the current context size — the meter signal.
        // Mirrors the main agent loop (see agents/agent.ts).
        let requestUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

        try {
          const stream = provider.streamChatCompletion({
            apiKey: request.apiKey,
            model: request.model,
            messages: buildProviderMessages(systemPrompt, session.messages),
            tools: toolSchemas,
            baseUrl: request.baseUrl,
            temperature: request.temperature,
            effort: request.effort,
            signal,
          });

          for await (const delta of stream) {
            if (delta.reasoning) {
              const cleaned = normalize(delta.reasoning);
              reasoningParts.push(cleaned);
              visibleReasoning.push(cleaned);
              send("reasoning", { value: cleaned });
            }
            if (delta.text) {
              const cleaned = normalize(delta.text);
              answerParts.push(cleaned);
              visibleAnswer.push(cleaned);
              send("token", { value: cleaned });
            }
            if (delta.toolCalls) {
              toolCalls = mergeToolCalls(toolCalls, delta.toolCalls);
            }
            if (delta.finishReason) {
              finishReason = delta.finishReason;
            }
            const usage = sanitizeChatUsage(delta.usage);
            if (usage) requestUsage = usage;
          }
        } catch (error) {
          if (signal.aborted) {
            send("done", { ok: false, aborted: true });
            return;
          }
          send("error", { code: "provider_api_error", message: `Provider API error: ${messageOf(error)}` });
          send("done", { ok: false });
          return;
        }

        // Record this request's context size in the turn's event log (same pipeline
        // as the main agent). Tagged `agent: "chat"` so the meter can scope it to
        // chat mode without confusing it with main/custom usage.
        if (requestUsage) {
          send("context_usage", {
            agent: "chat",
            provider: request.provider,
            model: request.model,
            prompt_tokens: requestUsage.prompt_tokens,
            completion_tokens: requestUsage.completion_tokens,
            total_tokens: requestUsage.total_tokens,
            iteration,
          });
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
          session.messages.push(assistantMessage);

          for (const toolCall of toolCalls) {
            if (!toolCall.function.name) continue;
            const args = safeJsonParse(toolCall.function.arguments);
            const toolName = toolCall.function.name;

            // Defense in depth: the model should only ever call advertised chat tools.
            // Anything else is rejected without execution.
            if (!CHAT_TOOL_SET.has(toolName) || !this.tools.has(toolName)) {
              const denied = {
                ok: false as const,
                error: {
                  code: "tool_not_permitted",
                  message: `The tool "${toolName}" is not available in chat mode. Chat mode supports memory, knowledge, web search, and web fetch tools only.`,
                },
              };
              session.messages.push({
                role: "tool",
                tool_call_id: toolCall.id ?? undefined,
                name: toolName,
                content: JSON.stringify(denied),
              });
              send("tool_call", {
                id: toolCall.id,
                name: toolName,
                args,
                label: toolName,
              });
              send("tool_result", {
                id: toolCall.id,
                name: toolName,
                ok: false,
                result: denied,
                label: toolName,
              });
              continue;
            }

            const toolLabel = this.tools.label(toolName, args);
            send("tool_call", {
              id: toolCall.id,
              name: toolName,
              args,
              label: toolLabel,
            });

            const result = await this.tools.execute(toolName, args, {
              workspaceRoot: this.config.workspaceRoot,
              shellTimeoutMs: this.config.shellTimeoutMs,
              signal,
              web,
              memory: memoryRuntime,
              knowledge: knowledgeRuntime,
              toolCallId: toolCall.id ?? undefined,
              chatId: request.chatId,
              emit: send,
              model: request.model,
            });

            session.messages.push({
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
              label: toolLabel,
            });
          }

          // Observation delivered — loop again so the model can reason about the results.
          continue;
        }

        // No tool calls -> this is the final assistant answer for the turn.
        const finalContent = answerParts.join("");
        const finalMessage: StoredMessage = { role: "assistant", content: finalContent };
        if (reasoningParts.length > 0) finalMessage.reasoning_content = reasoningParts.join("");
        session.messages.push(finalMessage);

        send("message_complete", {
          content: visibleAnswer.join(""),
          reasoning: visibleReasoning.length > 0 ? visibleReasoning.join("") : null,
          iteration_count: iteration,
        });
        turnOk = true;
        send("done", { ok: true });
        return;
      }
    } finally {
      // Same memory-agent schedule as the full agent: build memory after every N completed
      // user tasks (default 3), never when explicitly disabled. Enqueued BEFORE the buffer
      // closes so `memory_agent_queued` still reaches any attached client.
      if (
        this.memoryAgent &&
        memoryRuntime &&
        session.messages.some((m) => m.role === "user") &&
        shouldRunMemoryAgent(session.messages, request.memoryAgentEnabled, request.memoryAgentInterval)
      ) {
        try {
          const runId = this.memoryAgent.enqueue({
            chatId: request.chatId,
            userMessage: request.userMessage,
            transcript: session.messages.map((m) => ({ ...m })),
            memoryFiles: memoryRuntime.files,
            turnOk,
            aborted: signal.aborted,
            provider: request.provider,
            model: request.model,
            apiKey: request.apiKey,
            baseUrl: request.baseUrl,
            customProvider: request.customProvider,
            temperature: request.temperature,
            effort: request.effort,
          });
          if (runId) {
            send("memory_agent_queued", { run_id: runId, chat_id: request.chatId });
          }
        } catch {
          // The memory agent must never break the chat flow.
        }
      }

      buffer.setDone();
      session.running = false;
      session.updatedAt = Date.now();
    }
  }
}

/**
 * Decide whether the background memory agent should run after the just-finished turn.
 * Mirrors the full agent schedule: disabled when explicitly false, otherwise every N
 * completed user tasks (default 3).
 */
export function shouldRunChatMemoryAgent(
  messages: Array<{ role: string }>,
  enabled?: boolean,
  interval?: number,
): boolean {
  return shouldRunMemoryAgent(messages, enabled, interval);
}

function shouldRunMemoryAgent(
  messages: Array<{ role: string }>,
  enabled?: boolean,
  interval?: number,
): boolean {
  if (enabled === false) return false;
  const every = Math.floor(interval ?? 3);
  const n = every >= 1 ? every : 3;
  let userTasks = 0;
  for (const m of messages) {
    if (m.role === "user") userTasks += 1;
  }
  if (userTasks <= 0) return false;
  return userTasks % n === 0;
}

/**
 * Prepend the one-time context blocks to the user's FIRST message of a chat: the pre-added memory
 * files plus the knowledge-base notice (only when knowledge files exist).
 */
function withFirstMessageContext(
  userMessage: string,
  memoryContext: string,
  knowledgeContext: string,
): string {
  const blocks = [memoryContext.trim(), knowledgeContext.trim()].filter((b) => b.length > 0);
  if (blocks.length === 0) return userMessage;
  return `${blocks.join("\n\n")}\n\n${userMessage}`;
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

/**
 * Sanitize a provider-reported usage payload. Returns the cleaned usage when at least
 * one non-negative finite token count is present, otherwise null (unavailable).
 * Mirrors agents/agent.ts sanitizeUsage. Never throws.
 */
function sanitizeChatUsage(
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
