import { Router, type Request, type Response } from "express";
import type { ProviderRegistry } from "../agents/providers/registry.js";
import { isLocalProviderId } from "../agents/providers/local.js";

interface ModelsBody {
  provider?: string;
  api_key?: string;
  base_url?: string;
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
