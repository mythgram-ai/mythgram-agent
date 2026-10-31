import { FALLBACK_PROVIDERS } from "@/lib/providers";
import { AVAILABLE_CONNECTORS } from "@/lib/connectors";
import type { Section } from "@/store/useStore";

export type SearchTarget =
  | { kind: "section"; section: Section }
  | { kind: "conversation"; conversationId: string; messageId?: string }
  | { kind: "settings" }
  | { kind: "provider"; providerId: string }
  | { kind: "model"; providerId: string; modelId: string }
  | { kind: "memory"; path: string }
  | { kind: "knowledge"; path: string }
  | { kind: "subagent"; name: string }
  | { kind: "skill"; name: string }
  | { kind: "team"; teamId: string }
  | { kind: "ceo"; ceoId: string }
  | { kind: "customagent"; agentId: string }
  | { kind: "systemprompt"; promptId: string }
  | { kind: "taskmode"; modeId: string }
  | { kind: "prompt"; promptId: string }
  | { kind: "schedule"; scheduleId: string }
  | { kind: "connector"; connectorId: string }
  | { kind: "mcp"; serverId: string; tool?: string }
  | { kind: "profile"; profileId: string }
  | { kind: "todo"; todoId: string };

export interface SearchResultItem {
  id: string;
  group: string;
  title: string;
  snippet?: string;
  hint?: string;
  target: SearchTarget;
}

export interface SearchState {
  conversations: Array<{
    id: string;
    title: string;
    messages: Array<{ id: string; role: string; content: string }>;
  }>;
  memory: Array<{ path: string; content: string }>;
  knowledge: Array<{ path: string; content: string }>;
  subAgents: Array<{ name: string; description: string; systemPrompt: string }>;
  skills: Array<{
    name: string;
    description: string;
    skillFile: string;
    skillContent: string;
    files: Array<{ path: string; content: string }>;
  }>;
  agentTeams: Array<{
    id: string;
    name: string;
    leaderName: string;
    leaderSystemPrompt: string;
    members: Array<{ name: string; description: string; systemPrompt: string }>;
  }>;
  ceoAgents: Array<{
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    teamIds: string[];
  }>;
  customAgents: Array<{
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    selectedTools: string[];
  }>;
  mainAgentPrompts: Array<{ id: string; name: string; description: string; content: string }>;
  taskModes: Array<{ id: string; name: string; prompt: string }>;
  planModePrompt: string;
  promptLibrary: Array<{ id: string; title: string; description: string; content: string }>;
  schedules: Array<{ id: string; name: string; prompt: string; kind: string; status: string }>;
  connectors: Array<{ connectorId: string; status: string; accountLabel: string }>;
  mcpServers: Array<{
    id: string;
    name: string;
    description: string;
    url: string;
    kind: string;
    status: string;
    cachedTools: Array<{ name: string; description: string }>;
    disabledTools: string[];
  }>;
  providers: Array<{ id: string; label: string; defaultBaseUrl: string }>;
  models: Array<{ id: string; provider: string; label: string }>;
  customProviders: Array<{ id: string; name: string; models: string[]; baseUrl: string }>;
  settings: Record<string, unknown>;
  userProfiles: Array<{ id: string; name: string; description: string }>;
  todos: Array<{ id: string; content: string; status: string; priority: string }>;
}

const SECTION_INDEX: Array<{ section: Section; label: string; keywords: string; hint: string }> = [
  { section: "chat", label: "Chat", keywords: "chat conversation thread message history", hint: "Go to chat" },
  { section: "memory", label: "Memory", keywords: "memory soul user session-memory persistent durable facts preferences", hint: "Go to memory" },
  { section: "knowledge", label: "Knowledge base", keywords: "knowledge docs notes reference sources files", hint: "Go to knowledge" },
  { section: "agents", label: "Sub-agents", keywords: "sub agents specialists delegate assistant helper", hint: "Go to sub-agents" },
  { section: "skills", label: "Skills", keywords: "skills capabilities reusable workflow", hint: "Go to skills" },
  { section: "teams", label: "Agent teams", keywords: "teams multi agent head leader members collaboration", hint: "Go to teams" },
  { section: "ceo", label: "CEO agents", keywords: "ceo organization teams leaders coordinator", hint: "Go to CEO agents" },
  { section: "customagents", label: "Custom agents", keywords: "custom agents main agent persona tools", hint: "Go to custom agents" },
  { section: "systemprompts", label: "Custom system prompts", keywords: "system prompt instructions main agent template", hint: "Go to system prompts" },
  { section: "taskmodes", label: "Task modes", keywords: "task modes plan default custom prompt mode", hint: "Go to task modes" },
  { section: "prompts", label: "Prompt library", keywords: "prompt library saved prompts reusable templates snippets", hint: "Go to prompt library" },
  { section: "slides", label: "Slides", keywords: "slides slide deck presentation templates html 16:9 powerpoint pitch", hint: "Go to slides" },
  { section: "schedules", label: "Schedules", keywords: "schedules cron recurring automation tasks background", hint: "Go to schedules" },
  { section: "connectors", label: "Connectors", keywords: "connectors github slack notion gmail outlook composio apps integration", hint: "Go to connectors" },
  { section: "mcp", label: "MCP servers", keywords: "mcp model context protocol servers tools oauth remote local", hint: "Go to MCP" },
  { section: "channels", label: "Channels", keywords: "channels telegram discord slack whatsapp messaging bot chat adapters", hint: "Go to channels" },
  { section: "acp", label: "ACP", keywords: "acp agent client protocol zed editor external client gateway stdio integration", hint: "Go to ACP" },
  { section: "profiles", label: "Profiles", keywords: "profiles account user identity avatar", hint: "Go to profiles" },
];

const SETTING_OPTIONS: Array<{ key: string; label: string; keywords: string; hint: string }> = [
  { key: "provider", label: "Provider", keywords: "provider llm openrouter groq model vendor", hint: "Open settings → provider" },
  { key: "model", label: "Model", keywords: "model name id selection", hint: "Open settings → model" },
  { key: "apiKeys", label: "API keys", keywords: "api key secret token auth", hint: "Open settings → API keys" },
  { key: "baseUrl", label: "Base URL", keywords: "base url endpoint local ollama lm studio", hint: "Open settings → base URL" },
  { key: "searchProvider", label: "Search provider", keywords: "search duckduckgo tavily exa serpapi web", hint: "Open settings → search" },
  { key: "fetchProvider", label: "Fetch provider", keywords: "fetch scrape builtin firecrawl crawl", hint: "Open settings → fetch" },
  { key: "composioApiKey", label: "Composio API key", keywords: "composio connectors github slack", hint: "Open settings → Composio" },
  { key: "effort", label: "Reasoning effort", keywords: "reasoning effort low medium high max thinking", hint: "Open settings → effort" },
  { key: "temperature", label: "Temperature", keywords: "temperature sampling creativity", hint: "Open settings → temperature" },
  { key: "enableReuseSubAgentSession", label: "Reuse sub-agent sessions", keywords: "reuse sub agent session continue", hint: "Open settings" },
  { key: "enableAgentTeams", label: "Enable agent teams", keywords: "teams multi agent enable", hint: "Open settings" },
  { key: "enableSendMessageToTeam", label: "Agent-to-agent messaging", keywords: "send message team peer", hint: "Open settings" },
  { key: "enableCeoAgents", label: "Enable CEO agents", keywords: "ceo enable organization", hint: "Open settings" },
  { key: "memoryAgentEnabled", label: "Memory agent", keywords: "memory agent background enable", hint: "Open settings" },
  { key: "memoryAgentInterval", label: "Memory agent interval", keywords: "memory interval tasks", hint: "Open settings" },
  { key: "agentMode", label: "Agent / chat mode", keywords: "agent chat mode conversational", hint: "Switch mode in sidebar" },
];

function norm(s: unknown): string {
  return typeof s === "string" ? s.toLowerCase() : "";
}

function includes(haystack: string, needle: string): boolean {
  return haystack.includes(needle);
}

function matchScore(text: string, q: string): number {
  if (!q) return 0;
  if (text.startsWith(q)) return 3;
  if (text.includes(` ${q}`) || text.includes(`/${q}`) || text.includes(`-${q}`)) return 2;
  if (text.includes(q)) return 1;
  return 0;
}

function snippetAround(content: string, q: string, radius = 64): string {
  const lower = content.toLowerCase();
  const at = lower.indexOf(q);
  if (at === -1) return content.slice(0, 120);
  const start = Math.max(0, at - radius);
  const end = Math.min(content.length, at + q.length + radius);
  const prefix = start > 0 ? "… " : "";
  const suffix = end < content.length ? " …" : "";
  return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

export function searchEverything(rawQuery: string, state: SearchState): SearchResultItem[] {
  const q = rawQuery.trim().toLowerCase();
  if (q.length === 0) return [];
  const out: SearchResultItem[] = [];
  const push = (item: SearchResultItem, score: number) => {
    if (score > 0) out.push(item);
  };

  // Sections / navigation
  for (const s of SECTION_INDEX) {
    const hay = `${s.label} ${s.keywords}`.toLowerCase();
    const score = Math.max(matchScore(hay, q), matchScore(s.label.toLowerCase(), q));
    if (score > 0) {
      push(
        {
          id: `section-${s.section}`,
          group: "Navigate",
          title: s.label,
          snippet: s.keywords.slice(0, 90),
          hint: s.hint,
          target: { kind: "section", section: s.section },
        },
        score,
      );
    }
  }

  // Settings options
  for (const o of SETTING_OPTIONS) {
    const hay = `${o.label} ${o.keywords} ${o.key}`.toLowerCase();
    const score = matchScore(hay, q);
    if (score > 0) {
      push(
        {
          id: `setting-${o.key}`,
          group: "Settings",
          title: o.label,
          snippet: o.keywords.slice(0, 90),
          hint: o.hint,
          target: { kind: "settings" },
        },
        score,
      );
    }
  }

  // Providers (live + fallback so search works before first fetch)
  const providerList =
    state.providers.length > 0
      ? state.providers
      : FALLBACK_PROVIDERS.map((p) => ({ id: p.id, label: p.label, defaultBaseUrl: p.defaultBaseUrl }));
  for (const p of providerList) {
    const hay = `${p.id} ${p.label} ${p.defaultBaseUrl}`.toLowerCase();
    const score = matchScore(hay, q);
    if (score > 0) {
      push(
        {
          id: `provider-${p.id}`,
          group: "Providers",
          title: `${p.label} (${p.id})`,
          snippet: p.defaultBaseUrl,
          hint: "Open settings → provider",
          target: { kind: "provider", providerId: p.id },
        },
        score + 1,
      );
    }
  }

  // Models (currently loaded) + custom provider models
  for (const m of state.models.slice(0, 500)) {
    const hay = `${m.id} ${m.label} ${m.provider}`.toLowerCase();
    const score = matchScore(hay, q);
    if (score > 0) {
      push(
        {
          id: `model-${m.provider}-${m.id}`,
          group: "Models",
          title: m.label || m.id,
          snippet: `provider: ${m.provider} · ${m.id}`,
          hint: "Use this model",
          target: { kind: "model", providerId: m.provider, modelId: m.id },
        },
        score + 1,
      );
      if (out.length > 220) break;
    }
  }
  for (const cp of state.customProviders) {
    for (const modelId of cp.models ?? []) {
      const hay = `${modelId} ${cp.name} custom`.toLowerCase();
      if (matchScore(hay, q) > 0) {
        push(
          {
            id: `model-custom-${cp.id}-${modelId}`,
            group: "Models",
            title: `${modelId} (${cp.name})`,
            snippet: `custom provider: ${cp.name}`,
            hint: "Use this model",
            target: { kind: "model", providerId: cp.id, modelId },
          },
          2,
        );
      }
    }
    const hayCp = `${cp.name} ${cp.baseUrl} custom provider`.toLowerCase();
    if (matchScore(hayCp, q) > 0) {
      push(
        {
          id: `provider-custom-${cp.id}`,
          group: "Providers",
          title: `${cp.name} (custom)`,
          snippet: cp.baseUrl,
          hint: "Open settings → provider",
          target: { kind: "provider", providerId: cp.id },
        },
        2,
      );
    }
  }

  // Conversations (titles)
  for (const c of state.conversations.slice(0, 300)) {
    const hay = norm(c.title);
    const score = matchScore(hay, q);
    if (score > 0) {
      push(
        {
          id: `chat-${c.id}`,
          group: "Chats",
          title: c.title || "Untitled thread",
          snippet: `${c.messages.length} messages`,
          hint: "Open thread",
          target: { kind: "conversation", conversationId: c.id },
        },
        score + 1,
      );
    }
    // Messages content (cap per conversation for speed)
    for (const m of c.messages.slice(-60)) {
      const body = norm(m.content);
      if (!body || !includes(body, q)) continue;
      push(
        {
          id: `msg-${c.id}-${m.id}`,
          group: "Messages",
          title: c.title || "Thread message",
          snippet: snippetAround(m.content, q),
          hint: m.role === "user" ? "Go to user message" : "Go to assistant message",
          target: { kind: "conversation", conversationId: c.id, messageId: m.id },
        },
        1,
      );
      if (out.length > 260) break;
    }
    if (out.length > 260) break;
  }

  // Memory
  for (const f of state.memory) {
    const hay = `${f.path} ${f.content}`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `memory-${f.path}`,
        group: "Memory",
        title: `memory/${f.path}`,
        snippet: snippetAround(f.content || f.path, q),
        hint: "Open memory",
        target: { kind: "memory", path: f.path },
      },
      2,
    );
  }

  // Knowledge
  for (const f of state.knowledge) {
    const hay = `${f.path} ${f.content}`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `knowledge-${f.path}`,
        group: "Knowledge",
        title: `knowledge/${f.path}`,
        snippet: snippetAround(f.content || f.path, q),
        hint: "Open knowledge",
        target: { kind: "knowledge", path: f.path },
      },
      2,
    );
  }

  // Sub-agents
  for (const a of state.subAgents) {
    const hay = `${a.name} ${a.description} ${a.systemPrompt}`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `subagent-${a.name}`,
        group: "Sub-agents",
        title: a.name,
        snippet: a.description.slice(0, 120),
        hint: "Open sub-agents",
        target: { kind: "subagent", name: a.name },
      },
      2,
    );
  }

  // Skills
  for (const s of state.skills) {
    const hay = `${s.name} ${s.description} ${s.skillContent} ${s.files.map((f) => `${f.path} ${f.content}`).join(" ")}`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `skill-${s.name}`,
        group: "Skills",
        title: s.name,
        snippet: s.description.slice(0, 120),
        hint: "Open skills",
        target: { kind: "skill", name: s.name },
      },
      2,
    );
  }

  // Teams
  for (const t of state.agentTeams) {
    const hay = `${t.name} ${t.leaderName} ${t.leaderSystemPrompt} ${t.members.map((m) => `${m.name} ${m.description}`).join(" ")}`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `team-${t.id}`,
        group: "Teams",
        title: `${t.name} (lead: ${t.leaderName})`,
        snippet: `${t.members.length} members`,
        hint: "Open teams",
        target: { kind: "team", teamId: t.id },
      },
      2,
    );
  }

  // CEOs
  for (const c of state.ceoAgents) {
    const hay = `${c.name} ${c.description} ${c.systemPrompt}`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `ceo-${c.id}`,
        group: "CEO agents",
        title: c.name,
        snippet: c.description.slice(0, 120),
        hint: "Open CEO agents",
        target: { kind: "ceo", ceoId: c.id },
      },
      2,
    );
  }

  // Custom agents
  for (const a of state.customAgents) {
    const hay = `${a.name} ${a.description} ${a.systemPrompt} ${a.selectedTools.join(" ")}`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `customagent-${a.id}`,
        group: "Custom agents",
        title: a.name,
        snippet: a.description.slice(0, 120),
        hint: "Open custom agents",
        target: { kind: "customagent", agentId: a.id },
      },
      2,
    );
  }

  // System prompts
  for (const p of state.mainAgentPrompts) {
    const hay = `${p.name} ${p.description} ${p.content}`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `sysprompt-${p.id}`,
        group: "System prompts",
        title: p.name,
        snippet: p.description.slice(0, 120) || p.content.slice(0, 120),
        hint: "Open system prompts",
        target: { kind: "systemprompt", promptId: p.id },
      },
      2,
    );
  }

  // Task modes
  for (const m of state.taskModes) {
    const hay = `${m.name} ${m.prompt}`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `taskmode-${m.id}`,
        group: "Task modes",
        title: m.name,
        snippet: m.prompt.slice(0, 120),
        hint: "Open task modes",
        target: { kind: "taskmode", modeId: m.id },
      },
      2,
    );
  }
  if (includes(`plan mode ${state.planModePrompt}`.toLowerCase(), q)) {
    push(
      {
        id: "taskmode-plan",
        group: "Task modes",
        title: "Plan mode",
        snippet: state.planModePrompt.slice(0, 120),
        hint: "Open task modes",
        target: { kind: "taskmode", modeId: "plan" },
      },
      1,
    );
  }

  // Saved prompts (prompt library)
  for (const p of state.promptLibrary ?? []) {
    const hay = `${p.title} ${p.description} ${p.content}`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `prompt-${p.id}`,
        group: "Prompts",
        title: p.title,
        snippet: (p.description || p.content).slice(0, 120),
        hint: "Open prompt library",
        target: { kind: "prompt", promptId: p.id },
      },
      2,
    );
  }

  // Connectors (catalog + status)
  for (const meta of AVAILABLE_CONNECTORS) {
    const stored = state.connectors.find((c) => c.connectorId === meta.id);
    const hay = `${meta.name} ${meta.description} ${meta.id} connector ${stored?.status ?? ""} ${stored?.accountLabel ?? ""}`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `connector-${meta.id}`,
        group: "Connectors",
        title: `${meta.name} — ${stored?.status ?? "disconnected"}`,
        snippet: meta.description,
        hint: "Open connectors",
        target: { kind: "connector", connectorId: meta.id },
      },
      2,
    );
  }

  // MCP servers + tools
  for (const s of state.mcpServers) {
    const hayServer = `${s.name} ${s.description} ${s.url} ${s.kind} ${s.status} mcp`.toLowerCase();
    if (includes(hayServer, q)) {
      push(
        {
          id: `mcp-${s.id}`,
          group: "MCP",
          title: `${s.name} (${s.status})`,
          snippet: s.description.slice(0, 120) || s.url,
          hint: "Open MCP",
          target: { kind: "mcp", serverId: s.id },
        },
        2,
      );
    }
    for (const t of s.cachedTools ?? []) {
      const hayTool = `${t.name} ${t.description}`.toLowerCase();
      if (!includes(hayTool, q)) continue;
      push(
        {
          id: `mcp-tool-${s.id}-${t.name}`,
          group: "MCP tools",
          title: `${t.name} (on ${s.name})`,
          snippet: t.description.slice(0, 120),
          hint: "Open MCP",
          target: { kind: "mcp", serverId: s.id, tool: t.name },
        },
        1,
      );
    }
  }

  // Profiles
  for (const p of state.userProfiles) {
    const hay = `${p.name} ${p.description} profile`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `profile-${p.id}`,
        group: "Profiles",
        title: p.name,
        snippet: p.description.slice(0, 120),
        hint: "Open profiles",
        target: { kind: "profile", profileId: p.id },
      },
      2,
    );
  }

  // Schedules
  for (const s of state.schedules) {
    const hay = `${s.name} ${s.prompt} ${s.kind} ${s.status} schedule cron`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `schedule-${s.id}`,
        group: "Schedules",
        title: s.name,
        snippet: `${s.kind} · ${s.status}`,
        hint: "Open schedules",
        target: { kind: "schedule", scheduleId: s.id },
      },
      2,
    );
  }

  // Todos
  for (const t of state.todos) {    const hay = `${t.content} ${t.status} ${t.priority} todo`.toLowerCase();
    if (!includes(hay, q)) continue;
    push(
      {
        id: `todo-${t.id}`,
        group: "Todos",
        title: t.content.slice(0, 80),
        snippet: `${t.status} · ${t.priority}`,
        hint: "Open chat (todos live on tool blocks)",
        target: { kind: "todo", todoId: t.id },
      },
      1,
    );
  }

  return out.slice(0, 120);
}
