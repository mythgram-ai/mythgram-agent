import path from "node:path";
import { Router, type Request, type Response } from "express";
import { PROJECT_ROOT, type AppConfig } from "../config.js";
import type { MythgramDatabase } from "../database/index.js";
import type { ProviderRegistry } from "../agents/providers/registry.js";
import type { MainAgentPromptManager } from "../agents/mainagentprompt/index.js";
import type { TtsManager } from "../tts/index.js";
import { ACP_AGENT_NAME, ACP_AGENT_TITLE, ACP_AGENT_VERSION, ACP_PROTOCOL_VERSION } from "./types.js";
import { AcpConfigManager } from "./configuration.js";
import { describeTarget, resolveAcpTurn } from "./turn.js";

/**
 * Backend HTTP surface for ACP:
 *   GET  /api/acp          — configuration + status + connection instructions
 *   GET  /api/acp/config   — just the configuration document
 *   PUT  /api/acp/config   — persist the configuration document
 *   GET  /api/acp/turn     — the resolved `/api/chat/stream` body for the current config
 *
 * `GET /api/acp/turn` is consumed by the standalone stdio bridge (see
 * `src/acp/index.ts`); it carries provider credentials because it runs over the
 * local backend, mirroring the trust model of the existing `/api/state` endpoint
 * (which already exposes the same Settings document). No new network exposure.
 */

export interface AcpRouterDeps {
  db: MythgramDatabase;
  appConfig: AppConfig;
  providers: ProviderRegistry;
  mainAgentPrompts: MainAgentPromptManager;
  tts?: TtsManager;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function listNamed(raw: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; name: string }> = [];
  for (const item of raw) {
    const rec = asRecord(item);
    const id = str(rec.id).trim();
    if (!id) continue;
    out.push({ id, name: str(rec.name).trim() || id });
  }
  return out;
}

export function buildAcpRouter(deps: AcpRouterDeps): Router {
  const router = Router();
  const manager = new AcpConfigManager(deps.db.appState);
  const entryPath = path.join(PROJECT_ROOT, "src", "acp", "index.ts");

  const buildStatus = () => {
    const config = manager.get();
    const settings = asRecord(deps.db.appState.get("settings"));
    const customProviders = Array.isArray(deps.db.appState.get("customProviders"))
      ? (deps.db.appState.get("customProviders") as Array<Record<string, unknown>>)
      : [];
    const apiKeys = asRecord(settings.apiKeys);

    const inheritedProvider = str(settings.provider);
    const inheritedModel = str(settings.model);
    const provider = config.provider || inheritedProvider;
    const model = config.model || inheritedModel;
    const customEntry = customProviders.find((p) => str(p.id) === provider);
    const hasApiKey = Boolean(
      config.apiKey.trim() || str(apiKeys[provider]) || (customEntry ? str(customEntry.apiKey) : ""),
    );

    let tts: { providerId: string; providerName: string } | null = null;
    try {
      const selected = deps.tts?.selectProvider() ?? null;
      if (selected) tts = { providerId: selected.id, providerName: selected.name };
    } catch {
      tts = null;
    }

    const customAgents = listNamed(deps.db.appState.get("customAgents"));
    const teams = listNamed(deps.db.appState.get("agentTeams"));
    const ceos = listNamed(deps.db.appState.get("ceoAgents"));
    const target = describeTarget(config, deps.db);

    return {
      config,
      llm: {
        provider,
        model,
        inherited: !config.provider && !config.model,
        hasApiKey,
        ready: Boolean(provider && model && (hasApiKey || provider === "local")),
      },
      tts,
      workspace: deps.appConfig.workspaceRoot,
      customAgents,
      teams,
      ceos,
      selected: target,
    };
  };

  router.get("/config", (_req: Request, res: Response) => {
    res.json({ ok: true, config: manager.get() });
  });

  router.put("/config", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { config?: unknown };
    const raw = body.config ?? body;
    const config = manager.save(raw);
    res.json({ ok: true, config });
  });

  router.get("/turn", async (_req: Request, res: Response) => {
    try {
      const descriptor = await resolveAcpTurn(
        {
          db: deps.db,
          appConfig: deps.appConfig,
          providers: deps.providers,
          mainAgentPrompts: deps.mainAgentPrompts,
        },
        manager.get(),
      );
      res.json({ ok: true, ...descriptor });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/", (_req: Request, res: Response) => {
    const status = buildStatus();
    const port = deps.appConfig.port;
    res.json({
      ok: true,
      ...status,
      connection: {
        transport: "stdio",
        protocolVersion: ACP_PROTOCOL_VERSION,
        command: "npx",
        args: ["--yes", "tsx", entryPath],
        backendUrl: `http://127.0.0.1:${port}`,
        agent: { name: ACP_AGENT_NAME, title: ACP_AGENT_TITLE, version: ACP_AGENT_VERSION },
        entryPath,
      },
    });
  });

  return router;
}
