import { OpenAICompatibleProvider } from "./base.js";

/**
 * Command Code Provider (https://commandcode.ai/docs/provider#quickstart) is
 * an OpenAI-compatible gateway ("every top model, one API") exposing
 * `chat/completions`, `responses`, `messages`, and a `models` catalog at
 * `https://api.commandcode.ai/provider/v1`. It authenticates with a standard
 * `Authorization: Bearer` key (the same key as the Command Code CLI).
 *
 * Its `/models` endpoint returns the live catalog (ids, names, context
 * windows, routes, `supported_endpoints`), so the base provider handles model
 * discovery and SSE streaming as-is.
 *
 * Note: OpenAI and open models answer on `/chat/completions`, while Claude
 * models answer on `/messages` only — sending a Claude model to
 * `/chat/completions` returns a 400 pointing at `/messages`.
 */
export const commandCodeProvider = new OpenAICompatibleProvider({
  id: "commandcode",
  label: "Command Code",
  defaultBaseUrl: "https://api.commandcode.ai/provider/v1",
});
