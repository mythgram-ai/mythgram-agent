import type { ImageRuntime, ImageGenSynthesis } from "../agents/tools/types.js";
import type { ImageManager } from "./manager.js";

/**
 * Adapt the persistent {@link ImageManager} into the {@link ImageRuntime} bridge the
 * `generate_image` tool consumes. The provider is selected automatically by the manager from the
 * SAME configuration the user manages in the image panel — keyed built-ins first, then the
 * keyless Pollinations provider, then custom providers — so the LLM never has to name one.
 */
export function createImageRuntime(manager: ImageManager): ImageRuntime {
  return {
    available: () => manager.selectProvider() !== null,
    defaultAspectRatio: () => manager.getAgentConfig().aspectRatio,
    async generate({ prompt, aspectRatio, signal }): Promise<ImageGenSynthesis> {
      const result = await manager.generateAuto({ prompt, aspectRatio, signal });
      return {
        base64: result.base64,
        bytes: result.bytes,
        format: result.format,
        mime: result.mime,
        filename: result.filename,
        providerId: result.providerId,
        providerName: result.providerName,
        model: result.model,
        aspectRatio: result.aspectRatio,
      };
    },
  };
}
