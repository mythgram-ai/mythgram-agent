import { Router, type Request, type Response } from "express";
import { isSafeSessionId } from "../database/index.js";
import type { TtsManager } from "../tts/index.js";

/**
 * Text-to-speech API — provider configuration + speech generation.
 *
 *   GET    /api/tts/providers                  configured providers + static catalog
 *   POST   /api/tts/providers                  create (kind: custom) / upsert built-in
 *   PUT    /api/tts/providers/:id              rename / set key / change model+voice
 *   DELETE /api/tts/providers/:id              delete a custom provider
 *   GET    /api/tts/providers/:id/models       live model list (fetched from provider)
 *   GET    /api/tts/providers/:id/voices       live voice list (optionally ?model=)
 *   POST   /api/tts/speech                     synthesize text → base64 audio
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
  return (error as { code?: string }).code ?? "tts_error";
}

export function buildTtsRouter(manager: TtsManager): Router {
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

  /** Live model list, fetched from the provider (never hard-coded). */
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

  /** Live voice list for a provider/model. */
  router.get("/providers/:id/voices", async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!isSafeSessionId(id)) {
      err(res, 400, "invalid_id", "Invalid provider id.");
      return;
    }
    const model = typeof req.query.model === "string" ? req.query.model : undefined;
    try {
      const voices = await manager.listVoices(id, model);
      res.json({ ok: true, voices });
    } catch (error) {
      err(res, 502, errorCode(error), errorMessage(error));
    }
  });

  /** Synthesize text into speech and return the audio base64-encoded. */
  router.post("/speech", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const providerId = typeof body.providerId === "string" ? body.providerId : "";
    if (!isSafeSessionId(providerId)) {
      err(res, 400, "provider_required", "A valid providerId is required.");
      return;
    }
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) {
      err(res, 400, "text_required", "Text is required.");
      return;
    }
    try {
      const audio = await manager.synthesize(providerId, {
        text,
        model: typeof body.model === "string" ? body.model : undefined,
        voice: typeof body.voice === "string" ? body.voice : undefined,
        language: typeof body.language === "string" ? body.language : undefined,
        format: typeof body.format === "string" ? body.format : undefined,
        speed: typeof body.speed === "number" ? body.speed : undefined,
        instructions: typeof body.instructions === "string" ? body.instructions : undefined,
      });
      res.json({ ok: true, audio });
    } catch (error) {
      err(res, 502, errorCode(error), errorMessage(error));
    }
  });

  return router;
}
