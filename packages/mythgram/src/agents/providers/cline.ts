import { OpenAICompatibleProvider } from "./base.js";
import type { StreamDelta } from "./types.js";

/**
 * Cline (https://cline.bot, API docs: https://docs.cline.bot) is an OpenAI-compatible
 * gateway to frontier models (Claude, GPT, Gemini, DeepSeek, ...) following the same
 * `provider/model-name` ID convention as OpenRouter.
 *
 * - Auth: `Authorization: Bearer <api-key>` (keys are created in app.cline.bot
 *   Settings > API Keys). The API also documents optional `HTTP-Referer` and
 *   `X-Title` attribution headers, which we send like other gateways.
 * - Endpoints: `POST /api/v1/chat/completions` (SSE streaming by default) and
 *   `GET /api/v1/models` (standard `{ object: "list", data: [...] }` catalog).
 * - Streaming: chunks may end with a mid-stream error carrying
 *   `finish_reason: "error"` plus a structured `error` object instead of a 5xx
 *   status (the SSE response has already committed to HTTP 200). We surface
 *   that as a thrown error so the agent loop treats it like any other failure.
 */
class ClineProvider extends OpenAICompatibleProvider {
  protected override parseChunk(event: Record<string, unknown>): StreamDelta | null {
    const delta = super.parseChunk(event);
    const midStreamError = extractMidStreamError(event);
    if (!midStreamError) return delta;
    // Preserve any partial delta content emitted before the failure, then
    // fail the stream with the API's error message.
    throw new Error(`Cline API error: ${midStreamError}`);
  }
}

/** Pull the structured error out of an SSE chunk with `finish_reason: "error"`. */
function extractMidStreamError(event: Record<string, unknown>): string | null {
  if (event.error) {
    const error = event.error as Record<string, unknown>;
    const message = typeof error.message === "string" ? error.message : "";
    const code = error.code != null ? String(error.code) : "unknown";
    return message || `code ${code}`;
  }
  const choices = event.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0] ?? undefined;
  const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
  if (finishReason !== "error") return null;
  const error = choice?.error as Record<string, unknown> | undefined;
  if (error) {
    const message = typeof error.message === "string" ? error.message : "";
    const code = error.code != null ? String(error.code) : "unknown";
    return message || `code ${code}`;
  }
  return "unknown mid-stream error";
}

export const clineProvider = new ClineProvider({
  id: "cline",
  label: "Cline",
  defaultBaseUrl: "https://api.cline.bot/api/v1",
  extraHeaders: {
    "X-Title": "Mythgram AI",
    "HTTP-Referer": "https://mythgram.ai",
  },
});