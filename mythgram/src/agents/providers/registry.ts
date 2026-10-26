import type { Provider, ProviderMetadata } from "./types.js";
import { buildCustomProvider, isCustomProviderId } from "./custom.js";
import { openRouterProvider } from "./openrouter.js";
import { groqProvider } from "./groq.js";
import { nvidiaProvider } from "./nvidia.js";
import { fireworksProvider } from "./fireworks.js";
import { ollamaCloudProvider } from "./ollamaCloud.js";
import { localProvider } from "./local.js";
import { opencodeZenProvider } from "./opencodeZen.js";
import { aihubmixProvider } from "./aihubmix.js";
import { blueclawProvider } from "./blueclaw.js";
import { requestyProvider } from "./requesty.js";
import { unorouterProvider } from "./unorouter.js";
import { vercelAiGatewayProvider } from "./vercelAiGateway.js";
import { zenmuxProvider } from "./zenmux.js";
import { kiloCodeProvider } from "./kiloCode.js";
import { chutesProvider } from "./chutes.js";
import { cohereProvider } from "./cohere.js";
import { mistralProvider } from "./mistral.js";
import { cerebrasProvider } from "./cerebras.js";
import { sambanovaProvider } from "./sambanova.js";
import { huggingfaceProvider } from "./huggingface.js";
import { pollinationsProvider } from "./pollinations.js";
import { zaiProvider } from "./zai.js";
import { siliconflowProvider } from "./siliconflow.js";
import { airforceProvider } from "./airforce.js";
import { inceptionlabsProvider } from "./inceptionlabs.js";
import { deepseekProvider } from "./deepseek.js";
import { routewayProvider } from "./routeway.js";
import { opentyphoonProvider } from "./opentyphoon.js";
import { sarvamProvider } from "./sarvam.js";
import { sealionProvider } from "./sealion.js";
import { openadapterProvider } from "./openadapter.js";
import { xkiroProvider } from "./xkiro.js";
import { apinexProvider } from "./apinex.js";
import { clineProvider } from "./cline.js";
import { tokenHarborProvider } from "./tokenharbor.js";
import { commandCodeProvider } from "./commandcode.js";
import { codeCraftApiProvider } from "./codecraftapi.js";

/**
 * ProviderRegistry maps a provider id to a Provider implementation.
 * Adding a provider = create a file exporting a Provider and register it here.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  register(provider: Provider): this {
    this.providers.set(provider.metadata.id, provider);
    return this;
  }

  registerAll(providers: Provider[]): this {
    for (const provider of providers) this.register(provider);
    return this;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  get(id: string): Provider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Unknown provider: ${id}`);
    return provider;
  }

  list(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map((p) => p.metadata);
  }
}

/**
 * The full set of supported providers. Order here is the order the frontend renders
 * them in the provider dropdown, and mirrors the backend registry.
 */
export const ALL_PROVIDERS: Provider[] = [
  openRouterProvider,
  groqProvider,
  nvidiaProvider,
  fireworksProvider,
  ollamaCloudProvider,
  localProvider,
  opencodeZenProvider,
  aihubmixProvider,
  blueclawProvider,
  requestyProvider,
  unorouterProvider,
  vercelAiGatewayProvider,
  zenmuxProvider,
  kiloCodeProvider,
  chutesProvider,
  cohereProvider,
  mistralProvider,
  cerebrasProvider,
  sambanovaProvider,
  huggingfaceProvider,
  pollinationsProvider,
  zaiProvider,
  siliconflowProvider,
  airforceProvider,
  inceptionlabsProvider,
  deepseekProvider,
  routewayProvider,
  opentyphoonProvider,
  sarvamProvider,
  sealionProvider,
  openadapterProvider,
  xkiroProvider,
  apinexProvider,
  clineProvider,
  tokenHarborProvider,
  commandCodeProvider,
  codeCraftApiProvider,
];

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry().registerAll(ALL_PROVIDERS);
}

/**
 * Resolve the Provider that should serve a request. Built-in providers come from the
 * registry; a `custom_`-prefixed id is materialized on the fly from the config the
 * frontend sent with the request.
 */
export function resolveProvider(
  providers: ProviderRegistry,
  providerId: string,
  customConfig?: unknown,
): Provider {
  if (isCustomProviderId(providerId)) {
    return buildCustomProvider(customConfig);
  }
  if (customConfig) {
    const record = customConfig as Record<string, unknown>;
    if (typeof record.id === "string" && record.id && record.id === providerId) {
      return buildCustomProvider(customConfig);
    }
  }
  return providers.get(providerId);
}
