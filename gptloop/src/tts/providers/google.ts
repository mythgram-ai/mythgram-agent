/**
 * Google Cloud Text-to-Speech provider — POSTs to the `text:synthesize` REST
 * endpoint with an API key; the response JSON carries Base64-encoded audio.
 * Voices are fetched live from `GET /v1/voices` (every voice name encodes its
 * model family, e.g. "en-US-Neural2-A"), so there is no separate model
 * endpoint to call — the live voice list IS the catalog.
 * https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
 */
import type {
  TtsProvider,
  TtsSynthesisResult,
  TtsVoiceInfo,
} from "../types.js";

import { ttsGetJson, ttsPostJson, throwTtsProviderError } from "../http.js";

const PROVIDER_LABEL = "Google Cloud TTS";
const API_ROOT = "https://texttospeech.googleapis.com/v1";

/** Google audio encodings -> extension/contentType (MP3 default). */
const ENCODINGS: Record<string, { encoding: string; extension: string; contentType: string }> = {
  mp3: { encoding: "MP3", extension: "mp3", contentType: "audio/mpeg" },
  wav: { encoding: "LINEAR16", extension: "wav", contentType: "audio/wav" },
  ogg: { encoding: "OGG_OPUS", extension: "ogg", contentType: "audio/ogg" },
};

interface GoogleVoice {
  name?: string;
  languageCodes?: string[];
  ssmlGender?: string;
}

/** Derive the BCP-47 language code from a Google voice name (e.g. "en-US-Chirp3-HD-Aoede" -> "en-US"). */
function languageFromVoiceName(voice: string): string {
  const parts = voice.split("-");
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
  return parts[0] ?? "en-US";
}

export const googleTtsProvider: TtsProvider = {
  id: "google",
  label: PROVIDER_LABEL,
  requiresApiKey: true,
  requiresBaseUrl: false,
  requiresVoice: true,
  instructions:
    "Use a Google Cloud API key with the Cloud Text-to-Speech API enabled. Pick a voice from the live " +
    "list (each voice name already encodes its model family, e.g. en-US-Chirp3-HD-Aoede), and set the " +
    "language code for it (usually auto-derived from the voice name).",
  async fetchVoices(config, ctx): Promise<TtsVoiceInfo[]> {
    if (!config.apiKey?.trim()) {
      throw new Error("No Google Cloud TTS API key configured. Add it in the TTS panel.");
    }
    try {
      const data = await ttsGetJson<{ voices?: GoogleVoice[] }>(
        `${API_ROOT}/voices?key=${encodeURIComponent(config.apiKey.trim())}`,
        {},
        ctx,
      );
      return (data.voices ?? [])
        .filter((v) => typeof v.name === "string" && v.name.length > 0)
        .map((v) => ({
          id: v.name as string,
          label: v.name,
          language: v.languageCodes?.[0],
          gender: v.ssmlGender?.toLowerCase(),
        }));
    } catch (error) {
      throwTtsProviderError(`${PROVIDER_LABEL} voice list`, error);
    }
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    if (!config.apiKey?.trim()) throw new Error("No Google Cloud TTS API key configured. Add it in the TTS panel.");
    if (!config.voice?.trim()) throw new Error("No Google voice selected. Pick one in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "mp3").toLowerCase();
    const format = ENCODINGS[formatKey] ?? ENCODINGS.mp3!;
    const voiceName = config.voice.trim();
    const languageCode = config.language?.trim() || languageFromVoiceName(voiceName);
    try {
      const data = await ttsPostJson<{ audioContent?: string }>(
        `${API_ROOT}/text:synthesize?key=${encodeURIComponent(config.apiKey.trim())}`,
        {},
        {
          input: { text },
          voice: { languageCode, name: voiceName },
          audioConfig: {
            audioEncoding: format.encoding,
            ...(typeof config.speed === "number" && config.speed > 0
              ? { speakingRate: Math.min(4, Math.max(0.25, config.speed)) }
              : {}),
          },
        },
        ctx,
      );
      if (!data.audioContent) throw new Error("Google Cloud TTS returned no audio content.");
      return {
        audio: Buffer.from(data.audioContent, "base64"),
        extension: format.extension,
        contentType: format.contentType,
        provider: "google",
        voice: voiceName,
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
