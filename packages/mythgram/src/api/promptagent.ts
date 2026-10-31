import { Router, type Request, type Response } from "express";
import type { AppConfig } from "../config.js";
import type { PromptAgentRunner } from "../agents/promptagent/index.js";
import type { RunPromptAgentRequest, PromptAgentMode } from "../agents/promptagent/index.js";
import { SessionEventBuffer } from "../services/eventBuffer.js";
import type { SessionStore, StoredMessage } from "../services/sessionStore.js";
import type { SkillDefinition } from "../agents/tools/types.js";
import { normalizeEffort } from "../agents/providers/reasoning.js";
import { initSSE, formatSSE } from "../utils/sse.js";

/** Extract a string field from an untrusted object. */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sanitizeTemperature(value: unknown): number | undefined {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(num)) return undefined;
  return Math.min(2, Math.max(0, num));
}

function effectiveApiKey(body: StreamBody): string {
  const top = (body.api_key ?? "").trim();
  if (top) return top;
  if (body.custom_provider && typeof body.custom_provider === "object") {
    const custom = body.custom_provider as Record<string, unknown>;
    return str(custom.apiKey);
  }
  return "";
}

function parseMode(value: unknown): PromptAgentMode {
  return typeof value === "string" && value.trim().toLowerCase() === "enhance" ? "enhance" : "create";
}

interface StreamBody {
  chat_id?: string;
  user_message?: string;
  mode?: unknown;
  existing_prompt?: unknown;
  history?: StoredMessage[];
  provider?: string;
  model?: string;
  api_key?: string;
  base_url?: string;
  custom_provider?: unknown;
  temperature?: number;
  effort?: string;
  since_event_id?: number;
  tavily_api_key?: string;
  exa_api_key?: string;
  serpapi_api_key?: string;
  search_provider?: "duckduckgo" | "tavily" | "exa" | "serpapi";
  fetch_provider?: "builtin" | "firecrawl";
  firecrawl_api_key?: string;
  skills?: unknown;
}

/** Defensively coerce the client-provided skill definitions. */
function normalizeSkills(raw: unknown): SkillDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    const skillFile =
      typeof record.skill_file === "string" && record.skill_file.trim().length > 0
        ? record.skill_file.trim()
        : typeof record.skillFile === "string" && record.skillFile.trim().length > 0
          ? record.skillFile.trim()
          : "SKILL.md";
    const rawFiles = Array.isArray(record.files) ? record.files : [];
    const files: Array<{ path: string; content: string }> = [];
    for (const file of rawFiles) {
      if (!file || typeof file !== "object") continue;
      const f = file as Record<string, unknown>;
      const path = typeof f.path === "string" ? f.path.trim() : "";
      if (!path) continue;
      files.push({ path, content: typeof f.content === "string" ? f.content : "" });
    }
    out.push({
      name,
      description: typeof record.description === "string" ? record.description : "",
      skillFile,
      files,
      enabled: record.enabled !== false,
    });
  }
  return out;
}

/**
 * Prompt-agent API — streaming prompt creation / enhancement turns.
 *
 * The agent uses the SAME LLM settings the user is currently using in the app:
 * provider / model / apiKey / baseUrl / temperature / effort travel with every
 * turn request, exactly like chat turns.
 *
 *   POST /api/prompt-agent/stream  start a turn (or reconnect) + stream SSE
 *   POST /api/prompt-agent/abort/:chatId  cancel the running turn
 */
export function buildPromptAgentRouter(
  runner: PromptAgentRunner,
  store: SessionStore,
  _config: AppConfig,
): Router {
  const router = Router();

  router.post("/abort/:chatId", (req: Request, res: Response) => {
    const chatId = String(req.params.chatId);
    const session = store.get(chatId);
    if (!session) {
      res.json({ ok: false });
      return;
    }
    session.abortController?.abort();
    session.eventBuffer?.setDone();
    session.running = false;
    res.json({ ok: true });
  });

  router.post("/stream", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as StreamBody;
    const chatId = body.chat_id?.trim();
    if (!chatId) {
      res.status(400).json({ error: "chat_id is required." });
      return;
    }

    const isLocalProvider = body.provider === "local";
    const startNew = Boolean(
      body.user_message &&
        body.provider &&
        body.model &&
        (body.api_key || Boolean(body.custom_provider) || isLocalProvider),
    );

    if (startNew) {
      const existing = store.get(chatId);
      if (existing?.running) {
        existing.abortController?.abort();
        existing.eventBuffer?.setDone();
      }

      const session = store.getOrCreate(chatId);
      // Prompt-agent turns keep their own lightweight transcript. Prefer the
      // live in-memory messages; fall back to the client-sent history once.
      if (session.messages.length === 0 && Array.isArray(body.history) && body.history.length > 0) {
        session.messages = body.history.map((m) => ({ ...m }));
        session.updatedAt = Date.now();
      }

      const buffer = new SessionEventBuffer();
      const abortController = new AbortController();
      session.eventBuffer = buffer;
      session.abortController = abortController;
      session.running = true;

      const request: RunPromptAgentRequest = {
        chatId,
        userMessage: body.user_message!,
        mode: parseMode(body.mode),
        existingPrompt: typeof body.existing_prompt === "string" ? body.existing_prompt : "",
        provider: body.provider!,
        model: body.model!,
        apiKey: effectiveApiKey(body),
        baseUrl: body.base_url,
        customProvider: body.custom_provider,
        temperature: sanitizeTemperature(body.temperature),
        effort: normalizeEffort(body.effort),
        tavilyApiKey: body.tavily_api_key,
        exaApiKey: body.exa_api_key,
        serpapiApiKey: body.serpapi_api_key,
        searchProvider: body.search_provider,
        fetchProvider: body.fetch_provider,
        firecrawlApiKey: body.firecrawl_api_key,
        skills: normalizeSkills(body.skills),
      };

      void runner
        .run(request, session, buffer, abortController.signal)
        .catch((error) => {
          buffer.append("error", {
            code: "prompt_agent_crashed",
            message: error instanceof Error ? error.message : String(error),
          });
          buffer.setDone();
          session.running = false;
        });

      await streamFromBuffer(res, buffer, body.since_event_id ?? -1);
      return;
    }

    // Reconnect path: attach to an existing buffer and replay.
    const session = store.get(chatId);
    if (session?.eventBuffer) {
      await streamFromBuffer(res, session.eventBuffer, body.since_event_id ?? -1);
      return;
    }

    res.status(400).json({ error: "No active prompt agent run and no user_message provided." });
  });

  return router;
}

async function streamFromBuffer(
  res: Response,
  buffer: SessionEventBuffer,
  sinceId: number,
): Promise<void> {
  initSSE(res);
  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  try {
    for await (const event of buffer.subscribe(sinceId)) {
      if (closed) break;
      res.write(formatSSE(event.event, event.data));
    }
  } catch {
    // client disconnected or buffer ended; fall through to close.
  } finally {
    if (!closed) res.end();
  }
}
