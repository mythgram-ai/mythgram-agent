import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  Provider,
  ProviderMetadata,
  ProviderModel,
  StreamDelta,
  ToolCall,
} from "./types.js";
import { applyReasoningEffort } from "./reasoning.js";

/** HTTP error carrying the response status so callers can branch on it (e.g. strict-server 400s). */
class ChatCompletionHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ChatCompletionHttpError";
    this.status = status;
  }
}

/**
 * Base implementation of an OpenAI-compatible provider (chat/completions + models endpoints
 * with SSE streaming and native tool calling). New providers extend this with just metadata.
 */
export class OpenAICompatibleProvider implements Provider {
  readonly metadata: ProviderMetadata;

  constructor(metadata: ProviderMetadata) {
    this.metadata = metadata;
  }

  protected baseUrl(override?: string): string {
    return (override || this.metadata.defaultBaseUrl).replace(/\/+$/, "");
  }

  protected headers(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(this.metadata.extraHeaders ?? {}),
    };
  }

  async listModels(apiKey: string, baseUrl?: string): Promise<ProviderModel[]> {
    const response = await fetch(`${this.baseUrl(baseUrl)}/models`, {
      method: "GET",
      headers: this.headers(apiKey),
    });
    if (!response.ok) {
      throw new Error(`${this.metadata.label} models error ${response.status}: ${await safeText(response)}`);
    }
    const payload = (await response.json()) as unknown;
    const items: Array<Record<string, unknown>> = Array.isArray(payload)
      ? (payload as Array<Record<string, unknown>>)
      : (((payload as Record<string, unknown>)?.data as Array<Record<string, unknown>>) ?? []);

    const models: ProviderModel[] = [];
    for (const item of items) {
      const id = (item.id as string) || (item.name as string);
      if (!id) continue;
      const topProvider = item.top_provider as Record<string, unknown> | undefined;
      const architecture = item.architecture as Record<string, unknown> | undefined;
      models.push({
        id,
        provider: this.metadata.id,
        label: id,
        owned_by:
          (item.owned_by as string) ||
          (item.provider as string) ||
          (architecture?.tokenizer as string) ||
          null,
        context_window: numOrNull(
          item.context_length ??
            item.context_window ??
            topProvider?.context_length ??
            item.max_context_window ??
            item.max_context_length,
        ),
        max_output_tokens: numOrNull(
          item.max_completion_tokens ??
            item.max_output_tokens ??
            item.max_tokens ??
            topProvider?.max_completion_tokens,
        ),
        pricing: pricingOrNull(item.pricing ?? item.price ?? null),
        description: strOrNull(item.description ?? item.human_description ?? null),
        capabilities: capabilitiesOrNull(item),
      });
    }
    models.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    return models;
  }

  /**
   * Build the JSON body for the chat/completions request. Subclasses override this
   * to tweak the payload (e.g. providers that reject `parallel_tool_calls`).
   */
  protected buildRequestBody(options: ChatCompletionOptions): Record<string, unknown> {
    const hasTools = Array.isArray(options.tools) && options.tools.length > 0;
    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      ...(hasTools ? { tools: options.tools, tool_choice: "auto", parallel_tool_calls: false } : {}),
      temperature: options.temperature ?? 0.2,
      stream: true,
      // Ask the provider to attach per-request token usage to the stream (usually on the
      // final chunk). Providers that do not understand this field ignore it; the agent
      // treats a missing `usage` payload as "unavailable", never as zero.
      stream_options: { include_usage: true },
    };
    return applyReasoningEffort(body, options.effort);
  }

  async *streamChatCompletion(options: ChatCompletionOptions): AsyncGenerator<StreamDelta, void, unknown> {
    const body = this.buildRequestBody(options);

    const response = await fetch(`${this.baseUrl(options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: this.headers(options.apiKey),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `${this.metadata.label} API error ${response.status}: ${await safeText(response)}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let separatorIndex: number;
        while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);

          const dataLines: string[] = [];
          for (const line of rawEvent.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (trimmed.startsWith("data:")) dataLines.push(trimmed.slice(5).trim());
          }
          if (dataLines.length === 0) continue;

          const data = dataLines.join("\n");
          if (data === "[DONE]") return;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          const delta = this.parseChunk(parsed);
          if (delta) yield delta;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  protected parseChunk(event: Record<string, unknown>): StreamDelta | null {
    const choices = event.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0] ?? {};
    const delta = (choice.delta as Record<string, unknown>) ?? {};
    // Some OpenAI-compatible servers emit full `message` objects per chunk
    // instead of `delta` fragments — accept either shape.
    const message = (choice.message as Record<string, unknown>) ?? {};
    const finishReason =
      (choice.finish_reason as string) ?? (choice.finishReason as string) ?? null;

    const text =
      extractText(delta.content) || extractText(message.content) || anthropicTextDelta(event);
    const reasoning = extractText(
      delta.reasoning ??
        delta.reasoning_content ??
        delta.reason ??
        message.reasoning ??
        message.reasoning_content ??
        "",
    );
    const toolCalls =
      (delta.tool_calls as StreamDelta["toolCalls"]) ??
      (message.tool_calls as StreamDelta["toolCalls"]) ??
      undefined;
    const usage = parseUsage(event.usage);

    if (!text && !reasoning && !toolCalls && !finishReason && !usage) return null;
    return {
      text: text || undefined,
      reasoning: reasoning || undefined,
      toolCalls,
      finishReason,
      usage: usage ?? undefined,
    };
  }

  /**
   * Non-streaming chat completion: one request, one accumulated result.
   *
   * This is the compatibility path for servers where SSE streaming fails or
   * yields nothing usable (strict field validation, non-SSE transports,
   * already-consumed streams). The first attempt reuses the subclass request
   * body minus the streaming-only fields; when a strict server answers HTTP
   * 400 (e.g. it rejects `reasoning_effort` or other extras that OpenAI
   * accepts), it retries once with a truly minimal body.
   */
  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const full = this.buildRequestBody(options);
    const { stream: _stream, stream_options: _streamOptions, ...nonStreaming } = full;
    try {
      return await this.postChatCompletion(options, nonStreaming);
    } catch (error) {
      if (!(error instanceof ChatCompletionHttpError) || error.status !== 400) throw error;
      return await this.postChatCompletion(options, minimalBody(options));
    }
  }

  private async postChatCompletion(
    options: ChatCompletionOptions,
    body: Record<string, unknown>,
  ): Promise<ChatCompletionResult> {
    const response = await fetch(`${this.baseUrl(options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: this.headers(options.apiKey),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new ChatCompletionHttpError(
        response.status,
        `${this.metadata.label} API error ${response.status}: ${await safeText(response)}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${this.metadata.label} returned a non-JSON chat response.`);
    }
    return this.parseChatCompletion(payload);
  }

  /**
   * Parse a non-streaming `chat/completions` payload. Tolerates the same shape
   * variance as the streaming parser (message content as string or parts,
   * reasoning fields, object or string tool arguments). Provider-level errors
   * surfaced with HTTP 200 throw instead of resolving to an empty result.
   */
  protected parseChatCompletion(payload: unknown): ChatCompletionResult {
    const root =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const failure = errorMessageOf(root.error);
    if (failure) {
      throw new Error(`${this.metadata.label} API error: ${failure}`);
    }
    const choices = root.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0] ?? {};
    const message = (choice.message as Record<string, unknown>) ?? {};
    const usage = parseUsage(root.usage);
    return {
      text: extractText(message.content),
      reasoning: extractText(message.reasoning ?? message.reasoning_content ?? message.reason ?? ""),
      toolCalls: completeToolCalls(message.tool_calls),
      finishReason: (choice.finish_reason as string) ?? (choice.finishReason as string) ?? null,
      ...(usage ? { usage } : {}),
    };
  }
}

/**
 * Minimal request body for the strict-server retry: only fields every
 * OpenAI-compatible server understands. Deliberately omits `stream_options`,
 * `reasoning_effort`, and `parallel_tool_calls`, which strict servers reject
 * with HTTP 400 while OpenAI/GPT endpoints accept them.
 */
function minimalBody(options: ChatCompletionOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
  };
  if (Array.isArray(options.tools) && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }
  if (options.temperature !== undefined) body.temperature = options.temperature;
  return body;
}

/**
 * Text from an Anthropic-style SSE passthrough (`content_block_delta` with a
 * `text_delta`) when no OpenAI `choices` are present. Returns "" for genuine
 * OpenAI shapes so the standard path always wins.
 */
function anthropicTextDelta(event: Record<string, unknown>): string {
  if (event.choices !== undefined) return "";
  const type = typeof event.type === "string" ? event.type : "";
  if (!type.includes("delta")) return "";
  const delta = event.delta;
  if (typeof delta === "string") return delta;
  if (delta && typeof delta === "object") {
    const text = (delta as Record<string, unknown>).text;
    if (typeof text === "string") return text;
  }
  return "";
}

/** Normalize a non-streaming `tool_calls` array into fully-formed tool calls. */
function completeToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const fn = (record.function as Record<string, unknown>) ?? {};
    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name) continue;
    const args = fn.arguments;
    out.push({
      id: typeof record.id === "string" ? record.id : null,
      type: "function",
      function: {
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      },
    });
  }
  return out;
}

/** Best-effort message extraction from a provider error payload. */
function errorMessageOf(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim().slice(0, 500);
    return trimmed.length > 0 ? trimmed : null;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "msg"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim().slice(0, 500);
      }
    }
  }
  return null;
}

/**
 * Extract per-request token usage from a stream chunk's top-level `usage` object.
 * Accepts OpenAI-style `prompt_tokens` / `completion_tokens` / `total_tokens` (numbers
 * or numeric strings). Returns null when nothing usable is present so callers treat
 * the usage as unavailable rather than zero. Never throws on malformed payloads.
 */
function parseUsage(raw: unknown): import("./types.js").UsageInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  const prompt_tokens = num(r.prompt_tokens);
  const completion_tokens = num(r.completion_tokens);
  const total_tokens = num(r.total_tokens);
  if (prompt_tokens === undefined && completion_tokens === undefined && total_tokens === undefined) {
    return null;
  }
  return { prompt_tokens, completion_tokens, total_tokens };
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

async function safeText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "<no body>";
  }
}

function numOrNull(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function strOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : null;
}

function priceNum(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

/**
 * Normalize provider pricing into per-1M-token USD numbers when the provider
 * advertises it (OpenRouter-style `{ prompt, completion }` strings). Returns
 * null when the provider does not expose pricing, so callers leave it empty
 * and keep working normally.
 */
function pricingOrNull(raw: unknown): import("./types.js").ModelPricing | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const prompt = priceNum(r.prompt ?? r.prompt_tokens ?? r.input ?? r.input_price);
  const completion = priceNum(
    r.completion ?? r.completion_tokens ?? r.output ?? r.output_price,
  );
  if (prompt === null && completion === null) return null;
  return { prompt, completion, currency: "USD", unit: "1M tokens" };
}

/**
 * Derive capability tags from common provider shapes without ever throwing.
 * Covers OpenRouter-style `architecture.modality` + `supported_parameters`,
 * plus generic `capabilities` / `modalities` arrays. Unknown shapes yield null.
 */
function capabilitiesOrNull(item: Record<string, unknown>): string[] | null {
  const out = new Set<string>();
  try {
    const arch = item.architecture as Record<string, unknown> | undefined;
    const modality = typeof arch?.modality === "string" ? arch.modality.toLowerCase() : "";
    if (modality.includes("image")) out.add("vision");
    if (modality.includes("audio")) out.add("audio");
    if (modality.includes("video")) out.add("video");
    const params = arch?.supported_parameters;
    if (Array.isArray(params)) {
      const lowered = params.map((p) => String(p).toLowerCase());
      if (lowered.includes("tools") || lowered.includes("tool_choice")) out.add("tools");
      if (lowered.includes("reasoning") || lowered.includes("reasoning_effort") || lowered.includes("thinking")) out.add("reasoning");
      if (lowered.includes("response_format") || lowered.includes("structured_outputs")) out.add("structured-output");
    }
    const caps = item.capabilities ?? item.modalities;
    if (Array.isArray(caps)) {
      for (const c of caps) {
        const s = String(c).toLowerCase().trim();
        if (s) out.add(s.slice(0, 32));
      }
    }
    if (typeof item.supports_tools === "boolean" && item.supports_tools) out.add("tools");
    if (typeof item.supports_vision === "boolean" && item.supports_vision) out.add("vision");
  } catch {
    return null;
  }
  return out.size > 0 ? Array.from(out).sort() : null;
}
