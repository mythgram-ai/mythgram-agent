/**
 * Microsoft Azure Speech TTS provider — POSTs SSML to the regional
 * `cognitiveservices/v1` endpoint with the subscription key and an
 * `X-Microsoft-OutputFormat` header; the response is raw audio bytes.
 * Voices are fetched live from `cognitiveservices/voices/list`.
 * https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
 */
import { ttsGetJson, ttsPostRawForBinary, throwTtsProviderError } from "../http.js";
import type { TtsProvider, TtsSynthesisResult, TtsToolsConfig, TtsVoiceInfo } from "../types.js";

const PROVIDER_LABEL = "Azure Speech";

/** Output formats Azure supports via X-Microsoft-OutputFormat (mp3 24kHz default). */
const AZURE_OUTPUT_FORMATS: Record<string, string> = {
  mp3: "audio-24khz-48kbitrate-mono-mp3",
  mp3_48k: "audio-48khz-192kbitrate-mono-mp3",
  wav: "riff-24khz-16bit-mono-pcm",
  wav_48k: "riff-48khz-16bit-mono-pcm",
  ogg: "ogg-48khz-16bit-mono-opus",
};

const EXTENSIONS: Record<string, { extension: string; contentType: string }> = {
  mp3: { extension: "mp3", contentType: "audio/mpeg" },
  mp3_48k: { extension: "mp3", contentType: "audio/mpeg" },
  wav: { extension: "wav", contentType: "audio/wav" },
  wav_48k: { extension: "wav", contentType: "audio/wav" },
  ogg: { extension: "ogg", contentType: "audio/ogg" },
};

/** Escape XML special characters for embedding text inside SSML. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function speechEndpoint(config: TtsToolsConfig, path: string): string {
  const region = config.azureRegion?.trim();
  if (!region) return "";
  return `https://${region}.tts.speech.microsoft.com${path}`;
}

interface AzureVoice {
  ShortName?: string;
  FriendlyName?: string;
  Gender?: string;
  Locale?: string;
}

export const azureTtsProvider: TtsProvider = {
  id: "azure_speech",
  label: PROVIDER_LABEL,
  requiresApiKey: true,
  requiresBaseUrl: false,
  requiresVoice: true,
  instructions:
    "Use your Azure Speech resource key and its region (e.g. eastus). Pick a neural voice from the " +
    "live voice list (e.g. en-US-AvaMultilingualNeural). Model selection is implicit — Azure voices " +
    "are the models.",
  missingRequirements(config) {
    return config.azureRegion?.trim() ? [] : ["region"];
  },
  fetchVoices(config, ctx): Promise<TtsVoiceInfo[]> {
    const url = speechEndpoint(config, "/cognitiveservices/voices/list");
    if (!url) return Promise.reject(new Error("No Azure region configured. Add it in the TTS panel."));
    const headers = { "Ocp-Apim-Subscription-Key": config.apiKey?.trim() ?? "" };
    return ttsGetJson<AzureVoice[]>(url, headers, ctx).then((voices) =>
      voices
        .filter((v) => typeof v.ShortName === "string" && v.ShortName.length > 0)
        .map((v) => ({
          id: v.ShortName as string,
          label: v.FriendlyName ?? v.ShortName,
          language: v.Locale,
          gender: v.Gender === "Female" ? "female" : v.Gender === "Male" ? "male" : undefined,
        })),
    ).catch((error) => throwTtsProviderError(`${PROVIDER_LABEL} voice list`, error));
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    if (!config.apiKey?.trim()) throw new Error("No Azure Speech API key configured. Add it in the TTS panel.");
    if (!config.azureRegion?.trim()) throw new Error("No Azure region configured. Add it in the TTS panel.");
    if (!config.voice?.trim()) throw new Error("No Azure voice selected. Pick one in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "mp3").toLowerCase();
    const outputFormat = AZURE_OUTPUT_FORMATS[formatKey] ?? AZURE_OUTPUT_FORMATS.mp3!;
    const ext = EXTENSIONS[formatKey] ?? EXTENSIONS.mp3!;
    const language = config.language?.trim() || "en-US";
    const ssml =
      `<speak version='1.0' xml:lang='${language}'>` +
      `<voice name='${escapeXml(config.voice.trim())}'>${escapeXml(text)}</voice></speak>`;
    try {
      const { audio, contentType } = await ttsPostRawForBinary(
        speechEndpoint(config, "/cognitiveservices/v1"),
        {
          "Ocp-Apim-Subscription-Key": config.apiKey.trim(),
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": outputFormat,
          "User-Agent": "gptloop-tts",
        },
        ssml,
        ctx,
      );
      return {
        audio,
        extension: ext.extension,
        contentType,
        provider: "azure_speech",
        voice: config.voice,
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
