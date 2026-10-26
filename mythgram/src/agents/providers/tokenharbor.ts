import { OpenAICompatibleProvider } from "./base.js";

/**
 * Token Harbor (https://tokenharbor.ai/docs) is an OpenAI-compatible gateway
 * ("one API for the world's leading AI models") exposing `chat/completions`
 * and a `models` catalog at `https://tokenharbor.ai/v1`. It authenticates with
 * a standard `Authorization: Bearer` key (keys look like `thk_live_...`).
 *
 * Its `/v1/models` endpoint returns the standard OpenAI `{ object: "list",
 * data: [...] }` catalog (401 without a key), so the base provider's parser
 * handles model discovery and SSE streaming as-is.
 *
 * Note: the bare `https://tokenharbor.ai` domain is the Anthropic
 * `/v1/messages` base URL — the OpenAI-compatible base URL must keep the
 * `/v1` suffix used here.
 */
export const tokenHarborProvider = new OpenAICompatibleProvider({
  id: "tokenharbor",
  label: "Token Harbor",
  defaultBaseUrl: "https://tokenharbor.ai/v1",
});
