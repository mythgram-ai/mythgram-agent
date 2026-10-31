import type { CustomProvider, CustomProviderConfig, ProviderMeta } from "@/types";

/** Marker prefix shared with the backend for dynamically-defined providers. */
export const CUSTOM_PROVIDER_PREFIX = "custom_";

/** Whether a provider id refers to a user-defined custom provider. */
export function isCustomProviderId(id: string | undefined): boolean {
  return Boolean(id && id.startsWith(CUSTOM_PROVIDER_PREFIX));
}

/** Stable id of the built-in local-models provider (Ollama / LM Studio / any local server). */
export const LOCAL_PROVIDER_ID = "local";

/** Whether a provider id refers to local running models (no API key needed). */
export function isLocalProviderId(id: string | undefined): boolean {
  return id === LOCAL_PROVIDER_ID;
}

/** Default base URLs offered for local model servers. */
export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";
export const LMSTUDIO_DEFAULT_BASE_URL = "http://localhost:1234/v1";

/**
 * Build the flat wire-format config sent to the backend for a given custom provider
 * and one of its models. Custom headers collapse from key/value pairs into a record.
 */
export function toCustomProviderConfig(
  provider: CustomProvider,
  model: string,
): CustomProviderConfig {
  const headers: Record<string, string> = {};
  for (const pair of provider.headers ?? []) {
    const key = (pair.key ?? "").trim();
    if (key && !key.toLowerCase().startsWith("content-type")) headers[key] = pair.value;
  }
  return {
    id: provider.id,
    name: provider.name,
    model: model || (provider.models[0] as string | undefined) || "",
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey || undefined,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  };
}

/**
 * Static fallback list of every provider the mythgram backend supports, mirroring
 * `packages/mythgram/src/agents/providers/registry.ts`. The Settings modal fetches the live
 * list from the backend, but falls back to this so the dropdown is always populated
 * (e.g. before the first fetch resolves or if the backend is unreachable).
 */
export const FALLBACK_PROVIDERS: ProviderMeta[] = [
  { id: "openrouter", label: "OpenRouter", defaultBaseUrl: "https://openrouter.ai/api/v1" },
  { id: "groq", label: "Groq", defaultBaseUrl: "https://api.groq.com/openai/v1" },
  { id: "nvidia", label: "NVIDIA NIM", defaultBaseUrl: "https://integrate.api.nvidia.com/v1" },
  { id: "fireworks", label: "Fireworks AI", defaultBaseUrl: "https://api.fireworks.ai/inference/v1" },
  { id: "ollama_cloud", label: "Ollama Cloud", defaultBaseUrl: "https://ollama.com/api/v1" },
  { id: "local", label: "Local Models", defaultBaseUrl: "http://localhost:11434/v1" },
  { id: "opencode_zen", label: "OpenCode Zen", defaultBaseUrl: "https://opencode.ai/zen/v1" },
  { id: "aihubmix", label: "AIHubMix", defaultBaseUrl: "https://api.aihubmix.com/v1" },
  { id: "blueclaw", label: "Blue Claw", defaultBaseUrl: "https://openai.blueclaw.network/v1" },
  { id: "requesty", label: "Requesty", defaultBaseUrl: "https://router.requesty.ai/v1" },
  { id: "unorouter", label: "UnoRouter", defaultBaseUrl: "https://api.unorouter.com/v1" },
  { id: "vercel_ai_gateway", label: "Vercel AI Gateway", defaultBaseUrl: "https://ai-gateway.vercel.sh/v1" },
  { id: "zenmux", label: "ZenMux", defaultBaseUrl: "https://zenmux.ai/api/v1" },
  { id: "kilo_code", label: "Kilo Code", defaultBaseUrl: "https://api.kilo.ai/api/gateway" },
  { id: "chutes", label: "Chutes", defaultBaseUrl: "https://llm.chutes.ai/v1" },
  { id: "cohere", label: "Cohere", defaultBaseUrl: "https://api.cohere.ai/compatibility/v1" },
  { id: "mistral", label: "Mistral AI", defaultBaseUrl: "https://api.mistral.ai/v1" },
  { id: "cerebras", label: "Cerebras", defaultBaseUrl: "https://api.cerebras.ai/v1" },
  { id: "sambanova", label: "SambaNova", defaultBaseUrl: "https://api.sambanova.ai/v1" },
  { id: "huggingface", label: "Hugging Face", defaultBaseUrl: "https://router.huggingface.co/v1" },
  { id: "pollinations", label: "Pollinations AI", defaultBaseUrl: "https://gen.pollinations.ai/v1" },
  { id: "z_ai", label: "Z.ai (Zhipu AI)", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4/" },
  { id: "siliconflow", label: "SiliconFlow", defaultBaseUrl: "https://api.siliconflow.com/v1" },
  { id: "airforce", label: "Airforce AI", defaultBaseUrl: "https://api.airforce/v1" },
  { id: "inceptionlabs", label: "Inception Labs", defaultBaseUrl: "https://api.inceptionlabs.ai/v1" },
  { id: "deepseek", label: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1" },
  { id: "routeway", label: "Routeway", defaultBaseUrl: "https://api.routeway.ai/v1" },
  { id: "opentyphoon", label: "OpenTyphoon", defaultBaseUrl: "https://api.opentyphoon.ai/v1" },
  { id: "sarvam", label: "Sarvam AI", defaultBaseUrl: "https://api.sarvam.ai/v1" },
  { id: "sealion", label: "SEA-LION", defaultBaseUrl: "https://api.sea-lion.ai/v1" },
  { id: "openadapter", label: "OpenAdapter", defaultBaseUrl: "https://api.openadapter.in/v1" },
  { id: "xkiro", label: "xKiro AI", defaultBaseUrl: "https://api.xkiro.com/v1" },
  { id: "apinex", label: "APInex", defaultBaseUrl: "https://api.apinex.bond/v1" },
  { id: "cline", label: "Cline", defaultBaseUrl: "https://api.cline.bot/api/v1" },
  { id: "tokenharbor", label: "Token Harbor", defaultBaseUrl: "https://tokenharbor.ai/v1" },
  { id: "commandcode", label: "Command Code", defaultBaseUrl: "https://api.commandcode.ai/provider/v1" },
  { id: "codecraftapi", label: "CodeCraft API", defaultBaseUrl: "https://codecraftapi.com/v1" },
];
