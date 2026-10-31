import { OpenAICompatibleProvider } from "./base.js";
import type { ProviderModel } from "./types.js";

/**
 * xKiro AI (https://docs.xkiro.com/) is an OpenAI-compatible gateway exposing
 * `chat/completions` (and an Anthropic `messages` surface we don't use) at
 * `https://api.xkiro.com/v1`. Auth is a standard `Authorization: Bearer` token.
 *
 * Its `/models` endpoint returns the OpenAI `{ object: "list", data: [...] }` shape
 * but with a richer schema (`display_name`, `capabilities`, `context_length`,
 * `owned_by`). We override the parser to surface the friendly `display_name` as the
 * dropdown label while keeping the vendor-prefixed `id` (e.g. `openai/gpt-5.6-terra`)
 * as the value sent on chat requests.
 */
class XkiroProvider extends OpenAICompatibleProvider {
  override async listModels(apiKey: string, baseUrl?: string): Promise<ProviderModel[]> {
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
      const displayName = (item.display_name as string) || "";
      models.push({
        id,
        provider: this.metadata.id,
        label: displayName ? `${displayName} (${id})` : id,
        owned_by: (item.owned_by as string) || (item.provider as string) || null,
        context_window:
          (item.context_length as number) || (item.max_context_window as number) || null,
        max_output_tokens: null,
        pricing: null,
        description:
          typeof item.description === "string" && item.description.trim()
            ? (item.description as string).slice(0, 500)
            : null,
        capabilities: null,
      });
    }
    models.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    return models;
  }
}

export const xkiroProvider = new XkiroProvider({
  id: "xkiro",
  label: "xKiro AI",
  defaultBaseUrl: "https://api.xkiro.com/v1",
});

async function safeText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "<no body>";
  }
}
