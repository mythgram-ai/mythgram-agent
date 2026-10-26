import { OpenAICompatibleProvider } from "./base.js";
import { openRouterEffort } from "./reasoning.js";
import type { ChatCompletionOptions } from "./types.js";

/**
 * OpenRouter is OpenAI-compatible but exposes reasoning through its own unified
 * `reasoning: { effort }` object (rather than the flat `reasoning_effort` field),
 * which it normalizes across every upstream model. We override the body builder
 * to use that shape; models without reasoning support ignore it.
 */
class OpenRouterProvider extends OpenAICompatibleProvider {
  protected override buildRequestBody(options: ChatCompletionOptions): Record<string, unknown> {
    const body = super.buildRequestBody(options);
    // Base set the flat field; replace it with OpenRouter's canonical object.
    delete body.reasoning_effort;
    const reasoning = openRouterEffort(options.effort);
    if (reasoning) body.reasoning = reasoning;
    return body;
  }
}

export const openRouterProvider = new OpenRouterProvider({
  id: "openrouter",
  label: "OpenRouter",
  defaultBaseUrl: "https://openrouter.ai/api/v1",
  extraHeaders: {
    "X-Title": "Mythgram AI",
    "HTTP-Referer": "https://mythgram.ai",
  },
});
