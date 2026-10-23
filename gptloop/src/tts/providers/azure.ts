import { TtsProviderBase, type TtsProviderRuntime } from "./base.js";
import { asRecord, escapeXml, pickString } from "./helpers.js";
import type { TtsAudioResult, TtsListOptions, TtsModel, TtsSynthesizeOptions, TtsVoice } from "../types.js";

/** Default Azure region endpoint (the region lives in the host — override the base URL to change it). */
export const AZURE_TTS_BASE_URL = "https://eastus.tts.speech.microsoft.com";

/** Map an engine format to an Azure `X-Microsoft-OutputFormat` value. */
function azureOutputFormat(format: string | undefined, fallback: string): string {
  switch ((format || fallback || "mp3").trim().toLowerCase()) {
    case "wav":
      return "riff-24khz-16bit-mono-pcm";
    case "pcm":
      return "raw-24khz-16bit-mono-pcm";
    case "opus":
    case "ogg":
      return "ogg-24khz-16bit-mono-opus";
    default:
      return "audio-24khz-48kbitrate-mono-mp3";
  }
}

/** Reverse-map an Azure output format to a container format. */
function formatFromAzureOutput(output: string): string {
  if (output.includes("mp3")) return "mp3";
  if (output.includes("opus")) return "opus";
  if (output.includes("riff") || output.includes("wav")) return "wav";
  if (output.includes("raw") || output.includes("pcm")) return "pcm";
  return "mp3";
}

/** Derive a BCP-47 locale from an Azure voice short name (e.g. en-US-JennyNeural -> en-US). */
function localeFromVoice(voice: string): string {
  const parts = voice.split("-");
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : "";
}

/**
 * Azure AI Speech (Neural TTS).
 *
 *   POST {base}/cognitiveservices/v1               — SSML in, raw audio bytes out
 *   GET  {base}/cognitiveservices/voices/list      — voice catalog
 *
 * Auth uses the `Ocp-Apim-Subscription-Key` header. The region is part of the
 * base URL host (e.g. https://eastus.tts.speech.microsoft.com).
 *
 * Docs: https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
 */
export class AzureTtsProvider extends TtsProviderBase {
  constructor(runtime: Partial<TtsProviderRuntime> = {}) {
    super({
      kind: "azure",
      name: "Azure Speech",
      baseUrl: AZURE_TTS_BASE_URL,
      headers: {},
      manualModels: [],
      manualVoices: [],
      defaultFormat: "mp3",
      ...runtime,
    });
  }

  /** Azure has no model endpoint; expose the documented voice families. */
  async listModels(): Promise<TtsModel[]> {
    return [
      { id: "Neural", name: "Neural", voices: [], languages: [] },
      { id: "Multilingual", name: "Multilingual Neural", voices: [], languages: [] },
      { id: "Standard", name: "Standard", voices: [], languages: [] },
    ];
  }

  async listVoices(options: TtsListOptions): Promise<TtsVoice[]> {
    const base = this.resolveBaseUrl(options.baseUrl);
    const payload = await this.fetchJson<unknown>(
      `${base}/cognitiveservices/voices/list`,
      {
        method: "GET",
        headers: this.withRuntimeHeaders({ "Ocp-Apim-Subscription-Key": options.apiKey }),
      },
      { signal: options.signal },
    );
    const items = Array.isArray(payload) ? payload : [];
    const voices: TtsVoice[] = [];
    for (const item of items) {
      const record = asRecord(item);
      if (!record) continue;
      const id = pickString(record, "ShortName", "Name");
      if (!id) continue;
      const voice: TtsVoice = { id, name: pickString(record, "DisplayName", "LocalName") || id };
      const locale = pickString(record, "Locale");
      if (locale) voice.language = locale;
      voices.push(voice);
    }
    if (voices.length === 0) {
      throw new Error("Azure Speech returned no voices (check the region and subscription key).");
    }
    return voices;
  }

  async synthesize(options: TtsSynthesizeOptions): Promise<TtsAudioResult> {
    if (!(options.apiKey ?? "").trim()) throw new Error("An Azure Speech subscription key is required.");
    const base = this.resolveBaseUrl(options.baseUrl);
    const voice = (options.voice || "en-US-JennyNeural").trim();
    const locale = (options.language || localeFromVoice(voice) || "en-US").trim();
    const output = azureOutputFormat(options.responseFormat, "mp3");
    const ssml = `<speak version='1.0' xml:lang='${escapeXml(locale)}'><voice xml:lang='${escapeXml(locale)}' name='${escapeXml(voice)}'>${escapeXml(options.input)}</voice></speak>`;

    const { bytes, contentType } = await this.fetchAudio(
      `${base}/cognitiveservices/v1`,
      {
        method: "POST",
        headers: this.withRuntimeHeaders({
          "Ocp-Apim-Subscription-Key": options.apiKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": output,
          "User-Agent": "GPTLoop",
        }),
        body: ssml,
      },
      { signal: options.signal },
    );
    return {
      bytes,
      contentType: contentType || "audio/mpeg",
      format: formatFromAzureOutput(output),
      model: options.model || "Neural",
    };
  }
}
