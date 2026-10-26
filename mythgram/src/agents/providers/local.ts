import { OpenAICompatibleProvider } from "./base.js";
import type {
  ChatCompletionOptions,
  ProviderModel,
} from "./types.js";

/**
 * Local running models (Ollama, LM Studio, or any OpenAI-compatible server on
 * the user's own computer).
 *
 * The user points this provider at a local server URL — e.g. Ollama's
 * `http://localhost:11434/v1` or LM Studio's `http://localhost:1234/v1` — and
 * the agent talks to whatever model is running there. Both live LAN addresses
 * (e.g. `http://192.168.1.10:1234/v1`) and localhost URLs are supported; the
 * request is made server-side by the backend, so `localhost` correctly means
 * the user's own computer.
 *
 * Differences from a generic OpenAI-compatible provider:
 *  - Authentication is OPTIONAL. Local servers usually need no API key, so the
 *    `Authorization` header is omitted entirely when the key is empty.
 *  - Model discovery works WITHOUT a key (`GET <base>/models` with no auth).
 *  - A bare host (`http://localhost:11434`) is normalized to its OpenAI
 *    endpoint (`http://localhost:11434/v1`); explicit paths are kept verbatim.
 *  - `reasoning_effort` is stripped: local servers commonly reject unknown
 *    fields with a 400, and local models rarely implement reasoning tiers.
 */

/** Stable id of the local-models provider (mirrored by the frontend). */
export const LOCAL_PROVIDER_ID = "local";

/** Default base URLs offered in the UI. */
export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";
export const LMSTUDIO_DEFAULT_BASE_URL = "http://localhost:1234/v1";

/** Whether a provider id refers to the local-models provider. */
export function isLocalProviderId(id: string | undefined): boolean {
  return id === LOCAL_PROVIDER_ID;
}

/**
 * Normalize a user-supplied local base URL. A bare host (no path) gains the
 * OpenAI `/v1` suffix both Ollama and LM Studio serve; any explicit path —
 * including an existing `/v1` — is kept verbatim.
 */
export function normalizeLocalBaseUrl(raw: string | undefined, fallback: string): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  const candidate = trimmed.length > 0 ? trimmed : fallback;
  try {
    const url = new URL(candidate);
    if (url.pathname === "" || url.pathname === "/") {
      return `${candidate}/v1`;
    }
    return candidate;
  } catch {
    return candidate;
  }
}

class LocalModelsProvider extends OpenAICompatibleProvider {
  protected override baseUrl(override?: string): string {
    return normalizeLocalBaseUrl(override, this.metadata.defaultBaseUrl);
  }

  /**
   * Local servers usually need no key: omit `Authorization` when none was
   * given instead of sending an empty `Bearer` token.
   */
  protected override headers(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.metadata.extraHeaders ?? {}),
    };
    const key = (apiKey ?? "").trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  protected override buildRequestBody(
    options: ChatCompletionOptions,
  ): Record<string, unknown> {
    const body = super.buildRequestBody(options);
    // Local servers (Ollama, LM Studio) commonly answer 400 to fields they do
    // not know; reasoning tiers are a cloud-gateway concept, so drop it here.
    delete body.reasoning_effort;
    return body;
  }

  override async listModels(apiKey: string, baseUrl?: string): Promise<ProviderModel[]> {
    try {
      return await super.listModels(apiKey, baseUrl);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${this.metadata.label}: could not reach the local model server at ${this.baseUrl(baseUrl)}. ` +
          `Is a model server running there (Ollama \`ollama serve\`, or LM Studio with the local server started)? ` +
          `Details: ${detail}`,
      );
    }
  }
}

export const localProvider = new LocalModelsProvider({
  id: LOCAL_PROVIDER_ID,
  label: "Local Models",
  defaultBaseUrl: OLLAMA_DEFAULT_BASE_URL,
});
