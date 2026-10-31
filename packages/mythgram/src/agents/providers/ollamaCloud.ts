import { OpenAICompatibleProvider } from "./base.js";
import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  ProviderModel,
  StreamDelta,
  ToolCall,
  ToolCallDelta,
} from "./types.js";

/**
 * Ollama Cloud is NOT OpenAI-compatible: models come from `/api/tags` and chat streams
 * newline-delimited JSON from `/api/chat` (not SSE). We normalize both to the common
 * Provider surface so the agent loop treats it like any other provider.
 */
class OllamaCloudProvider extends OpenAICompatibleProvider {
  /** Ollama's REST root (e.g. https://ollama.com/api), derived from the OpenAI-style base URL. */
  private apiRoot(override?: string): string {
    const raw = (override || this.metadata.defaultBaseUrl).replace(/\/+$/, "");
    return raw.replace(/\/v1$/, "");
  }

  override async listModels(apiKey: string, baseUrl?: string): Promise<ProviderModel[]> {
    const response = await fetch(`${this.apiRoot(baseUrl)}/tags`, {
      method: "GET",
      headers: this.headers(apiKey),
    });
    if (!response.ok) {
      throw new Error(`${this.metadata.label} models error ${response.status}: ${await safeText(response)}`);
    }
    const payload = (await response.json()) as { models?: Array<Record<string, unknown>> };
    const items = payload.models ?? [];

    const models: ProviderModel[] = [];
    for (const item of items) {
      const id = item.name as string;
      if (!id) continue;
      models.push({
        id,
        provider: this.metadata.id,
        label: id,
        owned_by: "ollama",
        context_window: null,
        max_output_tokens: null,
        pricing: null,
        description: null,
        capabilities: null,
      });
    }
    models.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    return models;
  }

  override async *streamChatCompletion(options: ChatCompletionOptions): AsyncGenerator<StreamDelta, void, unknown> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: normalizeMessages(options.messages),
      stream: true,
    };
    const tools = normalizeTools(options.tools);
    if (tools.length > 0) body.tools = tools;

    const response = await fetch(`${this.apiRoot(options.baseUrl)}/chat`, {
      method: "POST",
      headers: this.headers(options.apiKey),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      let message = `${this.metadata.label} error (${response.status})`;
      const text = await safeText(response);
      if (text) {
        const parsed = tryParse(text);
        if (parsed && typeof parsed.error === "string") message = `${this.metadata.label}: ${parsed.error}`;
        else message = `${this.metadata.label} error (${response.status}): ${text}`;
      }
      throw new Error(message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;

          const event = tryParse(line);
          if (!event) continue;
          if (typeof event.error === "string") throw new Error(String(event.error));
          yield deltaFromEvent(event);
        }
      }

      const tail = buffer.trim();
      if (tail) {
        const event = tryParse(tail);
        if (event) {
          if (typeof event.error === "string") throw new Error(String(event.error));
          yield deltaFromEvent(event);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Non-streaming variant of the Ollama `/api/chat` call (`stream: false`
   * answers with a single JSON object instead of NDJSON frames).
   */
  override async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: normalizeMessages(options.messages),
      stream: false,
    };
    const tools = normalizeTools(options.tools);
    if (tools.length > 0) body.tools = tools;

    const response = await fetch(`${this.apiRoot(options.baseUrl)}/chat`, {
      method: "POST",
      headers: this.headers(options.apiKey),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    let payload: Record<string, unknown> | null = null;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      payload = null;
    }
    if (!response.ok || !payload) {
      throw new Error(
        `${this.metadata.label} error (${response.status}): ${await safeText(response)}`,
      );
    }
    if (typeof payload.error === "string") throw new Error(String(payload.error));

    const message = (payload.message as Record<string, unknown>) ?? {};
    const toolCalls: ToolCall[] = (openAiStyleToolCalls(message.tool_calls) ?? [])
      .filter((delta) => (delta.function?.name ?? "").length > 0)
      .map((delta) => ({
        id: delta.id ?? null,
        type: "function" as const,
        function: {
          name: delta.function?.name ?? "",
          arguments: delta.function?.arguments ?? "",
        },
      }));
    return {
      text: extractText(message.content),
      reasoning: extractText(message.thinking ?? message.reasoning ?? message.reasoning_content ?? ""),
      toolCalls,
      finishReason: payload.done === true ? ((payload.done_reason as string) ?? "stop") : null,
      usage: parseOllamaUsage(payload) ?? undefined,
    };
  }
}

function deltaFromEvent(event: Record<string, unknown>): StreamDelta {
  const message = (event.message as Record<string, unknown>) ?? {};
  const text = extractText(message.content);
  const reasoning = extractText(message.thinking ?? message.reasoning ?? message.reasoning_content ?? "");
  const toolCalls = openAiStyleToolCalls(message.tool_calls);
  const done = event.done === true;
  const finishReason = done ? ((event.done_reason as string) ?? "stop") : null;
  const usage = parseOllamaUsage(event);

  return {
    text: text || undefined,
    reasoning: reasoning || undefined,
    toolCalls,
    finishReason,
    usage: usage ?? undefined,
  };
}

/**
 * Best-effort usage mapping for Ollama's NDJSON `/api/chat` shape, which reports
 * `prompt_eval_count` / `eval_count` on the final (`done: true`) frame instead of an
 * OpenAI-style `usage` object. Returns null when nothing usable is present.
 */
function parseOllamaUsage(event: Record<string, unknown>): import("./types.js").UsageInfo | null {
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  // Prefer an OpenAI-style usage object when present (some gateways include one).
  const direct = event.usage;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    const r = direct as Record<string, unknown>;
    const prompt_tokens = num(r.prompt_tokens ?? r.prompt_eval_count);
    const completion_tokens = num(r.completion_tokens ?? r.eval_count);
    const total_tokens = num(r.total_tokens);
    if (prompt_tokens !== undefined || completion_tokens !== undefined || total_tokens !== undefined) {
      return { prompt_tokens, completion_tokens, total_tokens };
    }
  }
  const prompt_tokens = num(event.prompt_eval_count);
  const completion_tokens = num(event.eval_count);
  if (prompt_tokens === undefined && completion_tokens === undefined) return null;
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens:
      prompt_tokens !== undefined && completion_tokens !== undefined
        ? prompt_tokens + completion_tokens
        : undefined,
  };
}

/** Convert Ollama's tool-call objects into OpenAI-style streaming deltas. */
function openAiStyleToolCalls(raw: unknown): ToolCallDelta[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((tc, index) => {
    const func = (tc?.function as Record<string, unknown>) ?? {};
    const args = func.arguments;
    return {
      index,
      id: `call_${index}`,
      type: "function",
      function: {
        name: (func.name as string) ?? "",
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      },
    };
  });
}

/** Reshape OpenAI-style messages into the structure Ollama's /api/chat expects. */
function normalizeMessages(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    const role = msg.role as string;
    const entry: Record<string, unknown> = { role };
    if (msg.content !== undefined && msg.content !== null) entry.content = msg.content;

    if (role === "assistant" && Array.isArray(msg.tool_calls)) {
      entry.tool_calls = (msg.tool_calls as Array<Record<string, unknown>>).map((tc) => {
        const func = (tc.function as Record<string, unknown>) ?? {};
        let args: unknown = func.arguments ?? {};
        if (typeof args === "string") {
          args = tryParse(args) ?? {};
        }
        return { function: { name: (func.name as string) ?? "", arguments: args } };
      });
    } else if (role === "tool") {
      entry.tool_name = (msg.name as string) ?? "";
    }
    return entry;
  });
}

/** Strip OpenAI tool schemas down to what Ollama accepts. */
function normalizeTools(tools: unknown[]): Array<Record<string, unknown>> {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    const t = (tool as Record<string, unknown>) ?? {};
    const func = (t.function as Record<string, unknown>) ?? {};
    return {
      type: (t.type as string) ?? "function",
      function: {
        name: (func.name as string) ?? "",
        description: (func.description as string) ?? "",
        parameters: (func.parameters as Record<string, unknown>) ?? {},
      },
    };
  });
}

function extractText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          return String(record.text ?? record.content ?? "");
        }
        return String(item);
      })
      .join("");
  }
  return String(value);
}

function tryParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

export const ollamaCloudProvider = new OllamaCloudProvider({
  id: "ollama_cloud",
  label: "Ollama Cloud",
  defaultBaseUrl: "https://ollama.com/api/v1",
});
