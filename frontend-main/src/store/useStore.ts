import { create } from "zustand";
import type {
  AgentMode,
  AgentTeam,
  AskQuestionInfo,
  AskQuestionStatus,
  AttachedFile,
  BrowserPreview,
  ChatMessage,
  Conversation,
  CeoAgent,
  ChannelConnection,
  ConnectorConnection,
  CustomAgent,
  CustomProvider,
  CustomTaskMode,
  FetchProvider,
  KnowledgeFile,
  KnowledgeSource,
  MainAgentPrompt,
  McpServer,
  MainContextUsage,
  AgentContextUsage,
  SubAgentContextEntry,
  TeamAgentContextEntry,
  MemoryAgentLiveRun,
  MemoryAgentRunCounts,
  MemoryAgentRunMeta,
  MemoryFile,
  ModelInfo,
  PlanApprovalStatus,
  PromptLibraryItem,
  ProviderMeta,
  SearchProvider,
  Settings,
  Skill,
  SubAgent,
  SubAgentRun,
  SubAgentSummaryInfo,
  SummaryHandoffInfo,
  SummaryHandoffStatus,
  TeamAgentBlock,
  TeamAgentRole,
  TeamAgentSegment,
  TeamAgentStatus,
  TeamMessageKind,
  TeamRunState,
  TodoItem,
  ToolActivity,
  UserProfile,
} from "@/types";
import { uid, newSessionId } from "@/utils/id";
import type { Schedule } from "@/lib/schedules";
import type { BackendBootPayload } from "@/lib/backendState";
import { forkSessionData } from "@/lib/backendState";
import { CUSTOM_PROVIDER_PREFIX } from "@/lib/providers";
import { DEFAULT_SUB_AGENTS, mergeSubAgentsWithDefaults } from "@/lib/defaultSubAgents";
import { DEFAULT_SKILLS, mergeSkillsWithDefaults } from "@/lib/defaultSkills";
import {
  DEFAULT_MEMORY_FILES,
  canonicalMemoryPath,
  isPreaddedMemory,
  mergeMemoryWithDefaults,
} from "@/lib/defaultMemory";
import { hasUnsafeSegment, normalizeKnowledgePath, sanitizeKnowledge } from "@/lib/defaultKnowledge";
import { enforceSingleActive, mergeTeamsWithDefaults } from "@/lib/defaultTeams";
import { enforceSingleActiveCeo, normalizeCeoAgents } from "@/lib/defaultCeo";
import { MAIN_AGENT_ID, normalizeCustomAgents } from "@/lib/customAgents";
import { normalizeConnectors } from "@/lib/connectors";
import { normalizeMcpServers } from "@/lib/mcp";
import { normalizeMainAgentPrompts, newMainAgentPromptId } from "@/lib/mainAgentPrompts";
import {
  DEFAULT_PLAN_MODE_PROMPT,
  normalizePlanModePrompt,
  normalizeTaskModes,
} from "@/lib/taskModes";
import { normalizePromptLibrary, newPromptLibraryId } from "@/lib/promptLibrary";
import { manualLimitKey, sanitizeManualContextLimits } from "@/lib/contextMeter";

function sanitizeContextManagementMethod(raw: unknown): "summarization" | "sliding_window" {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "sliding_window" || v === "sliding-window" || v === "window") return "sliding_window";
  return "summarization";
}

function sanitizeSlidingWindowTruncatePercent(raw: unknown): number {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) {
    const fraction = n > 1 ? n / 100 : n;
    if (Number.isFinite(fraction)) return Math.min(0.9, Math.max(0.05, fraction));
  }
  return 0.3;
}
import {
  DEFAULT_PROFILE_ID,
  findActiveProfile,
  isDefaultProfile,
  mergeProfilesWithDefaults,
  normalizeProfileSessions,
  normalizeProfileStates,
  type ProfileSnapshot,
} from "@/lib/userProfiles";

/** The workspace sections the rail switches between. */
export type Section =
  | "chat"
  | "memory"
  | "knowledge"
  | "agents"
  | "skills"
  | "teams"
  | "ceo"
  | "customagents"
  | "systemprompts"
  | "taskmodes"
  | "prompts"
  | "promptagent"
  | "schedules"
  | "connectors"
  | "mcp"
  | "channels"
  | "tts"
  | "profiles";

/** Connection state surfaced to the user. Slow ≠ offline; only a lost connection is "offline". */
export type Connection = "online" | "reconnecting" | "offline";

/**
 * A run that the backend is executing independently of this browser (runtime-only).
 * After a refresh the backend's session list (`running` flag in SQLite) tells the client
 * which chat to re-attach to; the stream then replays from the database-backed buffer.
 */
export interface ActiveRun {
  chatId: string;
  assistantId: string;
  /** Last SSE `_event_id` this client has applied — the resume cursor. */
  lastEventId: number;
  startedAt: number;
}

interface StreamDelta {
  contentDelta?: string;
  reasoningDelta?: string;
  lastEventId?: number;
}

interface AppState {
  // Synced to the backend SQLite database (nothing is kept in browser storage)
  conversations: Conversation[];
  currentId: string | null;
  settings: Settings;
  subAgents: SubAgent[];
  skills: Skill[];
  todos: TodoItem[];
  memory: MemoryFile[];
  knowledge: KnowledgeFile[];
  knowledgeSources: Record<string, KnowledgeSource>;
  customProviders: CustomProvider[];
  agentTeams: AgentTeam[];
  /** User-created CEO agents (top-level multi-team coordinators). */
  ceoAgents: CeoAgent[];
  /** User-created top-level Custom Agents (independent Main Agents). */
  customAgents: CustomAgent[];
  /** The active agent for chat turns: a Custom Agent id, or null / "main" for the built-in Main Agent. */
  activeCustomAgentId: string | null;
  /** User-authored custom system prompts for the built-in Main Agent. */
  mainAgentPrompts: MainAgentPrompt[];
  /** The active custom system prompt id for the Main Agent, or null to use the built-in prompt. */
  activeMainAgentPromptId: string | null;
  /** User-created custom task modes for the prompt box (name + appended prompt). */
  taskModes: CustomTaskMode[];
  /**
   * User-saved reusable prompts (prompt library). Each entry has a title, an
   * optional short description (both unlimited), and the prompt text itself.
   * Synced with the backend SQLite database like every other slice.
   */
  promptLibrary: PromptLibraryItem[];
  /**
   * Third-party app connector connections (GitHub, Slack, …), synced with the backend
   * SQLite database like every other slice. Only the connected-account id + status are
   * stored — tokens stay inside Composio.
   */
  connectors: ConnectorConnection[];
  /**
   * MCP servers (remote Streamable HTTP + local stdio), synced with the backend
   * SQLite database like every other slice. Secrets stay server-side — the
   * browser only sees presence flags, never values.
   */
  mcpServers: McpServer[];
  /**
   * The active task mode: null / "default" = normal, "plan" = plan-first mode,
   * otherwise a custom task-mode id whose prompt is appended to the message.
   */
  activeTaskModeId: string | null;
  /** Editable prompt appended in plan task mode (defaults to the built-in plan prompt). */
  planModePrompt: string;
  /**
   * Top-level conversation mode: "agent" (default, full tools) or "chat" (lightweight
   * conversational assistant with only memory + knowledge + web tools). Switched from the
   * sidebar; task modes in the prompt box are agent-only and unaffected.
   */
  agentMode: AgentMode;
  /**
   * User profiles (account identities). A default profile is always present. Each
   * profile owns a completely isolated workspace state — switching profiles starts
   * fresh with no data carried over.
   */
  userProfiles: UserProfile[];
  /** The active profile id; null means the built-in default profile. */
  activeUserProfileId: string | null;
  /**
   * Isolated per-profile workspace snapshots, keyed by profile id. Written when
   * switching away from a profile; applied when switching back to it.
   */
  profileStates: Record<string, ProfileSnapshot>;
  /** Per-profile chat session id lists, keyed by profile id. */
  profileSessions: Record<string, string[]>;
  activeRun: ActiveRun | null;

  // Ephemeral UI
  /** True once the store has been hydrated from the backend database. */
  hydrated: boolean;
  section: Section;
  providers: ProviderMeta[];
  models: ModelInfo[];
  modelsLoading: boolean;
  settingsOpen: boolean;
  searchOpen: boolean;
  filesOpen: boolean;
  teamMonitorOpen: boolean;
  streaming: boolean;
  connection: Connection;
  filesVersion: number;
  /** The agent's current workspace root (absolute path, fetched from the backend). */
  workspacePath: string;
  preview: BrowserPreview;
  attachedFiles: AttachedFile[];

  // Background memory agent (all data lives in the backend SQLite database; this is
  // purely the ephemeral view used to WATCH the agent's stream + sessions).
  memoryAgentOpen: boolean;
  memoryAgentSessionsOpen: boolean;
  /** Run currently shown in the memory-agent popup; null = the newest run. */
  memoryAgentSelectedId: string | null;
  memoryAgentRuns: MemoryAgentRunMeta[];
  memoryAgentCounts: MemoryAgentRunCounts;
  /** Streamed live state per run id (rebuilt from the SSE stream, live or replayed). */
  memoryAgentLive: Record<string, MemoryAgentLiveRun>;

  // Context meters (ephemeral, rebuilt from the `context_usage` log events in the
  // turn's SSE stream — live or replayed from the database event log). Keyed by conversation
  // id so switching threads never shows a stale value from another chat. A missing entry
  // means "unavailable" (never ran / provider silent), distinct from a zero-token count.
  // One map per scope: main/custom/chat hold the latest top-level usage; sub/team/ceo
  // hold per-agent entries keyed by runned session/agent id (only runned agents appear).
  contextUsage: Record<string, MainContextUsage>;
  customContextUsage: Record<string, AgentContextUsage>;
  chatContextUsage: Record<string, AgentContextUsage>;
  subAgentUsage: Record<string, Record<string, SubAgentContextEntry>>;
  teamUsage: Record<string, Record<string, TeamAgentContextEntry>>;
  ceoUsage: Record<string, Record<string, TeamAgentContextEntry>>;

  // Automatic context summarization handoff (ephemeral, rebuilt from summary_* SSE
  // events — live or replayed). Keyed by conversation id; each entry tracks the
  // latest handoff for that thread. Closing the popup never cancels the backend job.
  summaryHandoffs: Record<string, SummaryHandoffInfo>;
  summaryHandoffOpen: boolean;
  /** Past handoff runs per conversation (latest last), mirrored from terminal events + history API. */
  summaryHistory: Record<string, SummaryHandoffInfo[]>;
  summaryHistoryOpen: boolean;
  // Sub-agent context summarization handoffs (ephemeral, rebuilt from
  // sub_agent_summary_* SSE events — live or replayed). Keyed by conversation id,
  // then by handoff id, so concurrent summarizations of multiple sub-agents each
  // keep their own live output. Closing the popup never cancels backend jobs.
  subAgentSummaries: Record<string, Record<string, SubAgentSummaryInfo>>;

  // Hydration from the backend SQLite database
  hydrateFromBackend: (payload: BackendBootPayload) => void;

  // Conversations
  newConversation: () => string;
  /**
   * Start a new branch inside the current chat session. The branch is a brand-new
   * backend session (fresh context for every agent — main, custom, team, CEO, and
   * sub-agents all start clean, exactly like a new chat) grouped under its parent
   * in the UI. Returns the new branch id, or null when there is nothing to branch.
   */
  branchConversation: () => string | null;
  /**
   * Fork a conversation into a full 100% local copy: every message (content,
   * reasoning, tool chips, sub-agent runs, team runs) is deep-cloned into a new
   * backend session id grouped under its parent. Global settings/memory/skills/
   * teams are shared by design, so the fork automatically inherits them. The
   * caller is responsible for copying the server-side transcript/snapshot via
   * `forkSessionData` with the same new id (best-effort). Returns the fork id.
   */
  forkConversation: (sourceId?: string, newId?: string) => string | null;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  ensureConversation: () => string;
  /** Replace one conversation wholesale (used when its snapshot loads from the database). */
  replaceConversation: (conv: Conversation) => void;

  // Messages
  addMessage: (convId: string, message: ChatMessage) => void;
  updateMessage: (convId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  /** Reset a message's streamed body (used before a full resume replay). */
  resetMessageStream: (convId: string, msgId: string) => void;
  /** Batched hot-path append: content + reasoning deltas and the resume cursor in one write. */
  applyAssistantDelta: (convId: string, msgId: string, delta: StreamDelta) => void;
  upsertTool: (convId: string, msgId: string, tool: ToolActivity) => void;

  // Active run (resumable streaming)
  setActiveRun: (run: ActiveRun | null) => void;
  setActiveRunCursor: (lastEventId: number) => void;

  // submit_plan review
  setPlanPending: (
    convId: string,
    msgId: string,
    toolId: string,
    info: { id: string; chatId: string; plan: string },
  ) => void;
  setPlanStatus: (convId: string, msgId: string, toolId: string, status: PlanApprovalStatus) => void;
  updatePlanForTool: (toolId: string, patch: { status?: PlanApprovalStatus; plan?: string }) => void;

  // ask_question_to_user Q&A
  setQuestionPending: (
    convId: string,
    msgId: string,
    toolId: string,
    info: { id: string; chatId: string; questions: AskQuestionInfo["questions"] },
  ) => void;
  setQuestionStatus: (convId: string, msgId: string, toolId: string, status: AskQuestionStatus) => void;
  updateQuestionForTool: (toolId: string, patch: { status?: AskQuestionStatus }) => void;

  // Sub-agent live runs
  startSubAgent: (
    convId: string,
    msgId: string,
    toolId: string,
    run: Pick<SubAgentRun, "agent" | "task" | "background" | "outputFile" | "sentContext">,
  ) => void;
  applySubAgentDelta: (
    convId: string,
    msgId: string,
    toolId: string,
    delta: { outputDelta?: string; reasoningDelta?: string },
  ) => void;
  upsertSubAgentTool: (convId: string, msgId: string, toolId: string, tool: ToolActivity) => void;
  finishSubAgent: (
    convId: string,
    msgId: string,
    toolId: string,
    patch: { status: SubAgentRun["status"]; output?: string; error?: string },
  ) => void;
  /** Create/refresh the call_multiple_sub_agents batch tool block with one run slot per child. */
  startMultiSubAgents: (
    convId: string,
    msgId: string,
    toolId: string,
    label: string,
    children: Array<{
      id: string;
      run: Pick<SubAgentRun, "agent" | "task" | "background" | "outputFile" | "sentContext"> & {
        error?: string;
      };
    }>,
  ) => void;
  /** Create/refresh a single child run inside a call_multiple_sub_agents batch block. */
  startSubAgentInParent: (
    convId: string,
    msgId: string,
    parentToolId: string,
    childId: string,
    run: Pick<SubAgentRun, "agent" | "task" | "background" | "outputFile" | "sentContext">,
  ) => void;
  /** Upsert a nested tool activity onto a child run inside a batch block. */
  upsertSubAgentToolInParent: (
    convId: string,
    msgId: string,
    parentToolId: string,
    childId: string,
    tool: ToolActivity,
  ) => void;
  /** Finalize a single child run inside a batch block. */
  finishSubAgentInParent: (
    convId: string,
    msgId: string,
    parentToolId: string,
    childId: string,
    patch: { status: SubAgentRun["status"]; output?: string; error?: string },
  ) => void;

  // Sub-agent management
  addSubAgent: (input: Omit<SubAgent, "id" | "createdAt" | "updatedAt">) => void;
  updateSubAgent: (id: string, patch: Partial<Omit<SubAgent, "id" | "createdAt">>) => void;
  deleteSubAgent: (id: string) => void;
  toggleSubAgent: (id: string) => void;

  // Agent team management
  addTeam: (team: AgentTeam) => void;
  updateTeam: (id: string, patch: Partial<Omit<AgentTeam, "id" | "createdAt">>) => void;
  deleteTeam: (id: string) => void;
  /** Activate a team (turns off any other active team — only one team is active at a time). */
  setActiveTeam: (id: string, enabled: boolean) => void;

  // CEO agent management (top-level multi-team coordinators)
  addCeo: (ceo: CeoAgent) => void;
  updateCeo: (id: string, patch: Partial<Omit<CeoAgent, "id" | "createdAt">>) => void;
  deleteCeo: (id: string) => void;
  /** Activate a CEO (turns off any other active CEO — only one CEO is active at a time). */
  setActiveCeo: (id: string, enabled: boolean) => void;

  // Custom agent management (top-level, user-created Main Agents)
  addCustomAgent: (input: Omit<CustomAgent, "id" | "createdAt" | "updatedAt">) => CustomAgent;
  updateCustomAgent: (id: string, patch: Partial<Omit<CustomAgent, "id" | "createdAt">>) => void;
  deleteCustomAgent: (id: string) => void;
  /** Replace the whole list (used after a backend refresh / agent-driven mutation). */
  setCustomAgents: (agents: CustomAgent[]) => void;
  /** Select which agent chat turns run as: a Custom Agent id, or null for the built-in Main Agent. */
  setActiveCustomAgent: (id: string | null) => void;

  // Custom System Prompts for the built-in Main Agent (instructions only — not a new agent)
  addMainAgentPrompt: (input: Omit<MainAgentPrompt, "id" | "createdAt" | "updatedAt">) => MainAgentPrompt;
  updateMainAgentPrompt: (id: string, patch: Partial<Omit<MainAgentPrompt, "id" | "createdAt">>) => void;
  deleteMainAgentPrompt: (id: string) => void;
  /** Replace the whole list (used after a backend refresh / agent-driven mutation). */
  setMainAgentPrompts: (prompts: MainAgentPrompt[]) => void;
  /** Activate one custom system prompt for the Main Agent, or null to use the built-in prompt. */
  setActiveMainAgentPrompt: (id: string | null) => void;

  // Task modes for the prompt box (plan / default / custom)
  addTaskMode: (input: Omit<CustomTaskMode, "id" | "createdAt" | "updatedAt">) => CustomTaskMode;
  updateTaskMode: (id: string, patch: Partial<Omit<CustomTaskMode, "id" | "createdAt">>) => void;
  deleteTaskMode: (id: string) => void;
  /** Select the active task mode: null/"default" = normal, "plan" = plan-first, else a custom id. */
  setActiveTaskMode: (id: string | null) => void;
  /** Update the editable plan-mode prompt appended in plan mode. */
  setPlanModePrompt: (prompt: string) => void;
  /** Switch the top-level conversation mode ("agent" = full tools, "chat" = chat-only). */
  setAgentMode: (mode: AgentMode) => void;

  // Prompt library (user-saved reusable prompts for quick copy/use)
  addPromptLibraryItem: (
    input: Omit<PromptLibraryItem, "id" | "createdAt" | "updatedAt">,
  ) => PromptLibraryItem;
  updatePromptLibraryItem: (
    id: string,
    patch: Partial<Omit<PromptLibraryItem, "id" | "createdAt">>,
  ) => void;
  deletePromptLibraryItem: (id: string) => void;
  /**
   * Text the composer should insert next (set by prompt-library "Use" actions
   * and the "/" shortcut). The Composer consumes and clears it.
   */
  composerPrefill: string | null;
  setComposerPrefill: (text: string | null) => void;

  // Connector connections (third-party apps via Composio)
  /** Replace the whole connection list (used after a backend refresh). */
  setConnectors: (connectors: ConnectorConnection[]) => void;
  /** Upsert one connection by connector id. */
  setConnector: (connection: ConnectorConnection) => void;
  /** Drop one connection by connector id. */
  removeConnector: (connectorId: string) => void;

  // MCP servers (remote Streamable HTTP + local stdio via Composio-style UX)
  /** Replace the whole server list (used after a backend fetch). */
  setMcpServers: (servers: McpServer[]) => void;  /** Insert or replace one server by id (used after create/update/test). */
  upsertMcpServer: (server: McpServer) => void;
  /** Drop one server by id. */
  removeMcpServer: (id: string) => void;
  /** Flip a server's master switch locally (the panel persists it via the API). */
  setMcpServerEnabled: (id: string, enabled: boolean) => void;
  /** Switch one server tool on/off locally (the panel persists it via the API). */
  setMcpToolEnabled: (id: string, tool: string, enabled: boolean) => void;

  // Messaging channels (Telegram / Discord / Slack — WhatsApp is coming soon)
  /**
   * Ephemeral mirror of the backend channel list, refreshed from the channels API
   * by the Channels page. The backend SQLite database is the source of truth
   * (tokens never leave it) — this slice is never synced through the app-state
   * bridge and never touches browser storage.
   */
  channelConnections: ChannelConnection[];
  /** Replace the whole connection list (used after a backend fetch). */
  setChannelConnections: (connections: ChannelConnection[]) => void;
  /** Insert or replace one connection by id (used after create/update). */
  upsertChannelConnection: (connection: ChannelConnection) => void;
  /** Drop one connection by id. */
  removeChannelConnection: (id: string) => void;

  // Schedules (persistent cron tasks, executed by the backend scheduler)
  /**
   * Ephemeral mirror of the backend schedules list, refreshed from the
   * schedules API by the Schedule page. The backend SQLite database is the
   * source of truth — this slice is never synced through the app-state
   * bridge and never touches browser storage.
   */
  schedules: Schedule[];
  /** Replace the whole schedule list (used after a backend fetch). */
  setSchedules: (schedules: Schedule[]) => void;

  // User profiles (account identities with fully isolated workspace state)
  addUserProfile: (input: Omit<UserProfile, "id" | "createdAt" | "updatedAt">) => UserProfile;
  updateUserProfile: (id: string, patch: Partial<Omit<UserProfile, "id" | "createdAt">>) => void;
  /**
   * Delete a profile and ALL of its isolated data (chats, settings, memory, ...).
   * The default profile and the last remaining profile cannot be deleted.
   * Returns an error message, or null on success.
   */
  deleteUserProfile: (id: string) => string | null;
  /**
   * Switch to another profile, stashing the current profile's full workspace state
   * and restoring the target's (fresh defaults when it has no snapshot yet).
   * Blocked while an agent is streaming. Returns an error message, or null.
   */
  switchUserProfile: (id: string) => string | null;
  /**
   * Duplicate a profile (identity + full workspace state + a copy of every chat)
   * and switch to the copy. Blocked while streaming. Returns the new id, or null.
   */
  duplicateUserProfile: (id: string) => Promise<string | null>;
  /**
   * Reset a profile to a brand-new state: all of its chats/settings/memory/... are
   * cleared to fresh defaults. Blocked while streaming. Returns an error, or null.
   */
  resetUserProfile: (id: string) => string | null;

  // Multi-agent team live run (rendered inline in the assistant container message)
  startTeamRun: (
    convId: string,
    msgId: string,
    info: { teamName: string; leaderId: string; sendMessageEnabled: boolean; roster: TeamAgentBlock[] },
  ) => void;
  startTeamAgentSegment: (
    convId: string,
    msgId: string,
    agentId: string,
    info: { name?: string; role?: TeamAgentRole; trigger?: string },
  ) => void;
  applyTeamAgentDelta: (
    convId: string,
    msgId: string,
    agentId: string,
    delta: { outputDelta?: string; reasoningDelta?: string },
  ) => void;
  upsertTeamAgentTool: (convId: string, msgId: string, agentId: string, tool: ToolActivity) => void;
  setTeamAgentStatus: (
    convId: string,
    msgId: string,
    agentId: string,
    patch: { status?: TeamAgentStatus; queued?: number },
  ) => void;
  addTeamMonitorMessage: (
    convId: string,
    msgId: string,
    entry: { from?: string; to?: string; kind?: TeamMessageKind; text?: string },
  ) => void;

  // Skill management
  addSkill: (input: Omit<Skill, "id" | "createdAt" | "updatedAt">) => void;
  updateSkill: (id: string, patch: Partial<Omit<Skill, "id" | "createdAt">>) => void;
  deleteSkill: (id: string) => void;
  toggleSkill: (id: string) => void;

  // Todos / memory / knowledge
  setTodos: (todos: TodoItem[]) => void;
  setMemory: (files: MemoryFile[]) => void;
  saveMemoryFile: (path: string, content: string, originalPath?: string) => string | null;
  deleteMemoryFile: (path: string) => void;
  setKnowledge: (files: KnowledgeFile[]) => void;
  saveKnowledgeFile: (path: string, content: string, originalPath?: string) => string | null;
  deleteKnowledgeFile: (path: string) => void;
  setKnowledgeSource: (path: string, source: KnowledgeSource | null) => void;
  setPromptLibrary: (prompts: PromptLibraryItem[]) => void;

  // Preview + attached files
  setPreview: (url: string) => void;
  setPreviewOpen: (open: boolean) => void;
  addAttachedFiles: (files: AttachedFile[]) => void;
  setFilesOpen: (open: boolean) => void;

  // Custom providers
  addCustomProvider: (input: Omit<CustomProvider, "id" | "createdAt" | "updatedAt">) => CustomProvider;
  updateCustomProvider: (id: string, patch: Partial<Omit<CustomProvider, "id" | "createdAt">>) => void;
  deleteCustomProvider: (id: string) => void;
  selectCustomProvider: (id: string) => void;

  // Settings + UI
  setSettings: (patch: Partial<Settings>) => void;
  /** Save a manual context-window limit for one provider+model pair (persisted in settings). */
  setManualContextLimit: (provider: string, model: string, limit: number) => void;
  /** Drop the manual context-window limit for one provider+model pair. */
  clearManualContextLimit: (provider: string, model: string) => void;
  setApiKey: (provider: string, key: string) => void;
  setSearchProvider: (provider: SearchProvider) => void;
  setFetchProvider: (provider: FetchProvider) => void;
  setSearchApiKey: (provider: "tavily" | "exa" | "serpapi" | "firecrawl", key: string) => void;
  setProviders: (p: ProviderMeta[]) => void;
  setModels: (m: ModelInfo[]) => void;
  setModelsLoading: (v: boolean) => void;
  setSection: (section: Section) => void;
  setSettingsOpen: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  setTeamMonitorOpen: (v: boolean) => void;
  setStreaming: (v: boolean) => void;
  setConnection: (c: Connection) => void;
  bumpFiles: () => void;
  setWorkspacePath: (path: string) => void;

  // Background memory agent (watch-only)
  setMemoryAgentOpen: (v: boolean) => void;
  setMemoryAgentSessionsOpen: (v: boolean) => void;
  setMemoryAgentSelectedId: (id: string | null) => void;
  setMemoryAgentRuns: (runs: MemoryAgentRunMeta[], counts: MemoryAgentRunCounts) => void;
  /** Create/reset the live view of a run (called when its stream attaches/replays). */
  startMemoryAgentLive: (runId: string) => void;
  applyMemoryAgentDelta: (
    runId: string,
    delta: { reasoningDelta?: string; outputDelta?: string },
  ) => void;
  upsertMemoryAgentTool: (runId: string, tool: ToolActivity) => void;
  finishMemoryAgentLive: (
    runId: string,
    outcome: { status: "completed" | "failed"; error?: string; updatedFiles?: string[] },
  ) => void;

  // Main-agent context meter (latest `context_usage` log per conversation)
  /** Record the latest main-agent context usage for a conversation (from a validated log event). */
  setContextUsage: (convId: string, usage: MainContextUsage) => void;
  /** Record the latest custom-agent context usage for a conversation. */
  setCustomContextUsage: (convId: string, usage: AgentContextUsage) => void;
  /** Record the latest chat-mode context usage for a conversation. */
  setChatContextUsage: (convId: string, usage: AgentContextUsage) => void;
  /** Record one runned sub-agent's latest usage (keyed by sub-session id). */
  setSubAgentUsage: (convId: string, entry: SubAgentContextEntry) => void;
  /** Record one team agent's (leader/member) latest usage (keyed by agent id). */
  setTeamUsage: (convId: string, entry: TeamAgentContextEntry) => void;
  /** Record one CEO-system agent's (CEO/leader/member) latest usage (keyed by agent id). */
  setCeoUsage: (convId: string, entry: TeamAgentContextEntry) => void;

  // Sub-agent context summarization handoffs (latest sub_agent_summary_* events per run)
  /** Create or reset one sub-agent handoff view (idempotent per handoff id). */
  startSubAgentSummary: (convId: string, info: { handoffId: string; subSessionId: string; subAgentName: string; status: SummaryHandoffStatus }) => void;
  /** Append one streaming chunk in order for a sub-agent handoff (never used for completion). */
  appendSubAgentSummaryChunk: (convId: string, handoffId: string, chunk: string) => void;
  /** Update status/validated summary/error for a sub-agent handoff (authoritative backend state). */
  updateSubAgentSummary: (convId: string, handoffId: string, patch: Partial<Omit<SubAgentSummaryInfo, "handoffId">> & { status?: SummaryHandoffStatus }) => void;
  /** Replace a conversation's sub-agent summaries wholesale (from the history API). */
  setSubAgentSummaries: (convId: string, entries: SubAgentSummaryInfo[]) => void;

  // Automatic context summarization handoff (latest summary_* events per conversation)
  /** Create or reset the handoff view for a new job (idempotent per handoff id). */
  startSummaryHandoff: (
    convId: string,
    handoffId: string,
    status: SummaryHandoffStatus,
    agent?: { agent?: "main" | "custom"; customAgentId?: string | null; customAgentName?: string | null },
  ) => void;
  /** Append one streaming chunk in order (never used for completion). */
  appendSummaryChunk: (convId: string, handoffId: string, chunk: string) => void;
  /** Update status/validated summary/error for a handoff (authoritative backend state). */
  updateSummaryHandoff: (
    convId: string,
    handoffId: string,
    patch: Partial<Omit<SummaryHandoffInfo, "handoffId">> & { status?: SummaryHandoffStatus },
  ) => void;
  setSummaryHandoffOpen: (v: boolean) => void;
  /** Append/replace one history entry for a conversation (deduplicated by handoff id). */
  upsertSummaryHistory: (convId: string, entry: SummaryHandoffInfo) => void;
  /** Replace a conversation's history wholesale (from the history API). */
  setSummaryHistory: (convId: string, entries: SummaryHandoffInfo[]) => void;
  setSummaryHistoryOpen: (v: boolean) => void;
}

const defaultSettings: Settings = {
  provider: "openrouter",
  model: "",
  apiKeys: {},
  baseUrl: "",
  searchProvider: "duckduckgo",
  fetchProvider: "builtin",
  tavilyApiKey: "",
  exaApiKey: "",
  serpapiApiKey: "",
  firecrawlApiKey: "",
  composioApiKey: "",
  enableReuseSubAgentSession: "no",
  effort: "high",
  temperature: 0.6,
  enableAgentTeams: "no",
  enableSendMessageToTeam: "no",
  enableCeoAgents: "no",
  memoryAgentEnabled: "yes",
  memoryAgentInterval: 3,
  manualContextLimits: {},
  contextManagementMethod: "summarization",
  slidingWindowTruncatePercent: 0.3,
  tts: {
    provider: null,
    apiKey: "",
    baseUrl: "",
    model: "",
    voice: "",
    language: "",
    speed: null,
    outputFormat: "",
    instructions: "",
    azureRegion: "",
    volcengineAppId: "",
    volcengineCluster: "",
    minimaxGroupId: "",
  },
};

function touch(conv: Conversation): Conversation {
  return { ...conv, updatedAt: Date.now() };
}

/** Immutably update a single tool (by id) inside a single message (by id) inside a conversation. */
function patchTool(
  conversations: Conversation[],
  convId: string,
  msgId: string,
  toolId: string,
  updater: (tool: ToolActivity) => ToolActivity,
  createIfMissing?: () => ToolActivity,
): Conversation[] {
  return conversations.map((c) =>
    c.id === convId
      ? {
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== msgId) return m;
            const tools = m.tools ? [...m.tools] : [];
            const idx = tools.findIndex((t) => t.id === toolId);
            if (idx === -1) {
              if (!createIfMissing) return m;
              tools.push(updater(createIfMissing()));
            } else {
              tools[idx] = updater(tools[idx]);
            }
            return { ...m, tools };
          }),
        }
      : c,
  );
}

const emptyRun = (
  run: Pick<SubAgentRun, "agent" | "task" | "background" | "outputFile" | "sentContext"> & {
    error?: string;
  },
): SubAgentRun => ({
  agent: run.agent,
  task: run.task,
  background: run.background,
  sentContext: run.sentContext,
  outputFile: run.outputFile,
  reasoning: "",
  output: "",
  tools: [],
  status: run.error ? "error" : "running",
  error: run.error,
});

/**
 * Patch a single child run inside a call_multiple_sub_agents batch tool block. Locates the parent
 * tool by `parentToolId`, then updates `multiRuns[childId]` (creating the slot when missing). A
 * no-op when the parent tool or child slot cannot be resolved and `createIfMissing` is not given.
 */
function patchMultiRun(
  conversations: Conversation[],
  convId: string,
  msgId: string,
  parentToolId: string,
  childId: string,
  updater: (run: SubAgentRun) => SubAgentRun,
  createIfMissing?: () => SubAgentRun,
): Conversation[] {
  return patchTool(conversations, convId, msgId, parentToolId, (tool) => {
    const multiRuns = { ...tool.multiRuns };
    const existing = multiRuns[childId] ?? (createIfMissing ? createIfMissing() : undefined);
    if (!existing) return tool;
    multiRuns[childId] = updater(existing);
    const multiOrder = tool.multiOrder?.includes(childId)
      ? tool.multiOrder
      : [...(tool.multiOrder ?? []), childId];
    return { ...tool, multiRuns, multiOrder };
  });
}

/** Update the TeamRunState on a specific assistant container message (no-op if absent). */
function patchTeamRun(
  conversations: Conversation[],
  convId: string,
  msgId: string,
  updater: (team: TeamRunState) => TeamRunState,
): Conversation[] {
  return conversations.map((c) =>
    c.id === convId
      ? {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId && m.team ? { ...m, team: updater(m.team) } : m,
          ),
        }
      : c,
  );
}

/** The last (current) segment of an agent block, creating one if none exists. */
function currentSegment(block: TeamAgentBlock): TeamAgentSegment {
  const last = block.segments[block.segments.length - 1];
  if (last) return last;
  return { id: `${block.id}-seg-0`, reasoning: "", output: "", tools: [] };
}

/** Deep-clone plain state (snapshots, profiles) without sharing references. */
function cloneJson<T>(value: T): T {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch {
    // fall through to JSON
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The resolved id of the currently active profile (never empty). */
function activeProfileIdOf(s: Pick<AppState, "activeUserProfileId">): string {
  return s.activeUserProfileId && s.activeUserProfileId.trim().length > 0
    ? s.activeUserProfileId
    : DEFAULT_PROFILE_ID;
}

/** Normalize an untrusted agent-mode value; anything but "chat" means full agent mode. */
function normalizeAgentMode(raw: unknown): AgentMode {
  return typeof raw === "string" && raw.trim().toLowerCase() === "chat" ? "chat" : "agent";
}

/**
 * A brand-new, empty workspace snapshot: fresh defaults for every user-owned slice,
 * exactly matching the store's initial state. A new profile starts from this — no
 * past profile data of any kind is carried over.
 */
function freshProfileSnapshot(): ProfileSnapshot {
  return {
    settings: { ...defaultSettings },
    subAgents: DEFAULT_SUB_AGENTS.map((a) => ({ ...a })),
    skills: DEFAULT_SKILLS.map((sk) => ({ ...sk })),
    todos: [],
    memory: DEFAULT_MEMORY_FILES.map((f) => ({ ...f })),
    knowledge: [],
    knowledgeSources: {},
    customProviders: [],
    agentTeams: mergeTeamsWithDefaults([]),
    ceoAgents: [],
    customAgents: [],
    activeCustomAgentId: null,
    mainAgentPrompts: [],
    activeMainAgentPromptId: null,
    taskModes: [],
    activeTaskModeId: null,
    planModePrompt: DEFAULT_PLAN_MODE_PROMPT,
    agentMode: "agent",
    promptLibrary: [],
    connectors: [],
    mcpServers: [],
    currentId: null,
  };
}

/** Capture the live workspace slices of the current profile into a storable snapshot. */
function captureProfileSnapshot(s: AppState): ProfileSnapshot {
  return {
    settings: cloneJson(s.settings),
    subAgents: cloneJson(s.subAgents),
    skills: cloneJson(s.skills),
    todos: cloneJson(s.todos),
    memory: cloneJson(s.memory),
    knowledge: cloneJson(s.knowledge),
    knowledgeSources: cloneJson(s.knowledgeSources),
    customProviders: cloneJson(s.customProviders),
    agentTeams: cloneJson(s.agentTeams),
    ceoAgents: cloneJson(s.ceoAgents),
    customAgents: cloneJson(s.customAgents),
    activeCustomAgentId: s.activeCustomAgentId,
    mainAgentPrompts: cloneJson(s.mainAgentPrompts),
    activeMainAgentPromptId: s.activeMainAgentPromptId,
    taskModes: cloneJson(s.taskModes),
    activeTaskModeId: s.activeTaskModeId,
    planModePrompt: s.planModePrompt,
    agentMode: s.agentMode === "chat" ? "chat" : "agent",
    promptLibrary: cloneJson(s.promptLibrary),
    connectors: cloneJson(s.connectors),
    mcpServers: cloneJson(s.mcpServers),
    currentId: s.currentId,
  };
}

/** Session ids of one profile's conversations currently in memory. */
function sessionIdsOf(conversations: Conversation[], profileId: string): string[] {
  return conversations
    .filter((c) => (c.profileId ?? DEFAULT_PROFILE_ID) === profileId)
    .map((c) => c.id);
}

/**
 * Runtime store. NOTHING here touches browser storage (no localStorage, no
 * sessionStorage, no IndexedDB, no cookies): all durable data lives in the backend
 * SQLite database. The store hydrates from `GET /api/state` at boot (see
 * `lib/statePersistence.ts` + `hydrateFromBackend`), and every persistent slice is
 * synced back to the database when it changes. A page refresh rebuilds the runtime
 * state from the database and re-attaches to any still-running stream.
 */
export const useStore = create<AppState>()(
    (set, get) => ({
      conversations: [],
      currentId: null,
      settings: defaultSettings,
      subAgents: [...DEFAULT_SUB_AGENTS],
      skills: [...DEFAULT_SKILLS],
      todos: [],
      memory: DEFAULT_MEMORY_FILES.map((f) => ({ ...f })),
      knowledge: [],
      knowledgeSources: {},
      customProviders: [],
      agentTeams: mergeTeamsWithDefaults([]),
      ceoAgents: [],
      customAgents: [],
      activeCustomAgentId: null,
      mainAgentPrompts: [],
      activeMainAgentPromptId: null,
      taskModes: [],
      activeTaskModeId: null,
      planModePrompt: DEFAULT_PLAN_MODE_PROMPT,
      agentMode: "agent",
      promptLibrary: [],
      composerPrefill: null,
      connectors: [],
      mcpServers: [],
      channelConnections: [],
      schedules: [],
      userProfiles: mergeProfilesWithDefaults([]),
      activeUserProfileId: null,
      profileStates: {},
      profileSessions: {},
      activeRun: null,

      hydrated: false,
      section: "chat",
      providers: [],
      models: [],
      modelsLoading: false,
      settingsOpen: false,
      searchOpen: false,
      filesOpen: false,
      teamMonitorOpen: false,
      streaming: false,
      connection: "online",
      filesVersion: 0,
      workspacePath: "",
      preview: { url: "", open: false },
      attachedFiles: [],

      memoryAgentOpen: false,
      memoryAgentSessionsOpen: false,
      memoryAgentSelectedId: null,
      memoryAgentRuns: [],
      memoryAgentCounts: { queued: 0, running: 0, completed: 0, failed: 0, total: 0 },
      memoryAgentLive: {},
      contextUsage: {},
      customContextUsage: {},
      chatContextUsage: {},
      subAgentUsage: {},
      teamUsage: {},
      ceoUsage: {},
      summaryHandoffs: {},
      summaryHandoffOpen: false,
      summaryHistory: {},
      summaryHistoryOpen: false,
      subAgentSummaries: {},

      hydrateFromBackend: (payload) => {
        const state = payload.state ?? {};
        const p = state as Partial<AppState>;
        const defaults = get();

        // --- User profiles (a default profile is always present) ---
        const userProfiles = mergeProfilesWithDefaults(
          Array.isArray((p as { userProfiles?: unknown }).userProfiles)
            ? ((p as { userProfiles?: UserProfile[] }).userProfiles as UserProfile[])
            : [],
        );
        const storedActiveId =
          typeof (state as { activeUserProfileId?: unknown }).activeUserProfileId === "string"
            ? ((state as { activeUserProfileId?: string }).activeUserProfileId ?? null)
            : null;
        const activeProfile = findActiveProfile(userProfiles, storedActiveId);
        const activePid = activeProfile.id;

        let profileStates = normalizeProfileStates(
          (p as { profileStates?: unknown }).profileStates,
        );
        let profileSessions = normalizeProfileSessions(
          (p as { profileSessions?: unknown }).profileSessions,
        );

        // Drop session references the database no longer knows (deleted elsewhere).
        const serverIds = new Set(payload.sessions.map((s) => s.id));
        for (const pid of Object.keys(profileSessions)) {
          profileSessions[pid] = (profileSessions[pid] ?? []).filter((id) => serverIds.has(id));
        }
        // First run with profiles: every existing session belongs to the default profile.
        const hasAnyMapped = Object.values(profileSessions).some((list) => list.length > 0);
        if (!hasAnyMapped && payload.sessions.length > 0) {
          const defId =
            userProfiles.find((pr) => isDefaultProfile(pr.id))?.id ?? DEFAULT_PROFILE_ID;
          profileSessions = { ...profileSessions, [defId]: payload.sessions.map((s) => s.id) };
        }
        const membership = new Map<string, string>();
        for (const [pid, ids] of Object.entries(profileSessions)) {
          for (const id of ids) {
            if (!membership.has(id)) membership.set(id, pid);
          }
        }

        // Sessions from the database become conversation stubs; their full snapshots
        // are fetched lazily when selected (see lib/statePersistence.ts). Each stub
        // is tagged with its owning profile; unknown sessions heal into the active one.
        const conversations: Conversation[] = payload.sessions.map((s) => ({
          id: s.id,
          title: s.title.trim().length > 0 ? s.title : "New thread",
          messages: [],
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount: s.messageCount,
          profileId: membership.get(s.id) ?? activePid,
          loaded: false,
        }));
        const healed = conversations.filter((c) => !membership.has(c.id)).map((c) => c.id);
        if (healed.length > 0) {
          profileSessions = {
            ...profileSessions,
            [activePid]: [...(profileSessions[activePid] ?? []), ...healed],
          };
        }

        // Working-copy slices from the top-level documents (last-written state).
        const base = {
          settings: {
            ...defaults.settings,
            ...(p.settings && typeof p.settings === "object" ? p.settings : {}),
            // Manual context limits from older/foreign clients may be malformed —
            // sanitize so a corrupt entry can never break limit resolution.
            manualContextLimits: sanitizeManualContextLimits(
              (p.settings as { manualContextLimits?: unknown } | undefined)?.manualContextLimits,
            ),
            contextManagementMethod: sanitizeContextManagementMethod(
              (p.settings as { contextManagementMethod?: unknown } | undefined)?.contextManagementMethod,
            ),
            slidingWindowTruncatePercent: sanitizeSlidingWindowTruncatePercent(
              (p.settings as { slidingWindowTruncatePercent?: unknown } | undefined)
                ?.slidingWindowTruncatePercent,
            ),
          },
          subAgents: mergeSubAgentsWithDefaults(
            Array.isArray(p.subAgents) ? p.subAgents : defaults.subAgents,
          ),
          skills: mergeSkillsWithDefaults(
            Array.isArray(p.skills) ? p.skills : defaults.skills,
          ),
          todos: Array.isArray(p.todos) ? p.todos : defaults.todos,
          memory: mergeMemoryWithDefaults(
            Array.isArray(p.memory) ? p.memory : defaults.memory,
          ),
          knowledge: sanitizeKnowledge(
            Array.isArray(p.knowledge) ? p.knowledge : defaults.knowledge,
          ),
          knowledgeSources:
            p.knowledgeSources && typeof p.knowledgeSources === "object"
              ? (p.knowledgeSources as Record<string, KnowledgeSource>)
              : defaults.knowledgeSources,
          customProviders: Array.isArray(p.customProviders)
            ? p.customProviders
            : defaults.customProviders,
          agentTeams: mergeTeamsWithDefaults(
            Array.isArray((p as { agentTeams?: unknown }).agentTeams)
              ? ((p as { agentTeams?: AgentTeam[] }).agentTeams as AgentTeam[])
              : defaults.agentTeams,
          ),
          ceoAgents: normalizeCeoAgents(
            (p as { ceoAgents?: unknown }).ceoAgents ?? defaults.ceoAgents,
          ),
          customAgents: normalizeCustomAgents(
            (p as { customAgents?: unknown }).customAgents ?? defaults.customAgents,
          ),
          activeCustomAgentId:
            typeof (state as { activeCustomAgentId?: unknown }).activeCustomAgentId === "string"
              ? ((state as { activeCustomAgentId?: string }).activeCustomAgentId ?? null)
              : defaults.activeCustomAgentId,
          mainAgentPrompts: normalizeMainAgentPrompts(
            (p as { mainAgentPrompts?: unknown }).mainAgentPrompts ?? defaults.mainAgentPrompts,
          ),
          activeMainAgentPromptId:
            typeof (state as { activeMainAgentPromptId?: unknown }).activeMainAgentPromptId ===
            "string"
              ? ((state as { activeMainAgentPromptId?: string }).activeMainAgentPromptId ?? null)
              : defaults.activeMainAgentPromptId,
          taskModes: normalizeTaskModes(
            (p as { taskModes?: unknown }).taskModes ?? defaults.taskModes,
          ),
          promptLibrary: normalizePromptLibrary(
            (p as { promptLibrary?: unknown }).promptLibrary ?? defaults.promptLibrary,
          ),
          activeTaskModeId:
            typeof (state as { activeTaskModeId?: unknown }).activeTaskModeId === "string"
              ? ((state as { activeTaskModeId?: string }).activeTaskModeId ?? null)
              : defaults.activeTaskModeId,
    planModePrompt: normalizePlanModePrompt(
      (p as { planModePrompt?: unknown }).planModePrompt ?? defaults.planModePrompt,
    ),
    agentMode: normalizeAgentMode(
      (p as { agentMode?: unknown }).agentMode ?? defaults.agentMode,
    ),
    connectors: normalizeConnectors(
      (p as { connectors?: unknown }).connectors ?? defaults.connectors,
    ),
    mcpServers: normalizeMcpServers(
      (p as { mcpServers?: unknown }).mcpServers ?? defaults.mcpServers,
    ),
  };

        // Seed the active profile's snapshot from the working copy when it has none
        // (first run — preserves all pre-existing data under the default profile).
        if (!profileStates[activePid]) {
          profileStates = {
            ...profileStates,
            [activePid]: { ...cloneJson(base), currentId: null },
          };
        }
        // The active snapshot wins over the working copy (it is newer by construction:
        // it was captured the last time this profile was switched away from).
        const snap = profileStates[activePid]!;
        const fromSnap = {
          settings: snap.settings && typeof snap.settings === "object" ? { ...base.settings, ...snap.settings } : base.settings,
          subAgents: mergeSubAgentsWithDefaults(Array.isArray(snap.subAgents) ? snap.subAgents : base.subAgents),
          skills: mergeSkillsWithDefaults(Array.isArray(snap.skills) ? snap.skills : base.skills),
          todos: Array.isArray(snap.todos) ? snap.todos : base.todos,
          memory: mergeMemoryWithDefaults(Array.isArray(snap.memory) ? snap.memory : base.memory),
          knowledge: sanitizeKnowledge(Array.isArray(snap.knowledge) ? snap.knowledge : base.knowledge),
          knowledgeSources:
            snap.knowledgeSources && typeof snap.knowledgeSources === "object"
              ? (snap.knowledgeSources as Record<string, KnowledgeSource>)
              : base.knowledgeSources,
          customProviders: Array.isArray(snap.customProviders) ? snap.customProviders : base.customProviders,
          agentTeams: mergeTeamsWithDefaults(
            Array.isArray(snap.agentTeams) ? (snap.agentTeams as AgentTeam[]) : base.agentTeams,
          ),
          ceoAgents: normalizeCeoAgents(snap.ceoAgents ?? base.ceoAgents),
          customAgents: normalizeCustomAgents(snap.customAgents ?? base.customAgents),
          activeCustomAgentId:
            typeof snap.activeCustomAgentId === "string" ? snap.activeCustomAgentId : null,
          mainAgentPrompts: normalizeMainAgentPrompts(snap.mainAgentPrompts ?? base.mainAgentPrompts),
          activeMainAgentPromptId:
            typeof snap.activeMainAgentPromptId === "string" ? snap.activeMainAgentPromptId : null,
          taskModes: normalizeTaskModes(snap.taskModes ?? base.taskModes),
          promptLibrary: normalizePromptLibrary(
            (snap as { promptLibrary?: unknown }).promptLibrary ?? base.promptLibrary,
          ),
          activeTaskModeId:
            typeof snap.activeTaskModeId === "string" ? snap.activeTaskModeId : null,
          planModePrompt: normalizePlanModePrompt(snap.planModePrompt ?? base.planModePrompt),
          agentMode: normalizeAgentMode(
            (snap as { agentMode?: unknown }).agentMode ?? base.agentMode,
          ),
          connectors: normalizeConnectors(snap.connectors ?? base.connectors),
          mcpServers: normalizeMcpServers(snap.mcpServers ?? base.mcpServers),
        };

        const profileConvs = conversations.filter(
          (c) => (c.profileId ?? activePid) === activePid,
        );
        const storedCurrent =
          typeof snap.currentId === "string" ? snap.currentId : null;
        const legacyCurrent =
          typeof state.currentSessionId === "string" ? (state.currentSessionId as string) : null;
        const currentId =
          storedCurrent && profileConvs.some((c) => c.id === storedCurrent)
            ? storedCurrent
            : legacyCurrent && profileConvs.some((c) => c.id === legacyCurrent)
              ? legacyCurrent
              : (profileConvs[0]?.id ?? null);
        profileStates = {
          ...profileStates,
          [activePid]: { ...cloneJson(fromSnap), currentId },
        };

        set({
          hydrated: true,
          conversations,
          currentId,
          ...fromSnap,
          userProfiles,
          activeUserProfileId: activePid,
          profileStates,
          profileSessions,
        });
      },

      newConversation: () => {
        // 20-character alphanumeric session id — the database key for this chat.
        const id = newSessionId();
        const conv: Conversation = {
          id,
          title: "New thread",
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          profileId: activeProfileIdOf(get()),
          loaded: true,
        };
        set((s) => ({ conversations: [conv, ...s.conversations], currentId: id, section: "chat" }));
        return id;
      },

      branchConversation: () => {
        const { currentId, conversations } = get();
        const parent = conversations.find((c) => c.id === currentId);
        if (!parent) return null;
        // A fresh backend session id: no past context is ever sent for it, so the main
        // agent, custom agents, team/CEO agents, and sub-agents all start clean.
        const id = newSessionId();
        const siblingCount = conversations.filter((c) => c.parentId === parent.id).length;
        const conv: Conversation = {
          id,
          title: `${parent.title} (branch ${siblingCount + 1})`,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          profileId: parent.profileId ?? activeProfileIdOf(get()),
          parentId: parent.id,
          loaded: true,
        };
        set((s) => ({ conversations: [conv, ...s.conversations], currentId: id, section: "chat" }));
        return id;
      },

      forkConversation: (sourceId, newId) => {
        const { currentId, conversations } = get();
        const source = conversations.find((c) => c.id === (sourceId ?? currentId));
        if (!source) return null;
        // Stubs (loaded=false) carry no messages yet — forking them would silently
        // drop history, so refuse and let the caller load first.
        if (source.loaded === false) return null;
        const id = newId && newId.trim().length > 0 ? newId.trim() : newSessionId();
        if (conversations.some((c) => c.id === id)) return null;
        let messages: Conversation["messages"];
        try {
          messages =
            typeof structuredClone === "function"
              ? structuredClone(source.messages)
              : JSON.parse(JSON.stringify(source.messages));
        } catch {
          messages = JSON.parse(JSON.stringify(source.messages));
        }
        const now = Date.now();
        const conv: Conversation = {
          id,
          title: `${source.title} (fork)`.slice(0, 200),
          messages,
          createdAt: now,
          updatedAt: now,
          profileId: source.profileId ?? activeProfileIdOf(get()),
          parentId: source.id,
          messageCount: source.messageCount,
          loaded: true,
        };
        set((s) => ({ conversations: [conv, ...s.conversations], currentId: id, section: "chat" }));
        // A fork copies the server-side event log too (see forkSessionData), so it inherits
        // the source's logged usage — mirror that locally so the meter shows immediately
        // instead of waiting for the next reply. (A branch starts a fresh backend session
        // with no log history, so it correctly starts empty.)
        const inherited = get().contextUsage[source.id];
        if (inherited) get().setContextUsage(id, { ...inherited });
        const inheritedCustom = get().customContextUsage[source.id];
        if (inheritedCustom) get().setCustomContextUsage(id, { ...inheritedCustom });
        const inheritedChat = get().chatContextUsage[source.id];
        if (inheritedChat) get().setChatContextUsage(id, { ...inheritedChat });
        const inheritedSub = get().subAgentUsage[source.id];
        if (inheritedSub) {
          for (const entry of Object.values(inheritedSub)) get().setSubAgentUsage(id, { ...entry });
        }
        const inheritedTeam = get().teamUsage[source.id];
        if (inheritedTeam) {
          for (const entry of Object.values(inheritedTeam)) get().setTeamUsage(id, { ...entry });
        }
        const inheritedCeo = get().ceoUsage[source.id];
        if (inheritedCeo) {
          for (const entry of Object.values(inheritedCeo)) get().setCeoUsage(id, { ...entry });
        }
        return id;
      },

      replaceConversation: (conv) =>
        set((s) => ({
          conversations: s.conversations.some((c) => c.id === conv.id)
            ? s.conversations.map((c) => (c.id === conv.id ? { ...conv, loaded: true } : c))
            : [{ ...conv, loaded: true }, ...s.conversations],
        })),

      ensureConversation: () => {
        const { currentId } = get();
        if (currentId && get().conversations.some((c) => c.id === currentId)) return currentId;
        return get().newConversation();
      },

      selectConversation: (id) => set({ currentId: id, section: "chat" }),

      deleteConversation: (id) =>
        set((s) => {
          const conversations = s.conversations.filter((c) => c.id !== id);
          const currentId = s.currentId === id ? (conversations[0]?.id ?? null) : s.currentId;
          const activeRun = s.activeRun?.chatId === id ? null : s.activeRun;
          // Drop the meter readings with the thread so a recycled id can never show stale usage.
          const contextUsage = { ...s.contextUsage };
          delete contextUsage[id];
          const customContextUsage = { ...s.customContextUsage };
          delete customContextUsage[id];
          const chatContextUsage = { ...s.chatContextUsage };
          delete chatContextUsage[id];
          const subAgentUsage = { ...s.subAgentUsage };
          delete subAgentUsage[id];
          const teamUsage = { ...s.teamUsage };
          delete teamUsage[id];
          const ceoUsage = { ...s.ceoUsage };
          delete ceoUsage[id];
          const summaryHandoffs = { ...s.summaryHandoffs };
          delete summaryHandoffs[id];
          const summaryHistory = { ...s.summaryHistory };
          delete summaryHistory[id];
          const subAgentSummaries = { ...s.subAgentSummaries };
          delete subAgentSummaries[id];
          return { conversations, currentId, activeRun, contextUsage, customContextUsage, chatContextUsage, subAgentUsage, teamUsage, ceoUsage, summaryHandoffs, summaryHistory, subAgentSummaries };
        }),

      renameConversation: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
        })),

      addMessage: (convId, message) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId ? touch({ ...c, messages: [...c.messages, message] }) : c,
          ),
        })),

      updateMessage: (convId, msgId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? { ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)) }
              : c,
          ),
        })),

      resetMessageStream: (convId, msgId) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === msgId
                      ? { ...m, content: "", reasoning: "", tools: [], team: undefined, streaming: true }
                      : m,
                  ),
                }
              : c,
          ),
        })),

      applyAssistantDelta: (convId, msgId, delta) =>
        set((s) => {
          const activeRun =
            delta.lastEventId != null && s.activeRun && s.activeRun.chatId === convId
              ? { ...s.activeRun, lastEventId: delta.lastEventId }
              : s.activeRun;
          if (!delta.contentDelta && !delta.reasoningDelta) {
            return activeRun === s.activeRun ? {} : { activeRun };
          }
          return {
            activeRun,
            conversations: s.conversations.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === msgId
                        ? {
                            ...m,
                            content: delta.contentDelta ? m.content + delta.contentDelta : m.content,
                            reasoning: delta.reasoningDelta
                              ? (m.reasoning ?? "") + delta.reasoningDelta
                              : m.reasoning,
                          }
                        : m,
                    ),
                  }
                : c,
            ),
          };
        }),

      upsertTool: (convId, msgId, tool) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id !== msgId) return m;
                    const tools = m.tools ? [...m.tools] : [];
                    const idx = tools.findIndex((t) => t.id === tool.id);
                    if (idx === -1) tools.push(tool);
                    else tools[idx] = { ...tools[idx], ...tool };
                    return { ...m, tools };
                  }),
                }
              : c,
          ),
        })),

      setActiveRun: (activeRun) => set({ activeRun }),
      setActiveRunCursor: (lastEventId) =>
        set((s) => (s.activeRun ? { activeRun: { ...s.activeRun, lastEventId } } : {})),

      setPlanPending: (convId, msgId, toolId, info) =>
        set((s) => ({
          conversations: patchTool(
            s.conversations,
            convId,
            msgId,
            toolId,
            (tool) => ({ ...tool, plan: { ...info, status: "pending" as const } }),
            () => ({
              id: toolId,
              name: "submit_plan",
              label: "Submit Plan",
              status: "running",
              plan: { ...info, status: "pending" as const },
            }),
          ),
        })),

      setPlanStatus: (convId, msgId, toolId, status) =>
        set((s) => ({
          conversations: patchTool(s.conversations, convId, msgId, toolId, (tool) =>
            tool.plan ? { ...tool, plan: { ...tool.plan, status } } : tool,
          ),
        })),

      updatePlanForTool: (toolId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.tools?.some((t) => t.plan?.id === toolId)
                ? {
                    ...m,
                    tools: m.tools.map((t) =>
                      t.plan?.id === toolId
                        ? {
                            ...t,
                            plan: { ...t.plan, ...patch },
                            status: patch.status && patch.status !== "pending" ? "ok" : t.status,
                          }
                        : t,
                    ),
                  }
                : m,
            ),
          })),
        })),

      setQuestionPending: (convId, msgId, toolId, info) =>
        set((s) => ({
          conversations: patchTool(
            s.conversations,
            convId,
            msgId,
            toolId,
            (tool) => ({ ...tool, ask: { ...info, status: "pending" as const } }),
            () => ({
              id: toolId,
              name: "ask_question_to_user",
              label: `Ask ${info.questions.length} Question${info.questions.length === 1 ? "" : "s"}`,
              status: "running",
              ask: { ...info, status: "pending" as const },
            }),
          ),
        })),

      setQuestionStatus: (convId, msgId, toolId, status) =>
        set((s) => ({
          conversations: patchTool(s.conversations, convId, msgId, toolId, (tool) =>
            tool.ask ? { ...tool, ask: { ...tool.ask, status } } : tool,
          ),
        })),

      updateQuestionForTool: (toolId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.tools?.some((t) => t.ask?.id === toolId)
                ? {
                    ...m,
                    tools: m.tools.map((t) =>
                      t.ask?.id === toolId
                        ? {
                            ...t,
                            ask: { ...t.ask, ...patch },
                            status: patch.status && patch.status !== "pending" ? "ok" : t.status,
                          }
                        : t,
                    ),
                  }
                : m,
            ),
          })),
        })),

      startSubAgent: (convId, msgId, toolId, run) =>
        set((s) => ({
          conversations: patchTool(
            s.conversations,
            convId,
            msgId,
            toolId,
            (tool) => ({
              ...tool,
              subAgent: tool.subAgent
                ? {
                    ...tool.subAgent,
                    agent: run.agent,
                    task: run.task,
                    background: run.background ?? tool.subAgent.background,
                    sentContext: run.sentContext ?? tool.subAgent.sentContext,
                    outputFile: run.outputFile ?? tool.subAgent.outputFile,
                  }
                : emptyRun(run),
            }),
            () => ({
              id: toolId,
              name: "call_sub_agent",
              label: `Sub-Agent: ${run.agent}${run.background ? " (background)" : ""}`,
              status: "running",
              subAgent: emptyRun(run),
            }),
          ),
        })),

      applySubAgentDelta: (convId, msgId, toolId, delta) =>
        set((s) => {
          const applyDelta = (run: SubAgentRun): SubAgentRun => ({
            ...run,
            output: delta.outputDelta ? run.output + delta.outputDelta : run.output,
            reasoning: delta.reasoningDelta ? run.reasoning + delta.reasoningDelta : run.reasoning,
          });
          // Token/reasoning deltas are keyed only by the run's own event id (toolId). That id is a
          // top-level call_sub_agent chip, OR a child of a call_multiple_sub_agents batch. Locate
          // whichever holds the run so batch children stream correctly too.
          return {
            conversations: s.conversations.map((c) =>
              c.id !== convId
                ? c
                : {
                    ...c,
                    messages: c.messages.map((m) => {
                      if (m.id !== msgId || !m.tools) return m;
                      return {
                        ...m,
                        tools: m.tools.map((t) => {
                          if (t.id === toolId && t.subAgent) {
                            return { ...t, subAgent: applyDelta(t.subAgent) };
                          }
                          if (t.multiRuns && t.multiRuns[toolId]) {
                            return {
                              ...t,
                              multiRuns: { ...t.multiRuns, [toolId]: applyDelta(t.multiRuns[toolId]!) },
                            };
                          }
                          return t;
                        }),
                      };
                    }),
                  },
            ),
          };
        }),

      upsertSubAgentTool: (convId, msgId, toolId, subTool) =>
        set((s) => ({
          conversations: patchTool(s.conversations, convId, msgId, toolId, (tool) => {
            const run = tool.subAgent ?? emptyRun({ agent: "", task: "" });
            const tools = [...run.tools];
            const idx = tools.findIndex((t) => t.id === subTool.id);
            if (idx === -1) tools.push(subTool);
            else tools[idx] = { ...tools[idx], ...subTool };
            return { ...tool, subAgent: { ...run, tools } };
          }),
        })),

      finishSubAgent: (convId, msgId, toolId, patch) =>
        set((s) => ({
          conversations: patchTool(s.conversations, convId, msgId, toolId, (tool) => {
            const run = tool.subAgent ?? emptyRun({ agent: "", task: "" });
            return {
              ...tool,
              subAgent: {
                ...run,
                status: patch.status,
                output: patch.output != null && patch.output.length > 0 ? patch.output : run.output,
                error: patch.error,
              },
            };
          }),
        })),

      startMultiSubAgents: (convId, msgId, toolId, label, children) =>
        set((s) => ({
          conversations: patchTool(
            s.conversations,
            convId,
            msgId,
            toolId,
            (tool) => {
              // Merge in any children not already present (idempotent across replays), keeping the
              // requested order and preserving live state for children that already started.
              const multiRuns = { ...tool.multiRuns };
              const multiOrder = [...(tool.multiOrder ?? [])];
              for (const child of children) {
                if (!multiRuns[child.id]) {
                  multiRuns[child.id] = emptyRun(child.run);
                  if (!multiOrder.includes(child.id)) multiOrder.push(child.id);
                }
              }
              return { ...tool, name: "call_multiple_sub_agents", label, multiRuns, multiOrder };
            },
            () => ({
              id: toolId,
              name: "call_multiple_sub_agents",
              label,
              status: "running",
              multiRuns: Object.fromEntries(children.map((c) => [c.id, emptyRun(c.run)])),
              multiOrder: children.map((c) => c.id),
            }),
          ),
        })),

      startSubAgentInParent: (convId, msgId, parentToolId, childId, run) =>
        set((s) => ({
          conversations: patchMultiRun(
            s.conversations,
            convId,
            msgId,
            parentToolId,
            childId,
            (existing) => ({
              ...existing,
              agent: run.agent || existing.agent,
              task: run.task || existing.task,
              background: run.background ?? existing.background,
              sentContext: run.sentContext ?? existing.sentContext,
              outputFile: run.outputFile ?? existing.outputFile,
            }),
            () => emptyRun(run),
          ),
        })),

      upsertSubAgentToolInParent: (convId, msgId, parentToolId, childId, subTool) =>
        set((s) => ({
          conversations: patchMultiRun(
            s.conversations,
            convId,
            msgId,
            parentToolId,
            childId,
            (run) => {
              const tools = [...run.tools];
              const idx = tools.findIndex((t) => t.id === subTool.id);
              if (idx === -1) tools.push(subTool);
              else tools[idx] = { ...tools[idx], ...subTool };
              return { ...run, tools };
            },
            () => emptyRun({ agent: "", task: "" }),
          ),
        })),

      finishSubAgentInParent: (convId, msgId, parentToolId, childId, patch) =>
        set((s) => ({
          conversations: patchMultiRun(
            s.conversations,
            convId,
            msgId,
            parentToolId,
            childId,
            (run) => ({
              ...run,
              status: patch.status,
              output: patch.output != null && patch.output.length > 0 ? patch.output : run.output,
              error: patch.error,
            }),
            () => emptyRun({ agent: "", task: "" }),
          ),
        })),

      addSubAgent: (input) =>
        set((s) => {
          const now = Date.now();
          const agent: SubAgent = { id: uid("sa"), createdAt: now, updatedAt: now, ...input };
          return { subAgents: [agent, ...s.subAgents] };
        }),

      updateSubAgent: (id, patch) =>
        set((s) => ({
          subAgents: s.subAgents.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)),
        })),

      deleteSubAgent: (id) => set((s) => ({ subAgents: s.subAgents.filter((a) => a.id !== id) })),

      toggleSubAgent: (id) =>
        set((s) => ({
          subAgents: s.subAgents.map((a) =>
            a.id === id ? { ...a, enabled: !a.enabled, updatedAt: Date.now() } : a,
          ),
        })),

      // ---- Agent team management -------------------------------------------------
      addTeam: (team) =>
        set((s) => ({
          agentTeams: enforceSingleActive([{ ...team, updatedAt: Date.now() }, ...s.agentTeams]),
        })),

      updateTeam: (id, patch) =>
        set((s) => ({
          agentTeams: enforceSingleActive(
            s.agentTeams.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)),
          ),
        })),

      deleteTeam: (id) => set((s) => ({ agentTeams: s.agentTeams.filter((t) => t.id !== id) })),

      setActiveTeam: (id, enabled) =>
        set((s) => ({
          agentTeams: s.agentTeams.map((t) =>
            t.id === id
              ? { ...t, enabled, updatedAt: Date.now() }
              : enabled
                ? { ...t, enabled: false } // only one team active at a time
                : t,
          ),
        })),

      // ---- CEO agent management (top-level multi-team coordinators) --------------
      addCeo: (ceo) =>
        set((s) => ({
          ceoAgents: enforceSingleActiveCeo([{ ...ceo, updatedAt: Date.now() }, ...s.ceoAgents]),
        })),

      updateCeo: (id, patch) =>
        set((s) => ({
          ceoAgents: enforceSingleActiveCeo(
            s.ceoAgents.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)),
          ),
        })),

      deleteCeo: (id) => set((s) => ({ ceoAgents: s.ceoAgents.filter((c) => c.id !== id) })),

      setActiveCeo: (id, enabled) =>
        set((s) => ({
          ceoAgents: s.ceoAgents.map((c) =>
            c.id === id
              ? { ...c, enabled, updatedAt: Date.now() }
              : enabled
                ? { ...c, enabled: false } // only one CEO active at a time
                : c,
          ),
        })),

      // ---- Custom agent management (top-level, user-created Main Agents) ----------
      addCustomAgent: (input) => {
        const now = Date.now();
        const agent: CustomAgent = { id: uid("agent"), createdAt: now, updatedAt: now, ...input };
        set((s) => ({ customAgents: [agent, ...s.customAgents] }));
        return agent;
      },

      updateCustomAgent: (id, patch) =>
        set((s) => ({
          customAgents: s.customAgents.map((a) =>
            a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a,
          ),
        })),

      deleteCustomAgent: (id) =>
        set((s) => ({
          customAgents: s.customAgents.filter((a) => a.id !== id),
          // Deleting the active agent falls back to the built-in Main Agent.
          activeCustomAgentId: s.activeCustomAgentId === id ? null : s.activeCustomAgentId,
        })),

      // Mirror the backend custom-agent list into the store. Used when an agent's
      // custom-agent tools (create/delete) mutate the shared store mid-turn: the
      // `custom_agents_updated` event carries the complete list, and the panel
      // refresh on open fetches the same truth — so the panel converges immediately.
      setCustomAgents: (agents) =>
        set((s) => {
          const normalized = normalizeCustomAgents(agents);
          const ids = new Set(normalized.map((a) => a.id));
          return {
            customAgents: normalized,
            // Deleting the active agent elsewhere falls back to the Main Agent.
            activeCustomAgentId:
              s.activeCustomAgentId && !ids.has(s.activeCustomAgentId)
                ? null
                : s.activeCustomAgentId,
          };
        }),

      setActiveCustomAgent: (id) =>
        set(() => ({ activeCustomAgentId: id && id !== MAIN_AGENT_ID ? id : null })),

      // ---- Custom System Prompts for the built-in Main Agent ---------------------
      // These change ONLY the instructions the existing Main Agent runs with. They never create a
      // new agent, sub-agent, or team. Exactly one prompt can be active at a time; null falls back to
      // the built-in Main Agent system prompt.
      addMainAgentPrompt: (input) => {
        const now = Date.now();
        const prompt: MainAgentPrompt = { id: newMainAgentPromptId(), createdAt: now, updatedAt: now, ...input };
        set((s) => ({ mainAgentPrompts: [prompt, ...s.mainAgentPrompts] }));
        return prompt;
      },

      updateMainAgentPrompt: (id, patch) =>
        set((s) => ({
          mainAgentPrompts: s.mainAgentPrompts.map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
          ),
        })),

      deleteMainAgentPrompt: (id) =>
        set((s) => ({
          mainAgentPrompts: s.mainAgentPrompts.filter((p) => p.id !== id),
          // Deleting the active prompt falls back to the built-in Main Agent system prompt.
          activeMainAgentPromptId: s.activeMainAgentPromptId === id ? null : s.activeMainAgentPromptId,
        })),

      // Mirror the backend prompt list into the store. Used when an agent's
      // custom-system-prompt tools (save/delete) mutate the shared store mid-turn: the
      // `main_agent_prompts_updated` event carries the complete list, and the panel
      // refresh on open fetches the same truth — so the panel converges immediately.
      setMainAgentPrompts: (prompts) =>
        set((s) => {
          const normalized = normalizeMainAgentPrompts(prompts);
          const ids = new Set(normalized.map((p) => p.id));
          return {
            mainAgentPrompts: normalized,
            // Deleting the active prompt elsewhere falls back to the built-in prompt.
            activeMainAgentPromptId:
              s.activeMainAgentPromptId && !ids.has(s.activeMainAgentPromptId)
                ? null
                : s.activeMainAgentPromptId,
          };
        }),

      setActiveMainAgentPrompt: (id) => set(() => ({ activeMainAgentPromptId: id || null })),

      // ---- Task modes for the prompt box (plan / default / custom) ----------------
      addTaskMode: (input) => {
        const now = Date.now();
        const mode: CustomTaskMode = { id: uid("tmode"), createdAt: now, updatedAt: now, ...input };
        set((s) => ({ taskModes: [mode, ...s.taskModes] }));
        return mode;
      },

      updateTaskMode: (id, patch) =>
        set((s) => ({
          taskModes: s.taskModes.map((m) =>
            m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m,
          ),
        })),

      deleteTaskMode: (id) =>
        set((s) => ({
          taskModes: s.taskModes.filter((m) => m.id !== id),
          activeTaskModeId: s.activeTaskModeId === id ? null : s.activeTaskModeId,
        })),

      setActiveTaskMode: (id) => set(() => ({ activeTaskModeId: id || null })),

      setPlanModePrompt: (planModePrompt) => set(() => ({ planModePrompt })),

      setAgentMode: (mode) => set(() => ({ agentMode: mode === "chat" ? "chat" : "agent" })),

      // ---- Prompt library (user-saved reusable prompts) ----------------------
      addPromptLibraryItem: (input) => {
        const now = Date.now();
        const item: PromptLibraryItem = {
          id: newPromptLibraryId(),
          createdAt: now,
          updatedAt: now,
          ...input,
        };
        set((s) => ({ promptLibrary: [item, ...s.promptLibrary] }));
        return item;
      },

      updatePromptLibraryItem: (id, patch) =>
        set((s) => ({
          promptLibrary: s.promptLibrary.map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
          ),
        })),

      deletePromptLibraryItem: (id) =>
        set((s) => ({ promptLibrary: s.promptLibrary.filter((p) => p.id !== id) })),

      setComposerPrefill: (composerPrefill) => set(() => ({ composerPrefill })),

      // ---- Connector connections (third-party apps via Composio) ----------------
      setConnectors: (connectors) => set(() => ({ connectors: normalizeConnectors(connectors) })),

      setConnector: (connection) =>
        set((s) => {
          const normalized = normalizeConnectors([connection])[0];
          if (!normalized) return {};
          const rest = s.connectors.filter((c) => c.connectorId !== normalized.connectorId);
          return { connectors: [...rest, normalized] };
        }),

      removeConnector: (connectorId) =>
        set((s) => ({
          connectors: s.connectors.filter(
            (c) => c.connectorId !== connectorId.trim().toLowerCase(),
          ),
        })),

      // ---- MCP servers (remote Streamable HTTP + local stdio) ----------------
      setMcpServers: (mcpServers) => set(() => ({ mcpServers: normalizeMcpServers(mcpServers) })),

      upsertMcpServer: (server) =>
        set((s) => {
          const normalized = normalizeMcpServers([server])[0];
          if (!normalized) return {};
          const rest = s.mcpServers.filter((m) => m.id !== normalized.id);
          return { mcpServers: [...rest, normalized] };
        }),

      removeMcpServer: (id) =>
        set((s) => ({ mcpServers: s.mcpServers.filter((m) => m.id !== id) })),

      setMcpServerEnabled: (id, enabled) =>
        set((s) => ({
          mcpServers: s.mcpServers.map((m) => (m.id === id ? { ...m, enabled } : m)),
        })),

      setMcpToolEnabled: (id, tool, enabled) =>
        set((s) => ({
          mcpServers: s.mcpServers.map((m) => {
            if (m.id !== id) return m;
            const disabled = new Set(m.disabledTools);
            if (enabled) disabled.delete(tool);
            else disabled.add(tool);
            return { ...m, disabledTools: [...disabled] };
          }),
        })),

      // ---- Messaging channels (backend-owned, ephemeral mirror) ----------------
      setChannelConnections: (channelConnections) => set(() => ({ channelConnections })),

      upsertChannelConnection: (connection) =>
        set((s) => {
          const rest = s.channelConnections.filter((c) => c.id !== connection.id);
          return { channelConnections: [...rest, connection] };
        }),

      removeChannelConnection: (id) =>
        set((s) => ({ channelConnections: s.channelConnections.filter((c) => c.id !== id) })),

      // ---- Schedules (persistent cron tasks, backend-owned) ----------------
      setSchedules: (schedules) => set(() => ({ schedules })),

      // ---- User profiles (account identities with fully isolated state) --------
      addUserProfile: (input) => {
        const now = Date.now();
        const profile: UserProfile = {
          id: uid("profile"),
          createdAt: now,
          updatedAt: now,
          ...input,
          name: input.name.trim().slice(0, 70),
          description: input.description.trim().slice(0, 300),
        };
        set((s) => ({ userProfiles: mergeProfilesWithDefaults([profile, ...s.userProfiles]) }));
        return profile;
      },

      updateUserProfile: (id, patch) =>
        set((s) => ({
          userProfiles: mergeProfilesWithDefaults(
            s.userProfiles.map((pr) =>
              pr.id === id
                ? {
                    ...pr,
                    ...(patch.name !== undefined
                      ? { name: patch.name.trim().slice(0, 70) || pr.name }
                      : {}),
                    ...(patch.description !== undefined
                      ? { description: patch.description.trim().slice(0, 300) }
                      : {}),
                    ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
                    updatedAt: Date.now(),
                  }
                : pr,
            ),
          ),
        })),

      deleteUserProfile: (id) => {
        const s = get();
        if (s.streaming) return "Stop the running agent before deleting a profile.";
        if (isDefaultProfile(id)) return "The default profile cannot be deleted.";
        if (s.userProfiles.length <= 1) return "At least one profile must remain.";
        if (!s.userProfiles.some((pr) => pr.id === id)) return "Profile not found.";
        const remaining = s.userProfiles.filter((pr) => pr.id !== id);
        const wasActive = activeProfileIdOf(s) === id;
        const fallback = remaining.find((pr) => isDefaultProfile(pr.id)) ?? remaining[0]!;
        // Dropping its conversations deletes their server rows via the sync bridge.
        const conversations = s.conversations.filter(
          (c) => (c.profileId ?? DEFAULT_PROFILE_ID) !== id,
        );
        const profileStates = { ...s.profileStates };
        delete profileStates[id];
        const profileSessions = { ...s.profileSessions };
        delete profileSessions[id];
        if (!wasActive) {
          set({
            userProfiles: mergeProfilesWithDefaults(remaining),
            conversations,
            profileStates,
            profileSessions,
          });
          return null;
        }
        // The active profile is gone: restore the fallback profile's stashed state
        // (fresh defaults when it has none) so no deleted data lingers on screen.
        const stored = profileStates[fallback.id] ?? freshProfileSnapshot();
        const next = cloneJson(stored);
        const owned = conversations.filter(
          (c) => (c.profileId ?? DEFAULT_PROFILE_ID) === fallback.id,
        );
        const currentId = owned[0]?.id ?? null;
        set({
          ...next,
          subAgents: mergeSubAgentsWithDefaults(next.subAgents),
          skills: mergeSkillsWithDefaults(next.skills),
          memory: mergeMemoryWithDefaults(next.memory),
          knowledge: sanitizeKnowledge(next.knowledge),
          agentTeams: mergeTeamsWithDefaults(next.agentTeams),
          ceoAgents: normalizeCeoAgents(next.ceoAgents),
          customAgents: normalizeCustomAgents(next.customAgents),
          mainAgentPrompts: normalizeMainAgentPrompts(next.mainAgentPrompts),
          taskModes: normalizeTaskModes(next.taskModes),
          promptLibrary: normalizePromptLibrary(
            (next as { promptLibrary?: unknown }).promptLibrary ?? [],
          ),
          planModePrompt: normalizePlanModePrompt(next.planModePrompt),
          agentMode: normalizeAgentMode((next as { agentMode?: unknown }).agentMode),
          connectors: normalizeConnectors(next.connectors),
          mcpServers: normalizeMcpServers(next.mcpServers),
          userProfiles: mergeProfilesWithDefaults(remaining),
          activeUserProfileId: fallback.id,
          conversations,
          currentId,
          activeRun: null,
          attachedFiles: [],
          preview: { url: "", open: false },
          section: "chat",
          profileStates: { ...profileStates, [fallback.id]: { ...next, currentId } },
          profileSessions: {
            ...profileSessions,
            [fallback.id]: owned.map((c) => c.id),
          },
        });
        return null;
      },

      switchUserProfile: (id) => {
        const s = get();
        if (s.streaming || s.activeRun) return "Stop the running agent before switching profiles.";
        const target = s.userProfiles.find((pr) => pr.id === id);
        if (!target) return "Profile not found.";
        const fromId = activeProfileIdOf(s);
        if (fromId === id) return null;
        // Stash the current profile's full workspace state + session list first, so
        // nothing is lost and nothing leaks into the target profile.
        const snapshot = captureProfileSnapshot(s);
        const profileStates = { ...s.profileStates, [fromId]: snapshot };
        const profileSessions = {
          ...s.profileSessions,
          [fromId]: sessionIdsOf(s.conversations, fromId),
        };
        // Restore the target (fresh defaults when it has never been opened).
        const stored = profileStates[id] ?? freshProfileSnapshot();
        const next = cloneJson(stored);
        const owned = s.conversations.filter((c) => (c.profileId ?? DEFAULT_PROFILE_ID) === id);
        const currentId =
          next.currentId && owned.some((c) => c.id === next.currentId)
            ? next.currentId
            : (owned[0]?.id ?? null);
        set({
          ...next,
          subAgents: mergeSubAgentsWithDefaults(next.subAgents),
          skills: mergeSkillsWithDefaults(next.skills),
          memory: mergeMemoryWithDefaults(next.memory),
          knowledge: sanitizeKnowledge(next.knowledge),
          agentTeams: mergeTeamsWithDefaults(next.agentTeams),
          ceoAgents: normalizeCeoAgents(next.ceoAgents),
          customAgents: normalizeCustomAgents(next.customAgents),
          mainAgentPrompts: normalizeMainAgentPrompts(next.mainAgentPrompts),
          taskModes: normalizeTaskModes(next.taskModes),
          promptLibrary: normalizePromptLibrary(
            (next as { promptLibrary?: unknown }).promptLibrary ?? [],
          ),
          planModePrompt: normalizePlanModePrompt(next.planModePrompt),
          agentMode: normalizeAgentMode((next as { agentMode?: unknown }).agentMode),
          connectors: normalizeConnectors(next.connectors),
          mcpServers: normalizeMcpServers(next.mcpServers),
          currentId,
          activeUserProfileId: id,
          profileStates: { ...profileStates, [id]: { ...next, currentId } },
          profileSessions: { ...profileSessions, [id]: sessionIdsOf(s.conversations, id) },
          attachedFiles: [],
          preview: { url: "", open: false },
          activeRun: null,
          section: "chat",
          // Meter readings belong to conversations, not profiles: drop them so the target
          // profile never shows the previous profile's numbers. Each opened thread
          // reloads its own logged usage from the database via loadConversationIfNeeded.
          contextUsage: {},
          customContextUsage: {},
          chatContextUsage: {},
          subAgentUsage: {},
          teamUsage: {},
          ceoUsage: {},
          subAgentSummaries: {},
        });
        return null;
      },

      duplicateUserProfile: async (id) => {
        const s = get();
        if (s.streaming || s.activeRun) return null;
        const source = s.userProfiles.find((pr) => pr.id === id);
        if (!source) return null;
        const now = Date.now();
        const copy: UserProfile = {
          id: uid("profile"),
          name: `${source.name} (copy)`.slice(0, 70),
          description: source.description,
          avatar: source.avatar,
          createdAt: now,
          updatedAt: now,
        };
        // Deep-copy the workspace snapshot (or the live slices when duplicating the
        // active profile, whose snapshot slot holds its previously stashed state).
        const fromId = activeProfileIdOf(s);
        const liveSnap = fromId === id ? captureProfileSnapshot(s) : null;
        const stored = liveSnap ?? s.profileStates[id] ?? freshProfileSnapshot();
        const snap = cloneJson(stored);
        // Copy every chat: brand-new session ids under the new profile. Server-side
        // forks are best-effort (the snapshot sync recreates any missing server row).
        const sources = s.conversations.filter((c) => (c.profileId ?? DEFAULT_PROFILE_ID) === id);
        const copies: Conversation[] = [];
        for (const src of sources) {
          if (src.loaded === false) continue;
          const nid = newSessionId();
          try {
            await forkSessionData(src.id, nid, `${src.title} (copy)`.slice(0, 200));
          } catch {
            // best effort — the local copy below still syncs up on its own
          }
          let messages: Conversation["messages"];
          try {
            messages =
              typeof structuredClone === "function"
                ? structuredClone(src.messages)
                : JSON.parse(JSON.stringify(src.messages));
          } catch {
            messages = JSON.parse(JSON.stringify(src.messages));
          }
          copies.push({
            ...cloneJson(src),
            id: nid,
            title: `${src.title} (copy)`.slice(0, 200),
            messages,
            createdAt: now,
            updatedAt: now,
            profileId: copy.id,
            parentId: src.id,
            loaded: true,
          });
        }
        snap.currentId = copies[0]?.id ?? null;
        set((prev) => ({
          userProfiles: mergeProfilesWithDefaults([copy, ...prev.userProfiles]),
          activeUserProfileId: copy.id,
          conversations: [...copies, ...prev.conversations],
          ...cloneJson(snap),
          subAgents: mergeSubAgentsWithDefaults(snap.subAgents),
          skills: mergeSkillsWithDefaults(snap.skills),
          memory: mergeMemoryWithDefaults(snap.memory),
          knowledge: sanitizeKnowledge(snap.knowledge),
          agentTeams: mergeTeamsWithDefaults(snap.agentTeams),
          ceoAgents: normalizeCeoAgents(snap.ceoAgents),
          customAgents: normalizeCustomAgents(snap.customAgents),
          mainAgentPrompts: normalizeMainAgentPrompts(snap.mainAgentPrompts),
          taskModes: normalizeTaskModes(snap.taskModes),
          promptLibrary: normalizePromptLibrary(
            (snap as { promptLibrary?: unknown }).promptLibrary ?? [],
          ),
          planModePrompt: normalizePlanModePrompt(snap.planModePrompt),
          agentMode: normalizeAgentMode((snap as { agentMode?: unknown }).agentMode),
          connectors: normalizeConnectors(snap.connectors),
          mcpServers: normalizeMcpServers(snap.mcpServers),
          profileStates: {
            ...prev.profileStates,
            ...(fromId === id ? { [fromId]: captureProfileSnapshot(prev as AppState) } : {}),
            [copy.id]: { ...cloneJson(snap) },
          },
          profileSessions: {
            ...prev.profileSessions,
            ...(fromId === id ? { [fromId]: sessionIdsOf(prev.conversations, fromId) } : {}),
            [copy.id]: copies.map((c) => c.id),
          },
          attachedFiles: [],
          preview: { url: "", open: false },
          activeRun: null,
          section: "chat",
        }));
        return copy.id;
      },

      resetUserProfile: (id) => {
        const s = get();
        if (s.streaming || s.activeRun) return "Stop the running agent before resetting a profile.";
        if (!s.userProfiles.some((pr) => pr.id === id)) return "Profile not found.";
        const fresh = freshProfileSnapshot();
        const isActive = activeProfileIdOf(s) === id;
        // Dropping its conversations deletes their server rows via the sync bridge.
        const conversations = s.conversations.filter(
          (c) => (c.profileId ?? DEFAULT_PROFILE_ID) !== id,
        );
        // Drop meter readings of the removed conversations with them.
        const keptIds = new Set(conversations.map((c) => c.id));
        const contextUsage = Object.fromEntries(
          Object.entries(s.contextUsage).filter(([cid]) => keptIds.has(cid)),
        );
        const customContextUsage = Object.fromEntries(
          Object.entries(s.customContextUsage).filter(([cid]) => keptIds.has(cid)),
        );
        const chatContextUsage = Object.fromEntries(
          Object.entries(s.chatContextUsage).filter(([cid]) => keptIds.has(cid)),
        );
        const subAgentUsage = Object.fromEntries(
          Object.entries(s.subAgentUsage).filter(([cid]) => keptIds.has(cid)),
        );
        const teamUsage = Object.fromEntries(
          Object.entries(s.teamUsage).filter(([cid]) => keptIds.has(cid)),
        );
        const ceoUsage = Object.fromEntries(
          Object.entries(s.ceoUsage).filter(([cid]) => keptIds.has(cid)),
        );
        const subAgentSummaries = Object.fromEntries(
          Object.entries(s.subAgentSummaries).filter(([cid]) => keptIds.has(cid)),
        );
        if (!isActive) {
          set({
            conversations,
            profileStates: { ...s.profileStates, [id]: { ...fresh, currentId: null } },
            profileSessions: { ...s.profileSessions, [id]: [] },
            contextUsage,
            customContextUsage,
            chatContextUsage,
            subAgentUsage,
            teamUsage,
            ceoUsage,
            subAgentSummaries,
          });
          return null;
        }
        set({
          ...cloneJson(fresh),
          subAgents: mergeSubAgentsWithDefaults(fresh.subAgents),
          skills: mergeSkillsWithDefaults(fresh.skills),
          memory: mergeMemoryWithDefaults(fresh.memory),
          knowledge: sanitizeKnowledge(fresh.knowledge),
          agentTeams: mergeTeamsWithDefaults(fresh.agentTeams),
          ceoAgents: normalizeCeoAgents(fresh.ceoAgents),
          customAgents: normalizeCustomAgents(fresh.customAgents),
          mainAgentPrompts: normalizeMainAgentPrompts(fresh.mainAgentPrompts),
          taskModes: normalizeTaskModes(fresh.taskModes),
          promptLibrary: normalizePromptLibrary(
            (fresh as { promptLibrary?: unknown }).promptLibrary ?? [],
          ),
          planModePrompt: normalizePlanModePrompt(fresh.planModePrompt),
          agentMode: normalizeAgentMode((fresh as { agentMode?: unknown }).agentMode),
          connectors: normalizeConnectors(fresh.connectors),
          mcpServers: normalizeMcpServers(fresh.mcpServers),
          conversations,
          currentId: null,
          attachedFiles: [],
          preview: { url: "", open: false },
          activeRun: null,
          section: "chat",
          contextUsage,
          customContextUsage,
          chatContextUsage,
          subAgentUsage,
          teamUsage,
          ceoUsage,
          subAgentSummaries,
          profileStates: { ...s.profileStates, [id]: { ...cloneJson(fresh), currentId: null } },
          profileSessions: { ...s.profileSessions, [id]: [] },
        });
        return null;
      },

      // ---- Multi-agent team live run ---------------------------------------------
      startTeamRun: (convId, msgId, info) =>
        set((s) => {
          const agents: Record<string, TeamAgentBlock> = {};
          const order: string[] = [];
          for (const block of info.roster) {
            agents[block.id] = block;
            order.push(block.id);
          }
          const team: TeamRunState = {
            teamName: info.teamName,
            leaderId: info.leaderId,
            sendMessageEnabled: info.sendMessageEnabled,
            agents,
            order,
            monitor: [],
          };
          return {
            conversations: s.conversations.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m) => (m.id === msgId ? { ...m, team } : m)),
                  }
                : c,
            ),
          };
        }),

      startTeamAgentSegment: (convId, msgId, agentId, info) =>
        set((s) => ({
          conversations: patchTeamRun(s.conversations, convId, msgId, (team) => {
            const existing = team.agents[agentId];
            const block: TeamAgentBlock = existing ?? {
              id: agentId,
              name: info.name ?? agentId,
              role: info.role ?? "member",
              status: "working",
              queued: 0,
              segments: [],
            };
            const segment: TeamAgentSegment = {
              id: `${agentId}-seg-${block.segments.length}`,
              trigger: info.trigger,
              reasoning: "",
              output: "",
              tools: [],
            };
            const updated: TeamAgentBlock = {
              ...block,
              name: info.name ?? block.name,
              role: info.role ?? block.role,
              status: "working",
              segments: [...block.segments, segment],
            };
            const order = team.order.includes(agentId) ? team.order : [...team.order, agentId];
            return { ...team, agents: { ...team.agents, [agentId]: updated }, order };
          }),
        })),

      applyTeamAgentDelta: (convId, msgId, agentId, delta) =>
        set((s) => {
          if (!delta.outputDelta && !delta.reasoningDelta) return {};
          return {
            conversations: patchTeamRun(s.conversations, convId, msgId, (team) => {
              const block = team.agents[agentId];
              if (!block) return team;
              const segments = block.segments.length > 0 ? [...block.segments] : [currentSegment(block)];
              const idx = segments.length - 1;
              const seg = segments[idx]!;
              segments[idx] = {
                ...seg,
                output: delta.outputDelta ? seg.output + delta.outputDelta : seg.output,
                reasoning: delta.reasoningDelta ? seg.reasoning + delta.reasoningDelta : seg.reasoning,
              };
              return { ...team, agents: { ...team.agents, [agentId]: { ...block, segments } } };
            }),
          };
        }),

      upsertTeamAgentTool: (convId, msgId, agentId, tool) =>
        set((s) => ({
          conversations: patchTeamRun(s.conversations, convId, msgId, (team) => {
            const block = team.agents[agentId];
            if (!block) return team;
            const segments = block.segments.length > 0 ? [...block.segments] : [currentSegment(block)];
            const idx = segments.length - 1;
            const seg = segments[idx]!;
            const tools = [...seg.tools];
            const ti = tools.findIndex((t) => t.id === tool.id);
            if (ti === -1) tools.push(tool);
            else tools[ti] = { ...tools[ti], ...tool };
            segments[idx] = { ...seg, tools };
            return { ...team, agents: { ...team.agents, [agentId]: { ...block, segments } } };
          }),
        })),

      setTeamAgentStatus: (convId, msgId, agentId, patch) =>
        set((s) => ({
          conversations: patchTeamRun(s.conversations, convId, msgId, (team) => {
            const block = team.agents[agentId];
            const updatedBlock: TeamAgentBlock = block
              ? {
                  ...block,
                  status: patch.status ?? block.status,
                  queued: patch.queued ?? block.queued,
                }
              : {
                  id: agentId,
                  name: agentId,
                  role: "member",
                  status: patch.status ?? "idle",
                  queued: patch.queued ?? 0,
                  segments: [],
                };
            const order = team.order.includes(agentId) ? team.order : [...team.order, agentId];
            const monitor = [
              ...team.monitor,
              {
                id: uid("mon"),
                at: Date.now(),
                kind: "status" as const,
                agentId,
                status: patch.status,
                queued: patch.queued,
              },
            ].slice(-200);
            return { ...team, agents: { ...team.agents, [agentId]: updatedBlock }, order, monitor };
          }),
        })),

      addTeamMonitorMessage: (convId, msgId, entry) =>
        set((s) => ({
          conversations: patchTeamRun(s.conversations, convId, msgId, (team) => ({
            ...team,
            monitor: [
              ...team.monitor,
              {
                id: uid("mon"),
                at: Date.now(),
                kind: "message" as const,
                from: entry.from,
                to: entry.to,
                messageKind: entry.kind,
                text: entry.text,
              },
            ].slice(-200),
          })),
        })),

      addSkill: (input) =>
        set((s) => {
          const now = Date.now();
          const skill: Skill = { id: uid("skill"), createdAt: now, updatedAt: now, ...input };
          return { skills: [skill, ...s.skills] };
        }),

      updateSkill: (id, patch) =>
        set((s) => ({
          skills: s.skills.map((sk) => (sk.id === id ? { ...sk, ...patch, updatedAt: Date.now() } : sk)),
        })),

      deleteSkill: (id) => set((s) => ({ skills: s.skills.filter((sk) => sk.id !== id) })),

      toggleSkill: (id) =>
        set((s) => ({
          skills: s.skills.map((sk) =>
            sk.id === id ? { ...sk, enabled: !sk.enabled, updatedAt: Date.now() } : sk,
          ),
        })),

      setTodos: (todos) =>
        set((s) => ({
          todos: Array.isArray(todos)
            ? todos.filter(
                (t) =>
                  t &&
                  typeof t === "object" &&
                  typeof t.id === "string" &&
                  typeof t.content === "string",
              )
            : s.todos,
        })),

      setMemory: (files) =>
        set((s) => ({
          memory: Array.isArray(files)
            ? mergeMemoryWithDefaults(
                files.filter(
                  (f) => f && typeof f === "object" && typeof f.path === "string" && f.path.trim().length > 0,
                ),
              )
            : s.memory,
        })),

      saveMemoryFile: (path, content, originalPath) => {
        const cleanPath = canonicalMemoryPath(path.trim().replace(/^[\\/]+/, "").replace(/\/+/g, "/"));
        if (!cleanPath) return "A file path is required.";
        if (/(^|\/)\.\.?(\/|$)/.test(cleanPath)) return "Path cannot contain '.' or '..' segments.";

        const original = originalPath ? canonicalMemoryPath(originalPath) : "";
        if (original && isPreaddedMemory(original) && original.toLowerCase() !== cleanPath.toLowerCase()) {
          return "The four core files (MEMORY.md, SOUL.md, USER.md, session-memory.md) cannot be renamed.";
        }

        const clash = get().memory.some(
          (f) =>
            f.path.toLowerCase() === cleanPath.toLowerCase() &&
            (!original || f.path.toLowerCase() !== original.toLowerCase()),
        );
        if (clash) return `A memory file named "${cleanPath}" already exists.`;

        set((s) => {
          const exists = s.memory.some(
            (f) => f.path.toLowerCase() === (original || cleanPath).toLowerCase(),
          );
          const memory = exists
            ? s.memory.map((f) =>
                f.path.toLowerCase() === (original || cleanPath).toLowerCase()
                  ? { path: cleanPath, content }
                  : f,
              )
            : [...s.memory, { path: cleanPath, content }];
          return { memory: mergeMemoryWithDefaults(memory) };
        });
        return null;
      },

      deleteMemoryFile: (path) =>
        set((s) => {
          if (isPreaddedMemory(path)) return {};
          return {
            memory: mergeMemoryWithDefaults(
              s.memory.filter((f) => f.path.toLowerCase() !== canonicalMemoryPath(path).toLowerCase()),
            ),
          };
        }),

      setKnowledge: (files) =>
        set((s) => {
          const knowledge = sanitizeKnowledge(files);
          const live = new Set(knowledge.map((f) => f.path.toLowerCase()));
          const knowledgeSources = Object.fromEntries(
            Object.entries(s.knowledgeSources).filter(([path]) => live.has(path.toLowerCase())),
          );
          return { knowledge, knowledgeSources };
        }),

      // Mirror the backend prompt library into the store. Used when the agent's
      // prompt-library tools (save/delete) mutate the shared library mid-turn: the
      // `prompt_library_updated` event carries the complete list, so the Prompt
      // Library page and the "/" composer shortcut stay in sync immediately.
      setPromptLibrary: (prompts) =>
        set(() => ({ promptLibrary: normalizePromptLibrary(prompts) })),

      saveKnowledgeFile: (path, content, originalPath) => {
        const cleanPath = normalizeKnowledgePath(path);
        if (!cleanPath) return "A file path is required.";
        if (hasUnsafeSegment(cleanPath)) return "Path cannot contain '.' or '..' segments.";

        const original = originalPath ? normalizeKnowledgePath(originalPath) : "";
        const clash = get().knowledge.some(
          (f) =>
            f.path.toLowerCase() === cleanPath.toLowerCase() &&
            (!original || f.path.toLowerCase() !== original.toLowerCase()),
        );
        if (clash) return `A knowledge file named "${cleanPath}" already exists.`;

        set((s) => {
          const exists = s.knowledge.some(
            (f) => f.path.toLowerCase() === (original || cleanPath).toLowerCase(),
          );
          const knowledge = exists
            ? s.knowledge.map((f) =>
                f.path.toLowerCase() === (original || cleanPath).toLowerCase()
                  ? { path: cleanPath, content }
                  : f,
              )
            : [...s.knowledge, { path: cleanPath, content }];

          let knowledgeSources = s.knowledgeSources;
          if (original && original.toLowerCase() !== cleanPath.toLowerCase() && knowledgeSources[original]) {
            const { [original]: moved, ...rest } = knowledgeSources;
            knowledgeSources = { ...rest, [cleanPath]: moved };
          }
          return { knowledge: sanitizeKnowledge(knowledge), knowledgeSources };
        });
        return null;
      },

      deleteKnowledgeFile: (path) =>
        set((s) => {
          const target = normalizeKnowledgePath(path).toLowerCase();
          const knowledgeSources = Object.fromEntries(
            Object.entries(s.knowledgeSources).filter(([p]) => p.toLowerCase() !== target),
          );
          return {
            knowledge: s.knowledge.filter((f) => f.path.toLowerCase() !== target),
            knowledgeSources,
          };
        }),

      setKnowledgeSource: (path, source) =>
        set((s) => {
          const clean = normalizeKnowledgePath(path);
          if (!clean) return {};
          if (source === null) {
            const rest = { ...s.knowledgeSources };
            delete rest[clean];
            return { knowledgeSources: rest };
          }
          return { knowledgeSources: { ...s.knowledgeSources, [clean]: source } };
        }),

      addCustomProvider: (input) => {
        const now = Date.now();
        const provider: CustomProvider = {
          id: uid(CUSTOM_PROVIDER_PREFIX),
          createdAt: now,
          updatedAt: now,
          ...input,
          models: input.models.length > 0 ? input.models : [""],
        };
        set((s) => ({ customProviders: [provider, ...s.customProviders] }));
        return provider;
      },

      updateCustomProvider: (id, patch) =>
        set((s) => ({
          customProviders: s.customProviders.map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
          ),
        })),

      deleteCustomProvider: (id) =>
        set((s) => {
          const customProviders = s.customProviders.filter((p) => p.id !== id);
          let settings = s.settings;
          if (s.settings.provider === id) {
            settings = { ...s.settings, provider: "openrouter", model: "", baseUrl: "" };
          }
          return { customProviders, settings };
        }),

      selectCustomProvider: (id) =>
        set((s) => {
          const provider = s.customProviders.find((p) => p.id === id);
          if (!provider) return {};
          const model = provider.models.find((m) => m.trim().length > 0) ?? "";
          return { settings: { ...s.settings, provider: id, model, baseUrl: "" } };
        }),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setManualContextLimit: (provider, model, limit) =>
        set((s) => ({
          settings: {
            ...s.settings,
            manualContextLimits: sanitizeManualContextLimits({
              ...s.settings.manualContextLimits,
              [manualLimitKey(provider, model)]: limit,
            }),
          },
        })),
      clearManualContextLimit: (provider, model) =>
        set((s) => {
          const next = { ...s.settings.manualContextLimits };
          delete next[manualLimitKey(provider, model)];
          return { settings: { ...s.settings, manualContextLimits: next } };
        }),
      setApiKey: (provider, key) =>
        set((s) => ({ settings: { ...s.settings, apiKeys: { ...s.settings.apiKeys, [provider]: key } } })),
      setSearchProvider: (searchProvider) => set((s) => ({ settings: { ...s.settings, searchProvider } })),
      setFetchProvider: (fetchProvider) => set((s) => ({ settings: { ...s.settings, fetchProvider } })),
      setSearchApiKey: (provider, key) =>
        set((s) => {
          const field =
            provider === "tavily"
              ? "tavilyApiKey"
              : provider === "exa"
                ? "exaApiKey"
                : provider === "serpapi"
                  ? "serpapiApiKey"
                  : "firecrawlApiKey";
          const patch: Partial<Settings> = { [field]: key };

          if (provider !== "firecrawl" && key.trim()) {
            const selected = s.settings.searchProvider ?? "duckduckgo";
            const selectedHasKey =
              selected === "duckduckgo"
                ? true
                : selected === "tavily"
                  ? Boolean(s.settings.tavilyApiKey?.trim())
                  : selected === "exa"
                    ? Boolean(s.settings.exaApiKey?.trim())
                    : Boolean(s.settings.serpapiApiKey?.trim());
            if (!selectedHasKey) patch.searchProvider = provider;
          }

          return { settings: { ...s.settings, ...patch } };
        }),
      setProviders: (providers) => set({ providers }),
      setModels: (models) => set({ models }),
      setModelsLoading: (modelsLoading) => set({ modelsLoading }),
      setSection: (section) => set({ section }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      setTeamMonitorOpen: (teamMonitorOpen) => set({ teamMonitorOpen }),
      setStreaming: (streaming) => set({ streaming }),
      setConnection: (connection) => set({ connection }),
      setPreview: (url) => set((s) => ({ preview: { url, open: s.preview.url !== url || s.preview.open } })),
      setPreviewOpen: (open) => set((s) => ({ preview: { ...s.preview, open } })),
      addAttachedFiles: (files) =>
        set((s) => {
          const seen = new Set(s.attachedFiles.map((f) => f.path));
          const fresh = files.filter((f) => f && f.path && !seen.has(f.path));
          if (fresh.length === 0) return {};
          return { attachedFiles: [...s.attachedFiles, ...fresh] };
        }),
      setFilesOpen: (filesOpen) => set({ filesOpen }),
      bumpFiles: () => set((s) => ({ filesVersion: s.filesVersion + 1 })),
      setWorkspacePath: (workspacePath) => set({ workspacePath }),

      // ---- Background memory agent (watch-only) ----------------------------------
      setMemoryAgentOpen: (memoryAgentOpen) => set({ memoryAgentOpen }),
      setMemoryAgentSessionsOpen: (memoryAgentSessionsOpen) => set({ memoryAgentSessionsOpen }),
      setMemoryAgentSelectedId: (memoryAgentSelectedId) => set({ memoryAgentSelectedId }),
      setMemoryAgentRuns: (memoryAgentRuns, memoryAgentCounts) =>
        set({ memoryAgentRuns, memoryAgentCounts }),
      startMemoryAgentLive: (runId) =>
        set((s) => ({
          memoryAgentLive: {
            ...s.memoryAgentLive,
            [runId]: {
              id: runId,
              reasoning: "",
              output: "",
              tools: [],
              status: "running",
              updatedFiles: [],
            },
          },
        })),
      applyMemoryAgentDelta: (runId, delta) =>
        set((s) => {
          const run = s.memoryAgentLive[runId];
          if (!run) return {};
          return {
            memoryAgentLive: {
              ...s.memoryAgentLive,
              [runId]: {
                ...run,
                reasoning: delta.reasoningDelta ? run.reasoning + delta.reasoningDelta : run.reasoning,
                output: delta.outputDelta ? run.output + delta.outputDelta : run.output,
              },
            },
          };
        }),
      upsertMemoryAgentTool: (runId, tool) =>
        set((s) => {
          const run = s.memoryAgentLive[runId];
          if (!run) return {};
          const index = run.tools.findIndex((t) => t.id === tool.id);
          const tools =
            index === -1
              ? [...run.tools, tool]
              : run.tools.map((t, i) => (i === index ? { ...t, ...tool } : t));
          return { memoryAgentLive: { ...s.memoryAgentLive, [runId]: { ...run, tools } } };
        }),
      finishMemoryAgentLive: (runId, outcome) =>
        set((s) => {
          const run = s.memoryAgentLive[runId];
          if (!run) return {};
          return {
            memoryAgentLive: {
              ...s.memoryAgentLive,
              [runId]: {
                ...run,
                status: outcome.status,
                error: outcome.error,
                updatedFiles: outcome.updatedFiles ?? run.updatedFiles,
              },
            },
          };
        }),

      // ---- Context meters (all scopes) -----------------------------------------
      setContextUsage: (convId, usage) =>
        set((s) => ({
          contextUsage: { ...s.contextUsage, [convId]: usage },
        })),
      setCustomContextUsage: (convId, usage) =>
        set((s) => ({
          customContextUsage: { ...s.customContextUsage, [convId]: usage },
        })),
      setChatContextUsage: (convId, usage) =>
        set((s) => ({
          chatContextUsage: { ...s.chatContextUsage, [convId]: usage },
        })),
      setSubAgentUsage: (convId, entry) =>
        set((s) => ({
          subAgentUsage: {
            ...s.subAgentUsage,
            [convId]: { ...s.subAgentUsage[convId], [entry.subSessionId]: entry },
          },
        })),
      setTeamUsage: (convId, entry) =>
        set((s) => ({
          teamUsage: {
            ...s.teamUsage,
            [convId]: { ...s.teamUsage[convId], [entry.agentId]: entry },
          },
        })),
      setCeoUsage: (convId, entry) =>
        set((s) => ({
          ceoUsage: {
            ...s.ceoUsage,
            [convId]: { ...s.ceoUsage[convId], [entry.agentId]: entry },
          },
        })),

      // ---- Automatic context summarization handoff -----------------------------
      startSummaryHandoff: (convId, handoffId, status, agent) =>
        set((s) => {
          const agentTag = agent?.agent === "custom" ? "custom" : "main";
          const existing = s.summaryHandoffs[convId];
          if (existing && existing.handoffId === handoffId) {
            // Same job re-announced (reconnect replay): keep accumulated chunks.
            if (existing.status === status && (existing.agent ?? "main") === agentTag) return {};
            return {
              summaryHandoffs: {
                ...s.summaryHandoffs,
                [convId]: {
                  ...existing,
                  status,
                  agent: agentTag,
                  customAgentId: agent?.customAgentId ?? existing.customAgentId ?? null,
                  customAgentName: agent?.customAgentName ?? existing.customAgentName ?? null,
                  updatedAt: Date.now(),
                },
              },
            };
          }
          return {
            summaryHandoffs: {
              ...s.summaryHandoffs,
              [convId]: {
                handoffId,
                status,
                streamingText: "",
                finalSummary: null,
                summaryChars: null,
                error: null,
                code: null,
                updatedAt: Date.now(),
                agent: agentTag,
                customAgentId: agent?.customAgentId ?? null,
                customAgentName: agent?.customAgentName ?? null,
              },
            },
          };
        }),
      appendSummaryChunk: (convId, handoffId, chunk) =>
        set((s) => {
          const existing = s.summaryHandoffs[convId];
          if (!existing || existing.handoffId !== handoffId) {
            return {
              summaryHandoffs: {
                ...s.summaryHandoffs,
                [convId]: {
                  handoffId,
                  status: "summarizing",
                  streamingText: chunk,
                  finalSummary: null,
                  summaryChars: null,
                  error: null,
                  code: null,
                  updatedAt: Date.now(),
                },
              },
            };
          }
          // Once validated, chunks are frozen — late duplicates cannot corrupt it.
          if (existing.finalSummary !== null) return {};
          return {
            summaryHandoffs: {
              ...s.summaryHandoffs,
              [convId]: {
                ...existing,
                streamingText: existing.streamingText + chunk,
                updatedAt: Date.now(),
              },
            },
          };
        }),
      updateSummaryHandoff: (convId, handoffId, patch) =>
        set((s) => {
          const existing = s.summaryHandoffs[convId];
          if (!existing || existing.handoffId !== handoffId) {
            return {
              summaryHandoffs: {
                ...s.summaryHandoffs,
                [convId]: {
                  handoffId,
                  status: patch.status ?? "summarizing",
                  streamingText: "",
                  finalSummary: patch.finalSummary ?? null,
                  summaryChars: patch.summaryChars ?? null,
                  error: patch.error ?? null,
                  code: patch.code ?? null,
                  updatedAt: Date.now(),
                },
              },
            };
          }
          return {
            summaryHandoffs: {
              ...s.summaryHandoffs,
              [convId]: { ...existing, ...patch, updatedAt: Date.now() },
            },
          };
        }),
      // ---- Sub-agent context summarization handoffs --------------------------
      startSubAgentSummary: (convId, info) =>
        set((s) => {
          const perConv = s.subAgentSummaries[convId] ?? {};
          const existing = perConv[info.handoffId];
          if (existing) {
            if (existing.status === info.status) return {};
            return {
              subAgentSummaries: {
                ...s.subAgentSummaries,
                [convId]: {
                  ...perConv,
                  [info.handoffId]: { ...existing, status: info.status, updatedAt: Date.now() },
                },
              },
            };
          }
          return {
            subAgentSummaries: {
              ...s.subAgentSummaries,
              [convId]: {
                ...perConv,
                [info.handoffId]: {
                  handoffId: info.handoffId,
                  subSessionId: info.subSessionId,
                  subAgentName: info.subAgentName,
                  status: info.status,
                  streamingText: '',
                  finalSummary: null,
                  summaryChars: null,
                  error: null,
                  code: null,
                  updatedAt: Date.now(),
                },
              },
            },
          };
        }),
      appendSubAgentSummaryChunk: (convId, handoffId, chunk) =>
        set((s) => {
          const perConv = s.subAgentSummaries[convId] ?? {};
          const existing = perConv[handoffId];
          if (!existing) {
            return {
              subAgentSummaries: {
                ...s.subAgentSummaries,
                [convId]: {
                  ...perConv,
                  [handoffId]: {
                    handoffId,
                    subSessionId: '',
                    subAgentName: '',
                    status: 'summarizing',
                    streamingText: chunk,
                    finalSummary: null,
                    summaryChars: null,
                    error: null,
                    code: null,
                    updatedAt: Date.now(),
                  },
                },
              },
            };
          }
          if (existing.finalSummary !== null) return {};
          return {
            subAgentSummaries: {
              ...s.subAgentSummaries,
              [convId]: {
                ...perConv,
                [handoffId]: {
                  ...existing,
                  streamingText: existing.streamingText + chunk,
                  updatedAt: Date.now(),
                },
              },
            },
          };
        }),
      updateSubAgentSummary: (convId, handoffId, patch) =>
        set((s) => {
          const perConv = s.subAgentSummaries[convId] ?? {};
          const existing = perConv[handoffId];
          if (!existing) {
            return {
              subAgentSummaries: {
                ...s.subAgentSummaries,
                [convId]: {
                  ...perConv,
                  [handoffId]: {
                    handoffId,
                    subSessionId: (patch as { subSessionId?: string }).subSessionId ?? '',
                    subAgentName: (patch as { subAgentName?: string }).subAgentName ?? '',
                    status: patch.status ?? 'summarizing',
                    streamingText: '',
                    finalSummary: patch.finalSummary ?? null,
                    summaryChars: patch.summaryChars ?? null,
                    error: patch.error ?? null,
                    code: patch.code ?? null,
                    updatedAt: Date.now(),
                  },
                },
              },
            };
          }
          return {
            subAgentSummaries: {
              ...s.subAgentSummaries,
              [convId]: {
                ...perConv,
                [handoffId]: { ...existing, ...patch, updatedAt: Date.now() },
              },
            },
          };
        }),
      setSubAgentSummaries: (convId, entries) =>
        set((s) => {
          const perConv: Record<string, import('@/types').SubAgentSummaryInfo> = {};
          for (const e of entries.slice(-50)) perConv[e.handoffId] = e;
          return { subAgentSummaries: { ...s.subAgentSummaries, [convId]: perConv } };
        }),
      setSummaryHandoffOpen: (v) => set({ summaryHandoffOpen: v }),
      upsertSummaryHistory: (convId, entry) =>
        set((s) => {
          const list = s.summaryHistory[convId] ?? [];
          const idx = list.findIndex((e) => e.handoffId === entry.handoffId);
          const next =
            idx === -1
              ? [...list.slice(-19), entry]
              : list.map((e, i) => (i === idx ? { ...e, ...entry } : e));
          return { summaryHistory: { ...s.summaryHistory, [convId]: next } };
        }),
      setSummaryHistory: (convId, entries) =>
        set((s) => ({
          summaryHistory: { ...s.summaryHistory, [convId]: entries.slice(-20) },
        })),
      setSummaryHistoryOpen: (v) => set({ summaryHistoryOpen: v }),
    }),
);
