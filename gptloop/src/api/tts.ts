import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import { fetchTtsModels, fetchTtsVoices, isTtsConfigured, synthesizeSpeechFile } from "../tts/engine.js";
import { allTtsProviders } from "../tts/registry.js";
import type { TtsToolsConfig } from "../tts/types.js";
import { ttsStudioStatus } from "../tts/providers/local.js";
import { toWorkspaceRelative } from "../utils/paths.js";

/**
 * TTS panel API: live model/voice catalogs for the selected provider, a
 * reachability check for the local TTS Studio service, and a short preview
 * synthesis the user can play before connecting. The browser supplies the
 * provider credentials per request (mirroring the per-turn chat flow) —
 * nothing TTS-related is persisted server-side.
 */

interface TtsCatalogBody {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
  language?: string;
  outputFormat?: string;
  azureRegion?: string;
  volcengineAppId?: string;
  volcengineCluster?: string;
  minimaxGroupId?: string;
  /** Text for the preview synthesis. */
  text?: string;
}

/** Build a TtsToolsConfig from the request body (strings trimmed). */
function configFromBody(body: TtsCatalogBody): TtsToolsConfig {
  return {
    provider: (body.provider ?? "").trim() as TtsToolsConfig["provider"],
    apiKey: body.apiKey?.trim() || undefined,
    baseUrl: body.baseUrl?.trim() || undefined,
    model: body.model?.trim() || undefined,
    voice: body.voice?.trim() || undefined,
    language: body.language?.trim() || undefined,
    outputFormat: body.outputFormat?.trim() || undefined,
    azureRegion: body.azureRegion?.trim() || undefined,
    volcengineAppId: body.volcengineAppId?.trim() || undefined,
    volcengineCluster: body.volcengineCluster?.trim() || undefined,
    minimaxGroupId: body.minimaxGroupId?.trim() || undefined,
  };
}

/** Abort the upstream fetch when the browser disconnects (listen on the response —
 * the request stream's own "close" fires as soon as the body is consumed). */
function signalFrom(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  return controller.signal;
}

export function buildTtsRouter(config: AppConfig): Router {
  const router = Router();

  // Every supported provider with its requirements + setup instructions,
  // so the panel can render provider cards without hard-coding them.
  router.get("/providers", (_req: Request, res: Response) => {
    res.json({
      providers: allTtsProviders().map((provider) => ({
        id: provider.id,
        label: provider.label,
        requires_api_key: provider.requiresApiKey,
        requires_base_url: provider.requiresBaseUrl,
        requires_voice: provider.requiresVoice,
        instructions: provider.instructions,
        has_model_list: typeof provider.fetchModels === "function",
        has_voice_list: typeof provider.fetchVoices === "function",
      })),
    });
  });

  // Live model catalog for the selected provider.
  router.post("/models", async (req: Request, res: Response) => {
    const config2 = configFromBody((req.body ?? {}) as TtsCatalogBody);
    if (!config2.provider) {
      res.status(400).json({ error: "provider is required." });
      return;
    }
    try {
      const models = await fetchTtsModels(config2, { signal: signalFrom(res) });
      res.json({ provider: config2.provider, models });
    } catch (error) {
      res.status(502).json({
        error: `Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  // Live voice catalog for the selected provider (+ model where relevant).
  router.post("/voices", async (req: Request, res: Response) => {
    const config2 = configFromBody((req.body ?? {}) as TtsCatalogBody);
    if (!config2.provider) {
      res.status(400).json({ error: "provider is required." });
      return;
    }
    try {
      const voices = await fetchTtsVoices(config2, { signal: signalFrom(res) });
      res.json({ provider: config2.provider, voices });
    } catch (error) {
      res.status(502).json({
        error: `Failed to fetch voices: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  // Local TTS Studio reachability + service info (GET {base-url} /v1 info).
  router.post("/local/status", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as TtsCatalogBody;
    try {
      const status = await ttsStudioStatus({ baseUrl: body.baseUrl ?? "" }, { signal: signalFrom(res) });
      res.json(status);
    } catch (error) {
      res.json({
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Short preview synthesis so the user can hear the chosen voice before connecting.
  // Writes to the workspace like the agent tool does; returns preview/download paths.
  router.post("/preview", async (req: Request, res: Response) => {
    const config2 = configFromBody((req.body ?? {}) as TtsCatalogBody);
    const body = (req.body ?? {}) as TtsCatalogBody;
    const text = (body.text ?? "Hello! This is a preview of the selected voice.").trim().slice(0, 500);
    if (!isTtsConfigured(config2)) {
      res.status(400).json({ error: "TTS is not fully configured — complete the provider setup first." });
      return;
    }
    try {
      const file = await synthesizeSpeechFile(config2, text, config.workspaceRoot, {
        signal: signalFrom(res),
      });
      res.json({
        ok: true,
        file: {
          name: file.name,
          path: toWorkspaceRelative(config.workspaceRoot, file.absolute_path),
          size: file.size,
          content_type: file.content_type,
        },
        provider: file.provider,
        model: file.model,
        voice: file.voice,
      });
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
