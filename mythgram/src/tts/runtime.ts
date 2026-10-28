import type { SpeechRuntime, SpeechSynthesis } from "../agents/tools/types.js";
import type { TtsManager } from "./manager.js";

/**
 * Adapt the persistent {@link TtsManager} into the {@link SpeechRuntime} bridge the
 * `generate_speech` tool consumes. The provider is selected automatically by the manager from the
 * SAME configuration the user manages in the TTS panel — cloud providers first, then custom
 * providers, then the local TTS provider — so the LLM never has to name one.
 */
export function createSpeechRuntime(manager: TtsManager): SpeechRuntime {
  return {
    available: () => manager.selectProvider() !== null,
    async synthesize({ text, signal }): Promise<SpeechSynthesis> {
      const result = await manager.synthesizeAuto({ text, signal });
      return {
        base64: result.base64,
        bytes: result.bytes,
        format: result.format,
        mime: result.mime,
        filename: result.filename,
        providerId: result.providerId,
        providerName: result.providerName,
        model: result.model,
        voice: result.voice,
      };
    },
  };
}
