import { OpenAICompatibleProvider } from "./base.js";

/**
 * CodeCraft API (https://codecraftapi.com/docs) is an OpenAI-compatible
 * gateway exposing `chat/completions`, `embeddings`, and a `models` catalog
 * at `https://codecraftapi.com/v1`. It authenticates with a standard
 * `Authorization: Bearer` key (keys look like `cc_` + 48 chars, `models:read`
 * scope required for listing models).
 *
 * Its `/models` endpoint returns the active public models (id,
 * context_window, capabilities like `tools`/`vision`/`reasoning`/`streaming`),
 * so the base provider's parser handles model discovery and SSE streaming
 * (including tool calling and vision) as-is.
 */
export const codeCraftApiProvider = new OpenAICompatibleProvider({
  id: "codecraftapi",
  label: "CodeCraft API",
  defaultBaseUrl: "https://codecraftapi.com/v1",
});
