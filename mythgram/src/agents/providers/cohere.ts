import { OpenAICompatibleProvider } from "./base.js";
import { applyReasoningEffort } from "./reasoning.js";
import type { ChatCompletionOptions, ProviderModel } from "./types.js";

/**
 * Cohere exposes an OpenAI-compatible surface at `/compatibility/v1`, but its
 * `/models` endpoint can 404 (or return an unexpected shape) and it rejects the
 * `parallel_tool_calls` field. We fall back to a curated model list and trim the body.
 */
class CohereProvider extends OpenAICompatibleProvider {
  override async listModels(apiKey: string, baseUrl?: string): Promise<ProviderModel[]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl(baseUrl)}/models`, {
        method: "GET",
        headers: this.headers(apiKey),
      });
    } catch {
      return this.fallbackModels();
    }

    if (response.status === 404 || !response.ok) {
      return this.fallbackModels();
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return this.fallbackModels();
    }

    const items: Array<Record<string, unknown>> = Array.isArray(payload)
      ? (payload as Array<Record<string, unknown>>)
      : (((payload as Record<string, unknown>)?.data as Array<Record<string, unknown>>) ?? []);
    if (!Array.isArray(items) || items.length === 0) {
      return this.fallbackModels();
    }

    const models: ProviderModel[] = [];
    for (const item of items) {
      const id = (item.id as string) || (item.name as string);
      if (!id) continue;
      models.push({
        id,
        provider: this.metadata.id,
        label: id,
        owned_by: (item.owned_by as string) || (item.provider as string) || null,
        context_window:
          (item.context_length as number) || (item.max_context_window as number) || null,
        max_output_tokens: null,
        pricing: null,
        description: null,
        capabilities: null,
      });
    }
    if (models.length === 0) return this.fallbackModels();
    models.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    return models;
  }

  protected override buildRequestBody(options: ChatCompletionOptions): Record<string, unknown> {
    const hasTools = Array.isArray(options.tools) && options.tools.length > 0;
    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      ...(hasTools ? { tools: options.tools, tool_choice: "auto" } : {}),
      temperature: options.temperature ?? 0.2,
      stream: true,
      // Same usage request as the base provider (see base.ts): providers that do not
      // understand this field ignore it; missing usage is treated as unavailable.
      stream_options: { include_usage: true },
    };
    return applyReasoningEffort(body, options.effort);
  }

  private fallbackModels(): ProviderModel[] {
    const ids = [
      "command-a-plus-05-2026",
      "command-r7b-03-2026",
      "command-r-plus-05-2026",
      "command-r-05-2026",
      "command-a-powerful",
    ];
    return ids.map((id) => ({
      id,
      provider: this.metadata.id,
      label: id,
      owned_by: "cohere",
      context_window: null,
      max_output_tokens: null,
      pricing: null,
      description: null,
      capabilities: null,
    }));
  }
}

export const cohereProvider = new CohereProvider({
  id: "cohere",
  label: "Cohere",
  defaultBaseUrl: "https://api.cohere.ai/compatibility/v1",
});
