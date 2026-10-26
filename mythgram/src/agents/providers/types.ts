/** A single streamed delta from the provider. */
export interface StreamDelta {
  text?: string;
  reasoning?: string;
  toolCalls?: ToolCallDelta[];
  finishReason?: string | null;
  /**
   * Token usage reported by the provider for the current request. OpenAI-compatible
   * providers attach `usage` to a stream chunk (usually the final one) when the
   * request asks for it via `stream_options: { include_usage: true }`. `prompt_tokens`
   * is the size of the current context for that request (system + history + tools) —
   * the most accurate current-context signal available, NOT a cumulative total.
   * Absent when the provider does not report usage.
   */
  usage?: UsageInfo;
}

/** Token usage for a single provider request (all fields optional — providers vary). */
export interface UsageInfo {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** Incremental tool-call fragment as emitted by OpenAI-style streaming. */
export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** Fully-formed tool call after merging deltas. */
export interface ToolCall {
  id: string | null;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** Accumulated result of one non-streaming chat completion (mirrors one streamed run). */
export interface ChatCompletionResult {
  /** Full answer text (may be empty when the model produced none). */
  text: string;
  /** Full reasoning text (may be empty; never used as answer content). */
  reasoning: string;
  /** Fully-formed tool calls requested by the model (empty when none). */
  toolCalls: ToolCall[];
  finishReason: string | null;
  /**
   * Token usage reported for the request, when the provider supplies it.
   * Absent when the provider does not report usage.
   */
  usage?: UsageInfo;
}

export interface ModelPricing {
  /** Price per 1M prompt tokens (in USD when known). Null when unknown. */
  prompt?: number | null;
  /** Price per 1M completion tokens (in USD when known). Null when unknown. */
  completion?: number | null;
  /** Currency of the prices above (defaults to "USD" when prices are present). */
  currency?: string | null;
  /** Unit the prices are quoted in (defaults to "1M tokens"). */
  unit?: string | null;
}

export interface ProviderModel {
  id: string;
  provider: string;
  label: string;
  owned_by?: string | null;
  context_window?: number | null;
  /** Max output/completion tokens when the provider advertises it. Null when unknown. */
  max_output_tokens?: number | null;
  /** Per-1M-token pricing when the provider advertises it. Null when unsupported. */
  pricing?: ModelPricing | null;
  /** Short human description when the provider supplies one. Null when unknown. */
  description?: string | null;
  /** Capability tags (e.g. "tools", "vision", "reasoning") when derivable. Null when unknown. */
  capabilities?: string[] | null;
}

export interface ProviderMetadata {
  id: string;
  label: string;
  defaultBaseUrl: string;
  /** Extra headers appended on every request (e.g. attribution headers). */
  extraHeaders?: Record<string, string>;
}

export interface ChatCompletionOptions {
  apiKey: string;
  model: string;
  messages: Array<Record<string, unknown>>;
  tools: unknown[];
  baseUrl?: string;
  /**
   * Sampling temperature forwarded to the provider. When omitted the provider
   * falls back to a sensible default. Models that don't support custom
   * temperatures simply ignore (or clamp) the value.
   */
  temperature?: number;
  /**
   * Reasoning effort: one of the presets (`low` | `medium` | `high` | `max`) or
   * a custom string the model understands. Applied as `reasoning_effort` (or the
   * provider's equivalent). Omitted/empty means "use the provider default", and
   * models without reasoning support ignore it.
   */
  effort?: string;
  signal?: AbortSignal;
}

/** Common interface implemented by every provider. */
export interface Provider {
  readonly metadata: ProviderMetadata;
  listModels(apiKey: string, baseUrl?: string): Promise<ProviderModel[]>;
  streamChatCompletion(options: ChatCompletionOptions): AsyncGenerator<StreamDelta, void, unknown>;
  /**
   * Non-streaming chat completion: one request, one accumulated result.
   *
   * Optional so older/custom providers that only implement streaming keep
   * working — callers must check for its presence and keep their streaming
   * behavior when it is absent. The base OpenAI-compatible provider implements
   * it (with a strict-server minimal-body retry); providers with a different
   * wire protocol override it (e.g. Ollama Cloud's `/api/chat`).
   */
  chatCompletion?(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
}
