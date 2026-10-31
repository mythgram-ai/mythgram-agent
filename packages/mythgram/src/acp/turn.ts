import type { AppConfig } from "../config.js";
import type { MythgramDatabase } from "../database/index.js";
import type { ProviderRegistry } from "../agents/providers/registry.js";
import type { MainAgentPromptManager } from "../agents/mainagentprompt/index.js";
import { resolveChannelRunContext, type ChannelRunContext } from "../channels/context.js";
import { catalogContextLimit } from "../agents/contextLimits.js";
import type { AcpConfig, AcpMode, AcpTurnDescriptor } from "./types.js";

/**
 * Resolve the ACP configuration + the persisted app-state documents into the
 * exact `/api/chat/stream` request body the web console would send. The backend
 * therefore runs ACP turns through the SAME runtime paths as web turns — the
 * built-in Main Agent, Custom Agents, agent teams, CEO systems, the two context
 * management methods, the background memory agent, connectors, MCP servers and
 * the app's TTS configuration all behave identically.
 *
 * No secrets are invented here: provider keys/custom providers are read from the
 * same `settings`/`customProviders` documents the console writes, unless the ACP
 * panel explicitly overrides them.
 */

export interface AcpTurnDeps {
  db: MythgramDatabase;
  appConfig: AppConfig;
  providers: ProviderRegistry;
  mainAgentPrompts: MainAgentPromptManager;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function arr(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

/** Convert the frontend team shape (camelCase) into the wire team definition (snake_case). */
function toWireTeam(team: Record<string, unknown>): Record<string, unknown> {
  const members = arr(team.members)
    .map((m) => ({
      name: str(m.name).trim(),
      description: str(m.description),
      system_prompt: str(m.systemPrompt),
    }))
    .filter((m) => m.name.length > 0);
  return {
    id: str(team.id) || "team",
    name: str(team.name) || "Agent team",
    leader_name: str(team.leaderName).trim(),
    leader_system_prompt: str(team.leaderSystemPrompt),
    members,
  };
}

function findTeam(teams: Array<Record<string, unknown>>, id: string): Record<string, unknown> | null {
  const key = id.trim().toLowerCase();
  return teams.find((t) => str(t.id).trim().toLowerCase() === key) ?? null;
}

/** Resolve a CEO's selected team ids into full wire team definitions. */
function toWireCeo(ceo: Record<string, unknown>, teams: Array<Record<string, unknown>>): Record<string, unknown> | null {
  const ids = Array.isArray(ceo.teamIds) ? ceo.teamIds.filter((t): t is string => typeof t === "string") : [];
  const resolved: Array<Record<string, unknown>> = [];
  for (const teamId of ids) {
    const team = findTeam(teams, teamId);
    if (team) resolved.push(toWireTeam(team));
  }
  if (resolved.length === 0) return null;
  return {
    id: str(ceo.id) || "ceo",
    name: str(ceo.name),
    description: str(ceo.description),
    system_prompt: str(ceo.systemPrompt),
    teams: resolved,
  };
}

/**
 * Rebuild the frontend Skill[] document into the wire skill definitions, keeping the
 * entry file's content (stored separately as `skillContent`) so skills materialize
 * with their SKILL.md exactly like a web turn.
 */
function buildSkills(raw: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const item of arr(raw)) {
    const name = str(item.name).trim();
    if (!name || item.enabled === false) continue;
    const skillFile = str(item.skillFile).trim() || "SKILL.md";
    const files: Array<{ path: string; content: string }> = [
      { path: skillFile, content: str(item.skillContent) },
      ...arr(item.files)
        .map((f) => ({ path: str(f.path).trim(), content: str(f.content) }))
        .filter((f) => f.path.length > 0),
    ];
    out.push({
      name,
      description: str(item.description),
      skill_file: skillFile,
      files,
      enabled: true,
    });
  }
  return out;
}

/** Resolve provider credentials, honoring the ACP panel's optional LLM override. */
function resolveLlm(
  settings: Record<string, unknown>,
  customProviders: Array<Record<string, unknown>>,
  acp: AcpConfig,
  base: ChannelRunContext,
): { provider: string; model: string; apiKey: string; baseUrl?: string; customProvider?: unknown } {
  const provider = acp.provider.trim() || base.provider;
  const model = acp.model.trim() || base.model;
  if (provider === base.provider) {
    return {
      provider,
      model,
      apiKey: acp.apiKey.trim() || base.apiKey,
      baseUrl: acp.baseUrl.trim() || base.baseUrl,
      customProvider: base.customProvider,
    };
  }

  const apiKeys = asRecord(settings.apiKeys);
  const customEntry = customProviders.find((p) => str(p.id) === provider);
  if (provider.startsWith("custom_") || customEntry) {
    const headers: Record<string, string> = {};
    if (customEntry && Array.isArray(customEntry.headers)) {
      for (const pair of customEntry.headers) {
        const rec = asRecord(pair);
        const key = str(rec.key).trim();
        if (key) headers[key] = str(rec.value);
      }
    }
    const apiKey = acp.apiKey.trim() || (customEntry ? str(customEntry.apiKey) : "");
    return {
      provider,
      model,
      apiKey,
      baseUrl: undefined,
      customProvider: {
        id: provider,
        name: customEntry ? str(customEntry.name) : provider,
        model,
        baseUrl: acp.baseUrl.trim() || (customEntry ? str(customEntry.baseUrl) : ""),
        apiKey,
        headers,
      },
    };
  }

  return {
    provider,
    model,
    apiKey: acp.apiKey.trim() || str(apiKeys[provider]),
    baseUrl: acp.baseUrl.trim() || str(settings.baseUrl) || undefined,
    customProvider: undefined,
  };
}

/** Candidate labels for the panel: the configured ACP target with a friendly name. */
export function describeTarget(acp: AcpConfig, db: MythgramDatabase): { mode: AcpMode; label: string } {
  const customAgents = arr(db.appState.get("customAgents"));
  const teams = arr(db.appState.get("agentTeams"));
  if (acp.mode === "chat") return { mode: "chat", label: "Chat mode" };
  if (acp.mode === "custom") {
    const agent = customAgents.find((a) => str(a.id) === acp.customAgentId);
    if (agent) return { mode: "custom", label: str(agent.name) || "Custom Agent" };
  } else if (acp.mode === "team") {
    const team = findTeam(teams, acp.teamId);
    if (team) return { mode: "team", label: str(team.name) || "Agent team" };
  } else if (acp.mode === "ceo") {
    const ceo = arr(db.appState.get("ceoAgents")).find((c) => str(c.id) === acp.ceoId);
    if (ceo) return { mode: "ceo", label: str(ceo.name) || "CEO agent" };
  }
  return { mode: "default", label: "Default Agent" };
}

/**
 * Build the complete `/api/chat/stream` body for one ACP turn. Throws a descriptive
 * Error when no provider/model is configured (the caller turns that into a friendly
 * message back to the ACP client).
 */
export async function resolveAcpTurn(deps: AcpTurnDeps, acp: AcpConfig): Promise<AcpTurnDescriptor> {
  const { db, appConfig, providers, mainAgentPrompts } = deps;
  const settings = asRecord(db.appState.get("settings"));
  const customProviders = arr(db.appState.get("customProviders"));
  const base = resolveChannelRunContext(db, appConfig, mainAgentPrompts);

  const llm = resolveLlm(settings, customProviders, acp, base);
  if (!llm.provider || !llm.model) {
    throw new Error(
      "No LLM provider/model is configured. Open the Mythgram app Settings, connect a provider and pick a model first.",
    );
  }
  if (!llm.apiKey && llm.provider !== "local" && !llm.customProvider) {
    throw new Error(
      `No API key is configured for provider "${llm.provider}". Add one in the app Settings (or set an override in the ACP panel).`,
    );
  }

  // Context management (summarization handoff or sliding window) — ACP override wins,
  // otherwise the app Settings value; the catalog-resolved window fills a missing limit.
  const contextMethod =
    acp.contextManagementMethod === "inherit"
      ? (base.contextManagementMethod ?? "summarization")
      : acp.contextManagementMethod;
  const summaryThreshold = acp.summaryThreshold ?? base.summaryThreshold ?? 0.9;
  const truncatePercent = acp.slidingWindowTruncatePercent ?? base.slidingWindowTruncatePercent ?? 0.3;
  let contextLimit = acp.contextLimit ?? base.contextLimit;
  if (contextLimit === null) {
    contextLimit = await catalogContextLimit({
      providers,
      provider: llm.provider,
      model: llm.model,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      customProvider: llm.customProvider,
    });
  }

  const memoryEnabled = acp.memoryAgent === "inherit" ? base.memoryAgentEnabled : acp.memoryAgent === "on";
  const memoryInterval = acp.memoryAgentInterval ?? base.memoryAgentInterval;

  // Resolve the chosen runtime target.
  const customAgents = arr(db.appState.get("customAgents"));
  const teams = arr(db.appState.get("agentTeams"));
  const ceos = arr(db.appState.get("ceoAgents"));
  const target = describeTarget(acp, db);

  const chatMode = target.mode === "chat";
  const customAgentId =
    target.mode === "custom" ? (str(customAgents.find((a) => str(a.id) === acp.customAgentId)?.id) || undefined) : undefined;
  const agentTeam = target.mode === "team" ? toWireTeam(findTeam(teams, acp.teamId) ?? {}) : undefined;
  const ceoAgent = target.mode === "ceo" ? toWireCeo(ceos.find((c) => str(c.id) === acp.ceoId) ?? {}, teams) : undefined;
  const multiAgent = target.mode === "team" && Boolean(agentTeam);
  const ceoMode = target.mode === "ceo" && Boolean(ceoAgent);

  // The default Main Agent honors its active custom system prompt; every other
  // runtime supplies its own prompts and ignores the override.
  const usesMainPrompt = !chatMode && !customAgentId && !multiAgent && !ceoMode;

  const body: Record<string, unknown> = {
    provider: llm.provider,
    model: llm.model,
    api_key: llm.apiKey,
    base_url: llm.baseUrl,
    custom_provider: llm.customProvider,
    temperature: acp.temperature ?? base.temperature,
    effort: acp.effort.trim() || base.effort,
    tavily_api_key: base.tavilyApiKey,
    exa_api_key: base.exaApiKey,
    serpapi_api_key: base.serpapiApiKey,
    search_provider: base.searchProvider,
    fetch_provider: base.fetchProvider,
    firecrawl_api_key: base.firecrawlApiKey,
    sub_agents: base.subAgents,
    skills: buildSkills(db.appState.get("skills")),
    todos: base.todos,
    memory: base.memory,
    knowledge: base.knowledge,
    enable_reuse_sub_agent_session: false,
    composio_api_key: base.composioApiKey,
    connectors: base.connectors,
    memory_agent_enabled: memoryEnabled,
    memory_agent_interval: memoryInterval,
    system_prompt_override: usesMainPrompt ? (base.systemPromptOverride ?? undefined) : undefined,
    context_limit: contextLimit ?? undefined,
    summary_threshold: summaryThreshold,
    context_management_method: contextMethod,
    sliding_window_truncate_percent: truncatePercent,
    chat_mode: chatMode,
    agent_mode: chatMode ? "chat" : "agent",
    multi_agent: multiAgent,
    agent_team: agentTeam,
    enable_send_message_to_team: str(settings.enableSendMessageToTeam) === "yes",
    ceo_mode: ceoMode,
    ceo_agent: ceoAgent,
    custom_agent_id: customAgentId,
  };

  return { body, mode: target.mode, label: target.label };
}
