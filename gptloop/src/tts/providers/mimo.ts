/**
 * Xiaomi MiMo TTS provider — drives the MiMo speech-synthesis models through
 * `POST https://api.xiaomimimo.com/v1/chat/completions` (an OpenAI-compatible
 * chat endpoint with an `audio` extension): the text to speak MUST be in an
 * `assistant` message, the response carries Base64 audio in
 * `choices[0].message.audio.data`. Auth uses the `api-key` header.
 * https://mimo.mi.com/docs/en-US/api/audio/tts
 */
import type {
  TtsModelInfo,
  TtsProvider,
  TtsSynthesisResult,
  TtsVoiceInfo,
} from "../types.js";

import { ttsPostJson, throwTtsProviderError } from "../http.js";

const PROVIDER_LABEL = "Xiaomi MiMo";
const TTS_URL = "https://api.xiaomimimo.com/v1/chat/completions";

const FORMATS: Record<string, { format: string; extension: string; contentType: string }> = {
  wav: { format: "wav", extension: "wav", contentType: "audio/wav" },
  mp3: { format: "mp3", extension: "mp3", contentType: "audio/mpeg" },
  pcm: { format: "pcm", extension: "pcm", contentType: "audio/pcm" },
};

/** MiMo TTS models (documented catalog — no model-list endpoint). */
const MIMO_MODELS: TtsModelInfo[] = [
  { id: "mimo-v2.5-tts", label: "mimo-v2.5-tts — built-in voices" },
  { id: "mimo-v2.5-tts-voicedesign", label: "mimo-v2.5-tts-voicedesign — voice from a text description" },
  { id: "mimo-v2.5-tts-voiceclone", label: "mimo-v2.5-tts-voiceclone — clone from an audio sample" },
];

/** MiMo built-in voices (documented catalog — no voice-list endpoint). */
const MIMO_VOICES: TtsVoiceInfo[] = [
  { id: "mimo_default", label: "MiMo default" },
  { id: "冰糖", label: "冰糖 — Chinese female" },
  { id: "茉莉", label: "茉莉 — Chinese female" },
  { id: "苏打", label: "苏打 — Chinese male" },
  { id: "白桦", label: "白桦 — Chinese male" },
  { id: "Mia", label: "Mia — English female" },
  { id: "Chloe", label: "Chloe — English female" },
  { id: "Milo", label: "Milo — English male" },
  { id: "Dean", label: "Dean — English male" },
];

interface MimoResponse {
  choices?: Array<{
    message?: { audio?: { data?: string } };
  }>;
}

export const mimoTtsProvider: TtsProvider = {
  id: "xiaomi_mimo",
  label: PROVIDER_LABEL,
  requiresApiKey: true,
  requiresBaseUrl: false,
  requiresVoice: false,
  instructions:
    "Use your MiMo API key (sent in the api-key header). Pick a MiMo TTS model and a built-in voice " +
    "(mimo_default unless you choose one). Voice-design/clone models need extra setup described in " +
    "the MiMo docs — the built-in voice model is the simplest path.",
  fetchModels(): Promise<TtsModelInfo[]> {
    return Promise.resolve(MIMO_MODELS);
  },
  fetchVoices(): Promise<TtsVoiceInfo[]> {
    // Built-in voices are a fixed documented catalog (mimo-v2.5-tts); there is no list endpoint.
    return Promise.resolve(MIMO_VOICES);
  },
  async synthesize(text, config, ctx): Promise<TtsSynthesisResult> {
    if (!config.apiKey?.trim()) throw new Error("No MiMo API key configured. Add it in the TTS panel.");
    const formatKey = (config.outputFormat?.trim() || "wav").toLowerCase();
    const format = FORMATS[formatKey] ?? FORMATS.wav!;
    const model = config.model?.trim() || "mimo-v2.5-tts";
    try {
      const data = await ttsPostJson<MimoResponse>(
        TTS_URL,
        { "api-key": config.apiKey.trim() },
        {
          model,
          // The text to speak is carried by the ASSISTANT message (MiMo API rule).
          messages: [
            ...(config.instructions?.trim()
              ? [{ role: "user", content: config.instructions.trim() }]
              : []),
            { role: "assistant", content: text },
          ],
          audio: {
            format: format.format,
            ...(config.voice?.trim() ? { voice: config.voice.trim() } : {}),
          },
        },
        ctx,
      );
      const audioBase64 = data.choices?.[0]?.message?.audio?.data;
      if (!audioBase64) throw new Error("MiMo returned no audio data.");
      return {
        audio: Buffer.from(audioBase64, "base64"),
        extension: format.extension,
        contentType: format.contentType,
        provider: "xiaomi_mimo",
        model,
        voice: config.voice,
      };
    } catch (error) {
      throwTtsProviderError(PROVIDER_LABEL, error);
    }
  },
};
