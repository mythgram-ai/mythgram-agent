import type { Provider, ToolCall, ToolCallDelta } from "../providers/types.js";

/**
 * Dedicated summary-agent execution.
 *
 * Sole responsibility: produce the final summary text. No tools are advertised,
 * so the agent cannot continue the main task or execute main-agent tools.
 *
 * Completion guarantee: success requires a finished provider call AND a
 * validated non-empty final text to exist. Stream close, chunk arrival, or a
 * terminal finishReason alone never implies success — the accumulated text is
 * validated by the caller before SUMMARY_VALIDATED.
 *
 * Provider compatibility: the summary runs against EVERY configured provider,
 * not just OpenAI-native ones. Streaming SSE is attempted first; when the
 * stream throws (e.g. a strict server rejecting streaming-only fields with
 * HTTP 400) or yields no usable text at all (e.g. a non-SSE transport), the
 * runner falls back exactly once to the provider's non-streaming completion.
 * Explicit abort and provider errors resolve as failure/incomplete, never
 * success.
 *
 * No timeouts, no retry loops, no artificial limits.
 */

export interface SummaryRunRequest {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  effort?: string;
  systemPrompt: string;
  userMessage: string;
  signal?: AbortSignal;
  /** Emit streaming progress (chunks in order). Never used for completion. */
  send?: (event: string, data: Record<string, unknown>) => void;
}

export interface SummaryRunOutcome {
  /** True only when the call finished with non-empty accumulated text. */
  streamOk: boolean;
  aborted: boolean;
  /** Accumulated final text (may be empty on failure). */
  text: string;
  finishReason: string | null;
  error?: string;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Error reported when the model requests tools despite none being advertised. */
const TOOL_CALLS_ERROR =
  "Summary agent attempted tool calls; no tools are permitted for summarization.";

interface AttemptOutcome {
  text: string;
  finishReason: string | null;
  sawToolCalls: boolean;
  aborted: boolean;
  /** True only when the call ran to completion (no throw, no abort). */
  finished: boolean;
  error?: string;
}

export async function runSummaryAgent(request: SummaryRunRequest): Promise<SummaryRunOutcome> {
  const streaming = await attemptStreaming(request);
  if (streaming.aborted) {
    return {
      streamOk: false,
      aborted: true,
      text: streaming.text,
      finishReason: streaming.finishReason,
    };
  }
  if (streaming.finished) {
    // A model requesting tools despite none being advertised cannot yield a
    // valid summary — report incomplete, never success. This is model
    // behavior, not transport, so no fallback applies.
    if (streaming.sawToolCalls) {
      return {
        streamOk: false,
        aborted: false,
        text: streaming.text,
        finishReason: streaming.finishReason,
        error: TOOL_CALLS_ERROR,
      };
    }
    if (streaming.text.length > 0) {
      return { streamOk: true, aborted: false, text: streaming.text, finishReason: streaming.finishReason };
    }
  }

  // The stream threw or finished without any usable text: the server may not
  // speak streaming SSE at all. Fall back once to a plain non-streaming
  // completion before reporting failure.
  if (request.signal?.aborted) {
    return {
      streamOk: false,
      aborted: true,
      text: streaming.text,
      finishReason: streaming.finishReason,
    };
  }
  const fallback = await attemptNonStreaming(request);
  if (!fallback) {
    // No non-streaming path available: preserve the streaming outcome
    // verbatim — a throw stays a failure, an empty finish stays an empty
    // result (which the caller reports as an empty summary).
    if (!streaming.finished) {
      return {
        streamOk: false,
        aborted: false,
        text: streaming.text,
        finishReason: streaming.finishReason,
        error: streaming.error,
      };
    }
    return { streamOk: true, aborted: false, text: streaming.text, finishReason: streaming.finishReason };
  }
  if (fallback.aborted) {
    return {
      streamOk: false,
      aborted: true,
      text: streaming.text,
      finishReason: fallback.finishReason ?? streaming.finishReason,
    };
  }
  if (fallback.sawToolCalls) {
    return {
      streamOk: false,
      aborted: false,
      text: fallback.text,
      finishReason: fallback.finishReason,
      error: TOOL_CALLS_ERROR,
    };
  }
  if (fallback.text.length > 0) {
    return { streamOk: true, aborted: false, text: fallback.text, finishReason: fallback.finishReason };
  }
  return {
    streamOk: false,
    aborted: false,
    text: streaming.text,
    finishReason: fallback.finishReason ?? streaming.finishReason,
    error:
      fallback.error ??
      streaming.error ??
      "Summary produced no text. Original context is preserved.",
  };
}

async function attemptStreaming(request: SummaryRunRequest): Promise<AttemptOutcome> {
  const answerParts: string[] = [];
  let finishReason: string | null = null;
  let sawToolCalls = false;

  try {
    const stream = request.provider.streamChatCompletion({
      apiKey: request.apiKey,
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userMessage },
      ],
      tools: [],
      baseUrl: request.baseUrl,
      temperature: request.temperature,
      effort: request.effort,
      signal: request.signal,
    });

    // Accumulate chunks strictly in arrival order. Reasoning deltas are
    // intentionally dropped (hidden chain-of-thought must never leak).
    const pendingToolDeltas: ToolCallDelta[] = [];
    for await (const delta of stream) {
      if (delta.text) {
        const cleaned = normalize(delta.text);
        answerParts.push(cleaned);
        request.send?.("summary_chunk", { value: cleaned });
      }
      if (delta.toolCalls && delta.toolCalls.length > 0) {
        sawToolCalls = true;
        pendingToolDeltas.push(...delta.toolCalls);
      }
      if (delta.finishReason) finishReason = delta.finishReason;
    }

    void pendingToolDeltas;

    if (request.signal?.aborted) {
      return { text: answerParts.join(""), finishReason, sawToolCalls, aborted: true, finished: false };
    }
    return { text: answerParts.join(""), finishReason, sawToolCalls, aborted: false, finished: true };
  } catch (error) {
    if (request.signal?.aborted) {
      return { text: answerParts.join(""), finishReason, sawToolCalls, aborted: true, finished: false };
    }
    return {
      text: answerParts.join(""),
      finishReason,
      sawToolCalls,
      aborted: false,
      finished: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * One non-streaming completion attempt. Returns null when the provider has no
 * non-streaming path, so legacy providers keep their exact previous behavior.
 * The full text is forwarded as a single progress chunk so live UI updates
 * keep working; completion is still decided by the caller via validation.
 */
async function attemptNonStreaming(request: SummaryRunRequest): Promise<AttemptOutcome | null> {
  const complete = request.provider.chatCompletion;
  if (typeof complete !== "function") return null;

  try {
    const result = await complete.call(request.provider, {
      apiKey: request.apiKey,
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userMessage },
      ],
      tools: [],
      baseUrl: request.baseUrl,
      temperature: request.temperature,
      effort: request.effort,
      signal: request.signal,
    });
    if (request.signal?.aborted) {
      return { text: "", finishReason: result.finishReason, sawToolCalls: false, aborted: true, finished: false };
    }
    const text = normalize(result.text);
    if (text.length > 0) request.send?.("summary_chunk", { value: text });
    return {
      text,
      finishReason: result.finishReason,
      sawToolCalls: hasNamedToolCalls(result.toolCalls),
      aborted: false,
      finished: true,
    };
  } catch (error) {
    if (request.signal?.aborted) {
      return { text: "", finishReason: null, sawToolCalls: false, aborted: true, finished: false };
    }
    return {
      text: "",
      finishReason: null,
      sawToolCalls: false,
      aborted: false,
      finished: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function hasNamedToolCalls(toolCalls: ToolCall[]): boolean {
  return toolCalls.some((c) => c.function.name.trim().length > 0);
}
