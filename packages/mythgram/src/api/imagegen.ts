import { Router, type Request, type Response } from "express";
import { isSafeSessionId } from "../database/index.js";
import type { ImageManager } from "../image-gen/index.js";

/**
 * Image generation API — provider configuration + image generation.
 *
 *   GET    /api/image-gen/providers                  configured providers + static catalog
 *   POST   /api/image-gen/providers                  create (kind: custom) / upsert built-in
 *   PUT    /api/image-gen/providers/:id              rename / set key / change model+ratio
 *   DELETE /api/image-gen/providers/:id              delete a custom provider
 *   GET    /api/image-gen/providers/:id/models       live model list (fetched from provider)
 *   POST   /api/image-gen/generate                   generate an image → base64 image
 *   GET    /api/image-gen/agent                      agent image settings (generate_image)
 *   PUT    /api/image-gen/agent                      update agent image settings
 *
 * API keys are write-only: the browser sends a key on create/update, the backend
 * stores it server-side and only ever serves the public projection (hasApiKey flag).
 */

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  return (error as { code?: string }).code ?? "image_error";
}

export function buildImageGenRouter(manager: ImageManager): Router {
  const router = Router();

  /** Configured providers (public) plus the static catalog with setup instructions. */
  router.get("/providers", (_req: Request, res: Response) => {
    res.json({ ok: true, providers: manager.listPublic(), catalog: manager.catalog() });
  });

  /** Create a provider: built-in kind upserts its record, "custom" mints a new one. */
  router.post("/providers", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const provider = manager.create(body);
      res.json({ ok: true, provider: manager.listPublic().find((p) => p.id === provider.id) });
    } catch (error) {
      err(res, 400, errorCode(error), errorMessage(error));
    }
  });

  /** Update a provider (write-only API key: absent keeps the stored one). */
  router.put("/providers/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "invalid_id", "Invalid provider id.");
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updated = manager.update(id, body);
    if (!updated) {
      err(res, 404, "provider_not_found", "Provider not found.");
      return;
    }
    res.json({ ok: true, provider: manager.listPublic().find((p) => p.id === updated.id) });
  });

  /** Delete a custom provider (built-ins cannot be removed). */
  router.delete("/providers/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "invalid_id", "Invalid provider id.");
      return;
    }
    const removed = manager.delete(id);
    if (!removed) {
      err(res, 400, "provider_not_removable", "Unknown provider, or a built-in provider cannot be deleted.");
      return;
    }
    res.json({ ok: true, id });
  });

  /** Live model list, fetched from the provider (never hard-coded where an endpoint exists). */
  router.get("/providers/:id/models", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "invalid_id", "Invalid provider id.");
      return;
    }
    try {
      const models = await manager.listModels(id);
      res.json({ ok: true, models });
    } catch (error) {
      err(res, 502, errorCode(error), errorMessage(error));
    }
  });

  /** Generate an image and return it base64-encoded. */
  router.post("/generate", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const providerId = typeof body.providerId === "string" ? body.providerId : "";
    if (!isSafeSessionId(providerId)) {
      err(res, 400, "provider_required", "A valid providerId is required.");
      return;
    }
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt.trim()) {
      err(res, 400, "prompt_required", "A prompt is required.");
      return;
    }
    try {
      const image = await manager.generate(providerId, {
        prompt,
        model: typeof body.model === "string" ? body.model : undefined,
        aspectRatio: typeof body.aspectRatio === "string" ? body.aspectRatio : undefined,
      });
      res.json({ ok: true, image });
    } catch (error) {
      err(res, 502, errorCode(error), errorMessage(error));
    }
  });

  /** Agent image settings used by the generate_image tool (+ the auto-selected provider id). */
  router.get("/agent", (_req: Request, res: Response) => {
    const config = manager.getAgentConfig();
    const auto = manager.selectProvider();
    res.json({ ok: true, config, auto_provider_id: auto?.id ?? null });
  });

  /** Update the agent image settings (provider pin + model/aspect-ratio overrides). */
  router.put("/agent", (req: Request, res: Response) => {
    try {
      const config = manager.updateAgentConfig(req.body ?? {});
      res.json({ ok: true, config });
    } catch (error) {
      err(res, 400, errorCode(error), errorMessage(error));
    }
  });

  return router;
}
