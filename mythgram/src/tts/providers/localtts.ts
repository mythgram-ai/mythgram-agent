import type { TtsFetch } from "../client.js";
import type { TtsAudioResult, TtsModel, TtsSynthesizeOptions, TtsVoice } from "../types.js";
import { TtsProviderBase } from "./base.js";
import { formatFromContentType, stripTrailingSlash } from "./helpers.js";

/** Default base URL of a local-tts server's OpenAI-compatible API. */
export const LOCAL_TTS_DEFAULT_BASE_URL = "http://localhost:7878/v1";

/**
 * Local, self-hosted Piper TTS (`local-tts`).
 *
 * The server exposes an OpenAI-compatible `POST {base}/audio/speech` where the
 * only required field is `input`. Model, voice, speed and the other synthesis
 * settings are owned by local-tts (its web UI), so this adapter never sends
 * them — it deliberately keeps requests minimal. A base URL is all the user
 * needs; an API key is used only when encryption is enabled on the server.
 */
export interface LocalTtsConfig {
  id?: string;
  name?: string;
  baseUrl: string;
  headers?: Record<string, string>;
  fetchFn?: TtsFetch;
}

/** Accept a server root, a `/v1` base, or the full speech URL and return the `/v1` base. */
export function normalizeLocalTtsBaseUrl(value: string): string {
  const trimmed = stripTrailingSlash(value);
  if (!trimmed) return LOCAL_TTS_DEFAULT_BASE_URL;
  const withoutSpeech = trimmed.replace(/\/audio\/speech$/i, "");
  return /\/v1$/i.test(withoutSpeech) ? withoutSpeech : `${withoutSpeech}/v1`;
}

export class LocalTtsProvider extends TtsProviderBase {
  constructor(config: LocalTtsConfig) {
    super({
      kind: "localtts",
      name: (config.name ?? "").trim() || "Local TTS",
      baseUrl: normalizeLocalTtsBaseUrl(config.baseUrl),
      headers: sanitizeHeaders(config.headers),
      manualModels: [],
      manualVoices: [],
      defaultFormat: "wav",
      fetchFn: config.fetchFn,
    });
  }

  /** local-tts has no model catalog; the server owns the model. */
  async listModels(): Promise<TtsModel[]> {
    return [];
  }

  /** local-tts has no voice catalog endpoint; the server owns the voice. */
  async listVoices(): Promise<TtsVoice[]> {
    return [];
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    const base = normalizeLocalTtsBaseUrl(this.resolveBaseUrl(options.baseUrl));
    const headers = this.withRuntimeHeaders({ "Content-Type": "application/json" });
    const key = (options.apiKey ?? "").trim();
    if (key) headers.Authorization = `Bearer ${key}`;

    // Only `input` (and optionally the output container) is sent on purpose.
    const body: Record<string, unknown> = { input: options.input };
    const format = (options.responseFormat ?? "").trim().toLowerCase();
    if (format) body.response_format = format;

    const { bytes, contentType, headers: responseHeaders } = await this.fetchAudio(
      `${base}/audio/speech`,
      { method: "POST", headers, body: JSON.stringify(body) },
      { signal: options.signal },
    );

    return {
      bytes,
      contentType,
      format: formatFromContentType(contentType, format || "wav"),
      model: responseHeaders.get("x-model") ?? "",
    };
  }
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [key, value] of Object.entries(headers)) {
    const k = (key ?? "").trim();
    if (!k || k.toLowerCase().startsWith("content-type")) continue;
    out[k] = String(value ?? "");
  }
  return out;
}