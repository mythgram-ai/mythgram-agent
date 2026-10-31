import type { AppConfig } from "../config.js";
import type { MythgramDatabase } from "../database/index.js";
import type { MainAgentPromptManager } from "../agents/mainagentprompt/index.js";
import { normalizeEffort } from "../agents/providers/reasoning.js";
import { manualContextLimit } from "../agents/contextLimits.js";
import { normalizeMemoryFiles } from "../agents/memory.js";
import { normalizeKnowledgeFiles } from "../agents/knowledge.js";
import { normalizeTodos } from "../agents/todos.js";
import type { ConnectorWire } from "../agents/connectors/index.js";
import type { McpServerSelection } from "../agents/mcp/index.js";
import type {
  KnowledgeFile,
  MemoryFile,
  SkillDefinition,
  SubAgentDefinition,
  TodoItem,
} from "../agents/tools/types.js";

/**
 * Provider credentials + shared tooling snapshot resolved from the persisted
 * app-state documents at execution time (the same documents the frontend syncs),
 * so a channel turn behaves like a turn the user started themselves in the app.
 * Mirrors the schedule runner's context resolution.
 */
export interface ChannelRunContext {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  customProvider?: unknown;
  temperature?: number;
  effort?: string;
  searchProvider: "duckduckgo" | "tavily" | "exa" | "serpapi";
  fetchProvider: "builtin" | "firecrawl";
  tavilyApiKey?: string;
  exaApiKey?: string;
  serpapiApiKey?: string;
  firecrawlApiKey?: string;
  composioApiKey?: string;
  connectors: ConnectorWire[];
  /** Undefined = every enabled MCP server (same as chat turns). */
  mcpServers?: McpServerSelection[];
  subAgents: SubAgentDefinition[];
  skills: SkillDefinition[];
  todos: TodoItem[];
  memory: MemoryFile[];
  knowledge: KnowledgeFile[];
  memoryAgentEnabled: boolean;
  memoryAgentInterval: number;
  /** Active Main Agent custom prompt text (null = built-in prompt). */
  systemPromptOverride: string | null;
  /**
   * Effective context-window limit (tokens) for automatic summarization
   * handoff. Resolved synchronously here from the user's manual Settings
   * entry when present; the runner upgrades a null to the cached provider
   * catalog before the turn starts. Null = handoff disabled (safe).
   */
  contextLimit: number | null;
  /**
   * Utilization fraction (0..1) triggering summarization. Server default,
   * identical to web turns without a per-turn override.
   */
  summaryThreshold: number;
  /** Context-management method from Settings ("summarization" default). */
  contextManagementMethod?: string;
  /** Fraction freed per sliding-window trigger (default 0.3). */
  slidingWindowTruncatePercent?: number;
}

/**
 * Resolve the execution context for a channel turn. Secrets always come from the
 * current Settings document so key rotations apply without re-editing channels.
 * Never throws for missing settings — callers validate provider/model/apiKey.
 */
export function resolveChannelRunContext(
  db: MythgramDatabase,
  config: AppConfig,
  mainAgentPrompts: MainAgentPromptManager,
): ChannelRunContext {
  const settings = asRecord(db.appState.get("settings"));
  const customProviders = db.appState.get("customProviders");

  const provider = str(settings.provider) || "openrouter";
  const model = str(settings.model);

  const apiKeys = asRecord(settings.apiKeys);
  const customList: Array<Record<string, unknown>> = Array.isArray(customProviders)
    ? (customProviders as Array<Record<string, unknown>>)
    : [];
  const customEntry = customList.find((p) => str(p.id) === provider);

  let apiKey = str(apiKeys[provider]);
  let baseUrl: string | undefined = str(settings.baseUrl) || undefined;
  let customProvider: unknown;
  if (provider.startsWith("custom_") || customEntry) {
    const headers: Record<string, string> = {};
    const rawHeaders = customEntry ? customEntry.headers : undefined;
    if (Array.isArray(rawHeaders)) {
      for (const pair of rawHeaders) {
        const rec = pair as Record<string, unknown>;
        if (typeof rec.key === "string" && rec.key.trim()) headers[rec.key.trim()] = str(rec.value);
      }
    }
    customProvider = {
      id: provider,
      name: customEntry ? str(customEntry.name) : provider,
      model,
      baseUrl: customEntry ? str(customEntry.baseUrl) : "",
      apiKey: customEntry ? str(customEntry.apiKey) : "",
      headers,
    };
    const customKey = customEntry ? str(customEntry.apiKey) : "";
    if (customKey) apiKey = customKey;
    baseUrl = undefined;
  }

  const connectors: ConnectorWire[] = [];
  const storedConnectors = db.appState.get("connectors");
  if (Array.isArray(storedConnectors)) {
    for (const item of storedConnectors) {
      const rec = item as Record<string, unknown>;
      const connectorId = str(rec.connectorId ?? rec.connector_id).trim().toLowerCase();
      const connectedAccountId = str(rec.connectedAccountId ?? rec.connected_account_id).trim();
      if (connectorId && connectedAccountId && rec.status === "active") {
        connectors.push({ connectorId: connectorId as ConnectorWire["connectorId"], connectedAccountId });
      }
    }
  }

  return {
    provider,
    model,
    apiKey,
    baseUrl,
    customProvider,
    temperature: numOrUndefined(settings.temperature),
    effort: normalizeEffort(settings.effort) ?? normalizeEffort("high"),
    searchProvider: normalizeSearchProvider(settings.searchProvider, config.searchProvider),
    fetchProvider: settings.fetchProvider === "firecrawl" ? "firecrawl" : "builtin",
    tavilyApiKey: str(settings.tavilyApiKey) || config.tavilyApiKey || undefined,
    exaApiKey: str(settings.exaApiKey) || config.exaApiKey || undefined,
    serpapiApiKey: str(settings.serpapiApiKey) || config.serpapiApiKey || undefined,
    firecrawlApiKey: str(settings.firecrawlApiKey) || config.firecrawlApiKey || undefined,
    composioApiKey: str(settings.composioApiKey) || config.composioApiKey || undefined,
    connectors,
    mcpServers: undefined,
    subAgents: normalizeSubAgentList(db.appState.get("subAgents")),
    skills: normalizeSkillList(db.appState.get("skills")),
    todos: normalizeTodos(db.appState.get("todos")),
    memory: normalizeMemoryFiles(db.appState.get("memory")),
    knowledge: normalizeKnowledgeFiles(db.appState.get("knowledge")),
    memoryAgentEnabled: parseMemoryAgentEnabled(settings.memoryAgentEnabled, config.memoryAgentEnabled),
    memoryAgentInterval: parseMemoryAgentInterval(settings.memoryAgentInterval, config.memoryAgentInterval),
    systemPromptOverride: mainAgentPrompts.getActivePromptText(),
    contextLimit: manualContextLimit(settings.manualContextLimits, provider, model),
    summaryThreshold: config.summaryThreshold ?? 0.9,
    contextManagementMethod: normalizeChannelContextMethod(settings.contextManagementMethod),
    slidingWindowTruncatePercent: normalizeChannelTruncatePercent(
      settings.slidingWindowTruncatePercent,
      config.slidingWindowTruncatePercent,
    ),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numOrUndefined(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(2, Math.max(0, n));
}

function normalizeSearchProvider(
  value: unknown,
  fallback: "duckduckgo" | "tavily" | "exa" | "serpapi",
): "duckduckgo" | "tavily" | "exa" | "serpapi" {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "tavily" || v === "exa" || v === "serpapi") return v;
  if (v === "duckduckgo") return v;
  return fallback;
}

function parseMemoryAgentEnabled(value: unknown, fallback: boolean): boolean {
  if (value === false || value === "no" || value === "off" || value === 0) return false;
  if (value === true || value === "yes" || value === "on" || value === 1) return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "no" || v === "off" || v === "false") return false;
    if (v === "yes" || v === "on" || v === "true") return true;
  }
  return fallback;
}

function parseMemoryAgentInterval(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

function normalizeChannelContextMethod(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "sliding_window" || v === "sliding-window" || v === "window") return "sliding_window";
  if (v === "summarization" || v === "summarisation" || v === "auto" || v === "summary") {
    return "summarization";
  }
  return undefined;
}

function normalizeChannelTruncatePercent(value: unknown, fallback?: number): number | undefined {
  const n =
    typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (Number.isFinite(n) && n > 0) {
    const fraction = n > 1 ? n / 100 : n;
    if (Number.isFinite(fraction)) return Math.min(0.9, Math.max(0.05, fraction));
  }
  if (typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0) return fallback;
  return undefined;
}

function normalizeSubAgentList(raw: unknown): SubAgentDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: SubAgentDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name).trim();
    if (!name) continue;
    const systemPrompt = str(r.system_prompt) || str(r.systemPrompt);
    const tools = Array.isArray(r.tools) ? r.tools.filter((t): t is string => typeof t === "string") : [];
    out.push({
      name,
      description: str(r.description),
      system_prompt: systemPrompt,
      tools,
      enabled: r.enabled !== false,
    });
  }
  return out;
}

function normalizeSkillList(raw: unknown): SkillDefinition[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name).trim();
    if (!name) continue;
    const skillFile = str(r.skill_file) || str(r.skillFile) || "SKILL.md";
    const files: Array<{ path: string; content: string }> = [];
    if (Array.isArray(r.files)) {
      for (const f of r.files) {
        if (!f || typeof f !== "object") continue;
        const fr = f as Record<string, unknown>;
        const p = str(fr.path).trim();
        if (!p) continue;
        files.push({ path: p, content: str(fr.content) });
      }
    }
    out.push({
      name,
      description: str(r.description),
      skillFile,
      files,
      enabled: r.enabled !== false,
    });
  }
  return out;
}
