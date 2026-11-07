import { Router, type Request, type Response } from "express";
import type { ProviderRegistry } from "../agents/providers/registry.js";
import { isLocalProviderId } from "../agents/providers/local.js";
import {
  buildCustomProvider,
  isCustomProviderId,
  type CustomProviderConfig,
} from "../agents/providers/custom.js";

interface ModelsBody {
  provider?: string;
  api_key?: string;
  base_url?: string;
  models_url?: string;
  headers?: unknown;
  custom_provider?: unknown;
}

/** Coerce an untrusted field into a trimmed string. */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Coerce untrusted header input into a plain key/value record. */
function headersRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string") out[key] = val;
  }
  return out;
}

/**
 * Build a custom-provider config from the request, or null for a built-in provider.
 * A `custom_provider` object is accepted as-is; otherwise a `custom_`-prefixed id
 * is treated as a custom provider whose fields arrive at the top level.
 */
function customConfigFrom(body: ModelsBody): CustomProviderConfig | null {
  const providerId = str(body.provider).trim();
  const raw = body.custom_provider;
  const hasConfig = Boolean(raw) && typeof raw === "object" && !Array.isArray(raw);
  if (!hasConfig && !isCustomProviderId(providerId)) return null;

  const record = hasConfig ? (raw as Record<string, unknown>) : {};
  const id = str(record.id).trim() || providerId;
  return {
    id: id || `custom_${Date.now().toString(36)}`,
    name: str(record.name).trim() || id || "Custom Provider",
    model: str(record.model),
    baseUrl: str(record.baseUrl).trim() || str(body.base_url).trim(),
    apiKey: str(record.apiKey).trim() || str(body.api_key).trim(),
    modelsUrl: str(record.modelsUrl).trim() || str(body.models_url).trim(),
    headers: headersRecord(record.headers ?? body.headers),
  };
}

export function buildProviderRouter(providers: ProviderRegistry): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json(providers.list());
  });

  router.post("/models", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ModelsBody;
    if (!body.provider) {
      res.status(400).json({ error: "provider is required." });
      return;
    }

    // Custom providers carry their own config (base URL, headers, optional key),
    // so they neither need a registry entry nor an API key.
    const custom = customConfigFrom(body);
    if (custom) {
      try {
        const provider = buildCustomProvider(custom);
        const models = await provider.listModels(custom.apiKey ?? "");
        res.json({ provider: custom.id, models });
      } catch (error) {
        res.status(500).json({
          error: `Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return;
    }

    // Local model servers (Ollama, LM Studio, ...) usually need no API key.
    if (!body.api_key && !isLocalProviderId(body.provider)) {
      res.status(400).json({ error: "api_key is required." });
      return;
    }
    try {
      const provider = providers.get(body.provider);
      const models = await provider.listModels(body.api_key ?? "", body.base_url);
      res.json({ provider: body.provider, models });
    } catch (error) {
      res.status(500).json({
        error: `Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  return router;
}