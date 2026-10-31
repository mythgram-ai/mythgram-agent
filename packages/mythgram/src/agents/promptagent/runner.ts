import fs from "node:fs/promises";
import type { AppConfig } from "../../config.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { resolveProvider } from "../providers/registry.js";
import type { Provider } from "../providers/types.js";
import type { ToolRegistry } from "../tools/index.js";
import type { ToolCall, ToolCallDelta } from "../providers/types.js";
import type { ChatSession, StoredMessage } from "../../services/sessionStore.js";
import type { SessionEventBuffer } from "../../services/eventBuffer.js";
import { safeJsonParse } from "../../utils/json.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";
import { createSkillRuntime } from "../skills.js";
import { mergeDefaultSkills, resolveDefaultSkills } from "../skills/index.js";
import { createPromptLibraryRuntime } from "../promptLibrary.js";
import { buildPromptAgentSystemPrompt } from "./systemprompt.js";
import { PROMPT_AGENT_TOOLS, type RunPromptAgentRequest } from "./types.js";

const PROMPT_TOOL_SET = new Set<string>(PROMPT_AGENT_TOOLS);

/** File tools whose writes should mirror content onto the canvas. */
const CANVAS_FILE_TOOLS = new Set(["file_write", "str_replace", "apply_patch"]);

/** Max canvas content chars mirrored per event (keeps the SSE stream bounded). */
const MAX_CANVAS_CHARS = 200_000;

export class PromptAgentRunner {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly tools: ToolRegistry,
    private readonly config: AppConfig,
  ) {}

  private promptLibraryManager?: import("../../prompt-library.js").PromptLibraryManager;

  /**
   * Attach the persistent prompt library (called once at boot). When set, the
   * prompt-library tools can list, save, and delete the user's reusable prompts.
   * Every mutation emits a `prompt_library_updated` event so the frontend mirrors
   * it immediately.
   */
  setPromptLibrary(manager?: import("../../prompt-library.js").PromptLibraryManager): void {
    this.promptLibraryManager = manager;
  }

  /**
   * Execute a full prompt-agent turn: stream reasoning + tokens, run the prompt
   * tools natively, and loop (Thought -> Action -> Observation) until the model
   * produces a final answer with no further tool calls. The loop is UNBOUNDED.
   */
  async run(
    request: RunPromptAgentRequest,
    session: ChatSession,
    buffer: SessionEventBuffer,
    signal: AbortSignal,
  ): Promise<void> {
    const send = (event: string, data: Record<string, unknown>) => buffer.append(event, data);

    try {
      let provider: Provider;
      try {
        provider = resolveProvider(this.providers, request.provider, request.customProvider);
      } catch (error) {
        send("error", { code: "provider_error", message: messageOf(error) });
        send("done", { ok: false });
        return;
      }

      const mode = request.mode === "enhance" ? "enhance" : "create";
      const existing = (request.existingPrompt ?? "").trim();
      const userContent =
        mode === "enhance" && existing
          ? `${request.userMessage}\n\n<existing_prompt>\n${existing}\n</existing_prompt>`
          : request.userMessage;
      session.messages.push({ role: "user", content: userContent });

      const systemPrompt = buildPromptAgentSystemPrompt(this.config.workspaceRoot, mode);
      const toolSchemas = this.tools.schemas.filter((s) => PROMPT_TOOL_SET.has(s.function.name));

      const web = {
        searchProvider: request.searchProvider ?? this.config.searchProvider,
        fetchProvider: request.fetchProvider ?? this.config.fetchProvider,
        tavilyApiKey: request.tavilyApiKey || this.config.tavilyApiKey || undefined,
        exaApiKey: request.exaApiKey || this.config.exaApiKey || undefined,
        serpapiApiKey: request.serpapiApiKey || this.config.serpapiApiKey || undefined,
        firecrawlApiKey: request.firecrawlApiKey || this.config.firecrawlApiKey || undefined,
      };

      const defaultSkills = await resolveDefaultSkills();
      const skillRuntime = createSkillRuntime(mergeDefaultSkills(defaultSkills, request.skills ?? []));
      const promptLibraryRuntime = this.promptLibraryManager
        ? createPromptLibraryRuntime(this.promptLibraryManager)
        : undefined;

      const visibleAnswer: string[] = [];
      const visibleReasoning: string[] = [];
      let iteration = 0;

      send("iteration", { current: 0, limit: null });
      send("prompt_agent_mode", { mode });

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (signal.aborted) {
          send("done", { ok: false, aborted: true });
          return;
        }

        iteration += 1;
        send("iteration", { current: iteration, limit: null });
        send("status", { state: "thinking", label: "Drafting prompt..." });

        const answerParts: string[] = [];
        const reasoningParts: string[] = [];
        let toolCalls: ToolCall[] = [];
        let finishReason: string | null = null;
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
            const usage = sanitizeUsage(delta.usage);
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

        if (requestUsage) {
          send("context_usage", {
            agent: "promptagent",
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

            if (!PROMPT_TOOL_SET.has(toolName) || !this.tools.has(toolName)) {
              const denied = {
                ok: false as const,
                error: {
                  code: "tool_not_permitted",
                  message: `The tool "${toolName}" is not available to the prompt agent.`,
                },
              };
              session.messages.push({
                role: "tool",
                tool_call_id: toolCall.id ?? undefined,
                name: toolName,
                content: JSON.stringify(denied),
              });
              send("tool_call", { id: toolCall.id, name: toolName, args, label: toolName });
              send("tool_result", { id: toolCall.id, name: toolName, ok: false, result: denied, label: toolName });
              continue;
            }

            const toolLabel = this.tools.label(toolName, args);
            send("tool_call", { id: toolCall.id, name: toolName, args, label: toolLabel });

            const result = await this.tools.execute(toolName, args, {
              workspaceRoot: this.config.workspaceRoot,
              shellTimeoutMs: this.config.shellTimeoutMs,
              signal,
              web,
              skills: skillRuntime,
              promptLibrary: promptLibraryRuntime,
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

            // Mirror any Markdown file the agent wrote/edited onto the canvas so
            // the UI can render it live in Markdown.
            if (CANVAS_FILE_TOOLS.has(toolName) && result.ok) {
              await this.emitCanvasForTool(toolName, args, send);
            }
          }

          continue;
        }

        const finalContent = answerParts.join("");
        const finalMessage: StoredMessage = { role: "assistant", content: finalContent };
        if (reasoningParts.length > 0) finalMessage.reasoning_content = reasoningParts.join("");
        session.messages.push(finalMessage);

        send("message_complete", {
          content: visibleAnswer.join(""),
          reasoning: visibleReasoning.length > 0 ? visibleReasoning.join("") : null,
          iteration_count: iteration,
        });
        send("done", { ok: true });
        return;
      }
    } finally {
      buffer.setDone();
      session.running = false;
      session.updatedAt = Date.now();
    }
  }

  /**
   * Best-effort canvas mirror: resolve the file the tool targeted, read it back
   * from disk when it is a Markdown/text file, and emit `prompt_canvas_updated`.
   * Never throws — a mirror failure must never break the turn.
   */
  private async emitCanvasForTool(
    toolName: string,
    args: Record<string, unknown>,
    send: (event: string, data: Record<string, unknown>) => void,
  ): Promise<void> {
    try {
      const rawPath =
        toolName === "file_write"
          ? args.file_path
          : toolName === "str_replace"
            ? args.file_path
            : toolName === "apply_patch"
              ? undefined
              : undefined;
      if (toolName === "apply_patch") {
        // apply_patch can touch several files — the input envelope lists them.
        // Mirror the first absolute path mentioned to keep the canvas simple.
        const input = typeof args.input === "string" ? args.input : "";
        const match = input.match(/^\*\*\* (?:Add File|Update File): (.+)$/m);
        if (!match?.[1]) return;
        await this.emitCanvasFile(match[1].trim(), send);
        return;
      }
      if (typeof rawPath !== "string" || !rawPath.trim()) return;
      await this.emitCanvasFile(rawPath, send);
    } catch {
      // best effort
    }
  }

  private async emitCanvasFile(
    rawPath: string,
    send: (event: string, data: Record<string, unknown>) => void,
  ): Promise<void> {
    try {
      const absolute = safeResolve(this.config.workspaceRoot, rawPath.trim());
      const content = await fs.readFile(absolute, "utf8");
      const relative = toWorkspaceRelative(this.config.workspaceRoot, absolute);
      const truncated = content.length > MAX_CANVAS_CHARS;
      send("prompt_canvas_updated", {
        file_path: relative,
        content: truncated ? content.slice(0, MAX_CANVAS_CHARS) : content,
        chars: content.length,
        truncated,
      });
    } catch {
      // e.g. deleted file — nothing to mirror
    }
  }
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

function sanitizeUsage(
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
