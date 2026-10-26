/**
 * Vision capability detection for the agent's LLM model.
 *
 * The `read_image` tool loads an image and passes it to the model as a vision
 * input (an `image_url` content part). That only works when the selected model
 * accepts image inputs. Because provider model lists carry no capability flags,
 * this module uses a lightweight substring heuristic plus explicit configuration
 * overrides (`VISION_MODEL_PATTERNS` / `TEXT_ONLY_MODEL_PATTERNS` in `.env`).
 */

/** Model-id substrings that indicate the model accepts image inputs. */
const VISION_INDICATORS: readonly string[] = [
  "gpt-4o",
  "gpt-4.5",
  "gpt-4-turbo",
  "gpt-4-vision",
  "o1",
  "o3",
  "o4",
  "vision",
  "llava",
  "gemini",
  "claude",
  "pixtral",
  "qwen2-vl",
  "qwen2.5-vl",
  "glm-4v",
  "internvl",
  "intern-vl",
  "minicpm",
  "idefics",
  "fuyu",
  "paligemma",
  "moondream",
  "kosmos",
  "grok-2-vision",
  "grok-4",
  "reka",
  "step-1v",
  "cogvlm",
  "deepseek-vl",
  "phi-3.5-vision",
  "phi-4-multimodal",
  "multimodal",
  "aria",
];

/** Model-id substrings that indicate a text-only model (no image inputs). */
const TEXT_ONLY_INDICATORS: readonly string[] = [
  "gpt-3.5",
  "gpt-4-0613",
  "gpt-4-1106-preview",
  "gpt-4-0125-preview",
  "deepseek-chat",
  "deepseek-reasoner",
  "llama-3.1",
  "llama-3.3",
  "llama-3.2-1b",
  "llama-3.2-3b",
  "mistral-nemo",
  "mistral-small",
  "mistral-medium",
  "gemma",
  "qwen-turbo",
  "qwen-plus",
  "qwen-max",
  "text-embedding",
  "embedding",
  "dall-e",
  "whisper",
  "tts",
];

/** Config knobs used by the vision capability check (subset of AppConfig). */
export interface VisionModelConfig {
  /** Extra model-id substrings that are always treated as vision capable. */
  visionModelPatterns?: string[];
  /** Extra model-id substrings that are always treated as text-only. */
  textOnlyModelPatterns?: string[];
}

/**
 * Decide whether a model can be given image inputs.
 *
 * Order of evaluation: explicit text-only patterns win, then explicit vision
 * patterns, then the built-in indicator lists. Unknown models default to
 * capable — most modern OpenAI-compatible models accept images, and a genuine
 * text-only model is either caught here or rejected by the provider with a
 * clear API error.
 */
export function isVisionCapableModel(model: string, config?: VisionModelConfig): boolean {
  const id = model.trim().toLowerCase();
  if (!id) return true;

  const textOnly = [...TEXT_ONLY_INDICATORS, ...(config?.textOnlyModelPatterns ?? [])]
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  for (const pattern of textOnly) {
    if (id.includes(pattern)) return false;
  }

  const vision = [...VISION_INDICATORS, ...(config?.visionModelPatterns ?? [])]
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  for (const pattern of vision) {
    if (id.includes(pattern)) return true;
  }

  return true;
}
