import { OpenAICompatibleProvider } from "./base.js";

/**
 * APInex (https://apinex.bond/developers) is an OpenAI-compatible gateway ("one API for
 * every model") exposing `chat/completions`, `models`, and a `messages` surface (we only
 * use the OpenAI one) at `https://api.apinex.bond/v1`. It authenticates with a standard
 * `Authorization: Bearer` token (it also accepts `x-api-key`).
 *
 * Its `/models` endpoint returns the standard OpenAI `{ object: "list", data: [...] }`
 * catalog, so the base provider's parser handles model discovery and streaming as-is.
 */
export const apinexProvider = new OpenAICompatibleProvider({
  id: "apinex",
  label: "APInex",
  defaultBaseUrl: "https://api.apinex.bond/v1",
});
