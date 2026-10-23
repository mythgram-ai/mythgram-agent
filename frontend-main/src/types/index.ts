export interface ProviderMeta {
  id: string;
  label: string;
  defaultBaseUrl: string;
}

export interface ModelPricing {
  prompt?: number | null;
  completion?: number | null;
  currency?: string | null;
  unit?: string | null;
}

export interface ModelInfo {
  id: string;
  provider: string;
  label: string;
  owned_by?: string | null;
  context_window?: number | null;
  max_output_tokens?: number | null;
  pricing?: ModelPricing | null;
  description?: string | null;
  capabilities?: string[] | null;
}

/** Custom HTTP header pair the user configures for a custom provider. */
export interface CustomHeader {
  key: string;
  value: string;
}

/**
 * A user-defined OpenAI-compatible provider, persisted in the backend SQLite database.
 * Multiple providers coexist; each can carry one or more model ids.
 */
export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  headers: CustomHeader[];
  models: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Flat config sent to the backend on the wire for the currently selected custom
 * provider. Mirrors the requested Provider object: { id, name, model, baseUrl,
 * apiKey?, headers? }.
 */
export interface CustomProviderConfig {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export type ToolActivityStatus = "running" | "ok" | "error";

/** Outcome of a human review of a submitted plan (mirrors the backend decision). */
export type PlanApprovalStatus = "pending" | "approved" | "canceled" | "edited" | "timeout";

/** Plan review state attached to the submit_plan tool so the chat renders the big review block. */
export interface PlanApprovalInfo {
  /** The backend tool-call id — used to post the user's decision. */
  id: string;
  /** Chat session the plan belongs to. */
  chatId: string;
  /** The plan text the user is reviewing / editing. */
  plan: string;
  status: PlanApprovalStatus;
}

/** A single question the agent asked the user, with context and predefined options. */
export interface AskQuestionItem {
  question: string;
  context: string;
  options: string[];
}

export type AskQuestionStatus = "pending" | "answered" | "timeout";

/** Question-answer state attached to the ask_question_to_user tool for the answer block. */
export interface AskQuestionInfo {
  /** The backend tool-call id — used to post the user's answers. */
  id: string;
  /** Chat session the questions belong to. */
  chatId: string;
  /** The questions the user is answering. */
  questions: AskQuestionItem[];
  status: AskQuestionStatus;
}

export interface ToolActivity {
  id: string;
  name: string;
  label: string;
  status: ToolActivityStatus;
  filePath?: string;
  /** Raw arguments the model passed in the tool call (e.g. file_read offset/limit). */
  args?: Record<string, unknown>;
  /** Full structured tool result (e.g. web_search results) streamed from the backend. */
  result?: unknown;
  /** Live sub-agent run attached to a call_sub_agent tool chip (streamed token by token). */
  subAgent?: SubAgentRun;
  /**
   * Live sub-agent runs attached to a call_multiple_sub_agents tool chip, keyed by each child's
   * unique event id. Every entry is an independent sub-agent run rendered as its own nested block
   * inside the batch tool block.
   */
  multiRuns?: Record<string, SubAgentRun>;
  /** Render order of `multiRuns` (child ids) — preserves the order the sub-agents were requested. */
  multiOrder?: string[];
  /** Human-in-the-loop plan review rendered as the big chat block for submit_plan. */
  plan?: PlanApprovalInfo;
  /** Human-in-the-loop question-answer block rendered for ask_question_to_user. */
  ask?: AskQuestionInfo;
}

/** Structured result streamed back for the read_image tool (no image payload — metadata only). */
export interface ReadImageToolResult {
  ok?: boolean;
  data?: {
    file_path?: string;
    source?: "workspace" | "url";
    content_type?: string;
    size_bytes?: number;
  };
  error?: { code?: string; message?: string };
}

/** Live state of a sub-agent invocation, rendered inside the call_sub_agent chip popup. */
export interface SubAgentRun {
  agent: string;
  task: string;
  reasoning: string;
  output: string;
  tools: ToolActivity[];
  status: ToolActivityStatus;
  error?: string;
  /** True when launched in the background (wait_for_output=false) — runs detached from the turn. */
  background?: boolean;
  /** True when the main agent shared its conversation context (send_my_context=true) with this run. */
  sentContext?: boolean;
  /** Workspace-relative ".gptloop/sub-agent" file where a background run writes its final output. */
  outputFile?: string;
}

/** A user-defined sub-agent, stored in the backend SQLite database. */
export interface SubAgent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Sub-agent definition in the backend/wire format sent with each turn. */
export interface BackendSubAgent {
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];
  enabled: boolean;
}

/** A single file inside a skill folder — a bare name or a nested path plus its content. */
export interface SkillFile {
  /** Path relative to the skill folder, e.g. "SKILL.md" or "references/branching.md". */
  path: string;
  content: string;
}

/**
 * A user-defined skill, stored in the backend SQLite database. A skill is a
 * reusable, packaged capability: a folder named after the skill containing an entry markdown file
 * (SKILL.md by default, renameable) plus any number of reference/example/script files.
 */
export interface Skill {
  id: string;
  /** Folder name and unique identifier (e.g. "git-workflow"). */
  name: string;
  description: string;
  /** Entry file name (renameable, defaults to "SKILL.md"). */
  skillFile: string;
  /** Content of the entry file. */
  skillContent: string;
  /** Additional files/folders beyond the entry file. */
  files: SkillFile[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Skill definition in the backend/wire format sent with each turn. */
export interface BackendSkill {
  name: string;
  description: string;
  /** Entry file name, e.g. "SKILL.md". */
  skill_file: string;
  /** Every file in the skill folder, including the entry file. */
  files: Array<{ path: string; content: string }>;
  enabled: boolean;
}

/** Role of an agent inside a multi-agent team: the single head/leader, or a specialist member. */
export type TeamAgentRole = "leader" | "member";

/** One specialist member of a user-defined agent team. `name` doubles as the agent id. */
export interface TeamMember {
  /** Local id (React key / editing handle). */
  id: string;
  /** Agent id / name used for delegation and messaging (e.g. "Niko"). */
  name: string;
  description: string;
  systemPrompt: string;
}

/**
 * A user-defined multi-agent team: one head/leader plus N specialist members. Stored in the backend
 * SQLite database (app_state `agentTeams`) and sent with each turn when the team is active. Only one
 * team may be active (enabled) at a time.
 */
export interface AgentTeam {
  id: string;
  name: string;
  leaderName: string;
  leaderSystemPrompt: string;
  members: TeamMember[];
  /** Whether this team is the active one used for chat turns (only one team is active at a time). */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * A user-created CEO agent, stored in the backend SQLite database (app_state `ceoAgents`).
 *
 * A CEO agent is a TOP-LEVEL coordinator that controls the head/leaders of several agent teams. When
 * a CEO is active, the FIRST user prompt goes to the CEO; the CEO assigns tasks to the leaders of the
 * teams it controls, each leader breaks the work down for their own members, members report to their
 * leader, and leaders report completion back to the CEO. Only one CEO may be active (enabled) at a
 * time — exactly like agent teams.
 */
export interface CeoAgent {
  id: string;
  /** Human-readable CEO name / agent id (required). */
  name: string;
  /** Short description of the CEO's role. */
  description: string;
  /** The CEO's system prompt (used verbatim as its system prompt). */
  systemPrompt: string;
  /** The ids of the agent teams this CEO controls (references AgentTeam.id). */
  teamIds: string[];
  /** Whether this CEO is the active one used for chat turns (only one CEO is active at a time). */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** CEO-agent definition in the backend/wire format sent with a turn when a CEO agent is active. */
export interface BackendCeo {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  /** The full team definitions this CEO controls (resolved from the selected team ids). */
  teams: BackendTeam[];
}

/** Lifecycle status of a third-party app connector connection. */
export type ConnectorStatus = "pending" | "active" | "failed" | "disconnected";

/**
 * One third-party app connector connection (GitHub, Slack, Notion, Gmail, Outlook),
 * stored in the backend SQLite database. Only the Composio connected-account id +
 * status are persisted — tokens stay inside Composio.
 */
export interface ConnectorConnection {
  connectorId: string;
  /** Composio connected-account id this connection authenticates with. */
  connectedAccountId: string;
  status: ConnectorStatus;
  /** Human label for the connected account (login, email, workspace), when known. */
  accountLabel: string;
  updatedAt: number;
}

/** One connector as served by GET /api/connectors (catalog + live status). */
export interface ConnectorOverviewItem {
  id: string;
  name: string;
  description: string;
  homepage: string;
  /** Official toolkit logo URL from Composio (null until a key is configured). */
  logo_url?: string | null;
  tools_count?: number | null;
  status: ConnectorStatus;
  connected_account_id?: string | null;
  account_label?: string;
  updated_at?: number | null;
}

/** One connector tool as served by GET /api/connectors/tools (uncapped catalog). */
export interface ConnectorToolMeta {
  /** Composio tool slug, e.g. GITHUB_CREATE_ISSUE (also the native function name). */
  name: string;
  display: string;
  description: string;
  connector_id: string;
  toolkit: string;
}

/** Connector reference sent with each chat turn (mirrors sub-agent/skill payloads). */
export interface BackendConnector {
  connector_id: string;
  connected_account_id: string;
}

/** How the backend authenticates to a remote MCP server (`none` or `oauth` only). */
export type McpAuthType = "none" | "oauth";

/** Lifecycle status of an MCP server connection. */
export type McpServerStatus = "connected" | "disconnected" | "connecting" | "error" | "auth_required";

/** OAuth state of a remote MCP server (tokens never leave the backend). */
export interface McpOAuthState {
  authorizationServer?: string;
  scopes: string[];
  hasClientId: boolean;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string;
  /** True when the backend holds a usable access token. */
  connected: boolean;
  expiresAt?: number;
}

/**
 * An MCP server (remote Streamable HTTP or local stdio), stored in the
 * backend SQLite database. Secrets are write-only: the backend serves
 * presence flags for OAuth tokens, never values.
 */
export interface McpServer {
  id: string;
  name: string;
  description: string;
  kind: "remote" | "local";
  /** Remote MCP endpoint URL (remote only). */
  url: string;
  /** Local launch summary (local only; env values never leave the backend). */
  local?: { command: string; args: string[]; envKeys: string[]; cwd?: string };
  authType: McpAuthType;
  oauth?: McpOAuthState;
  /** Where the browser lands after OAuth (empty = auto-detected frontend origin). */
  frontendUrl?: string;
  /** Master switch: a disabled server contributes no tools and is never dialed. */
  enabled: boolean;
  /** Tool names (as the server reports them) switched OFF by the user. */
  disabledTools: string[];
  status: McpServerStatus;
  lastError?: string;
  /** Cached tool catalog from the last successful tools/list. */
  cachedTools: Array<{ name: string; description: string }>;
  createdAt: number;
  updatedAt: number;
}

/** MCP server reference sent with each chat turn (ids only — secrets stay server-side). */
export interface BackendMcpServer {
  id: string;
}

/**
 * A user-created Custom Agent, stored in the backend SQLite database (app_state `customAgents`).
 *
 * A Custom Agent is a TOP-LEVEL, independently-configured Main Agent — NOT a sub-agent, child agent,
 * or team member. It runs through the same core runtime as the built-in Main Agent; the only
 * differences are configuration-level: name, description, system prompt, and selected tools. When a
 * Custom Agent is the active agent, chat turns are executed as that independent agent.
 */
export interface CustomAgent {
  id: string;
  /** Human-readable agent name (required). */
  name: string;
  /** Short description of what the agent does. */
  description: string;
  /**
   * The full, editable system prompt. Pre-filled from the Main Agent's system prompt when the
   * creation UI opens, then freely edited. Used verbatim as the agent's system prompt.
   */
  systemPrompt: string;
  /** Tool identifiers the agent may use (resolved against the live registry at run time). */
  selectedTools: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * A user-authored custom system prompt for the built-in Main Agent, stored in the backend SQLite
 * database (app_state `mainAgentPrompts`).
 *
 * This is NOT a new agent, sub-agent, or team — it only changes the INSTRUCTIONS the existing Main
 * Agent runs with. The user can save many prompts and mark exactly one as active (see
 * `activeMainAgentPromptId`); the active prompt is sent as `system_prompt_override` and used verbatim
 * as the Main Agent's system prompt for future runs. When none is active, the Main Agent keeps using
 * its built-in system prompt unchanged.
 */
export interface MainAgentPrompt {
  id: string;
  /** Human-readable prompt name (required). */
  name: string;
  /** Optional short description of what this prompt changes. */
  description: string;
  /** The full system-prompt text, used verbatim as the Main Agent's system prompt when active. */
  content: string;
  createdAt: number;
  updatedAt: number;
}

/** Custom-agent definition in the backend/wire format sent with a turn when a Custom Agent is active. */
export interface BackendCustomAgent {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  selected_tools: string[];
}

/**
 * A user-saved reusable prompt in the prompt library, stored in the backend
 * SQLite database (app_state `promptLibrary`).
 *
 * The library is a quick-access collection: each entry has a title, an
 * optional short description (both unlimited in length), and the prompt text
 * itself. Every entry carries its own stable 20-character alphanumeric id.
 * Users copy entries to the clipboard or insert them into the composer with
 * the "/" shortcut, and can save any chat prompt into the library.
 */
export interface PromptLibraryItem {
  /** Stable unique id (20-character alphanumeric). */
  id: string;
  /** User-visible title (required, no length limit). */
  title: string;
  /** Optional short description (no length limit). */
  description: string;
  /** The reusable prompt text. */
  content: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A user profile (account identity), stored in the backend SQLite database
 * (app_state `userProfiles`).
 *
 * A profile owns a completely isolated workspace state: switching profiles gives a
 * fresh start — no chats, settings, memory, knowledge, sub-agents, skills, teams,
 * or any other data carries over. The isolated per-profile snapshots live in the
 * `profileStates` / `profileSessions` documents; this interface is only the identity
 * record (username, logo avatar, short description) shown on the profile cards and
 * the sidebar account button.
 */
export interface UserProfile {
  id: string;
  /** Username shown on the profile card and the sidebar (required). */
  name: string;
  /** Short description of the profile. */
  description: string;
  /**
   * Logo image (required): a `data:image/...` URL or an `https?://...` URL — pick
   * one from the curated gallery or upload a custom image. Legacy records without
   * one fall back to the name initial in the UI.
   */
  avatar: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A user-created custom task mode for the prompt box. When active, its `prompt`
 * is appended to the user's message before sending (same mechanism as plan mode).
 * Stored in the backend SQLite database via the shared app-state sync.
 */
export interface CustomTaskMode {
  id: string;
  /** User-visible mode name (required, unique case-insensitively). */
  name: string;
  /** The prompt text appended to the user's message when this mode is active. */
  prompt: string;
  createdAt: number;
  updatedAt: number;
}

/** Agent-team definition in the backend/wire format sent with each turn. */
export interface BackendTeam {
  id: string;
  name: string;
  leader_name: string;
  leader_system_prompt: string;
  members: Array<{ name: string; description: string; system_prompt: string }>;
}

/** How a team message was produced — shapes how the monitor labels it. */
export type TeamMessageKind = "user" | "delegate" | "message" | "to_leader";

/** Lifecycle status of a team agent block in the live view. */
export type TeamAgentStatus = "idle" | "working" | "queued" | "completed" | "failed";

/** One streamed run/segment produced by a team agent (each activation appends a new segment). */
export interface TeamAgentSegment {
  id: string;
  trigger?: string;
  reasoning: string;
  output: string;
  tools: ToolActivity[];
}

/** Live state of one team agent (head or member) within a multi-agent chat turn. */
export interface TeamAgentBlock {
  id: string;
  name: string;
  role: TeamAgentRole;
  description?: string;
  status: TeamAgentStatus;
  /** How many messages are queued in this agent's mailbox (from team_status events). */
  queued: number;
  /** Each activation of the agent is its own segment, rendered in order. */
  segments: TeamAgentSegment[];
}

/** One entry in the team monitoring log (a delivered message or a status change). */
export interface TeamMonitorEntry {
  id: string;
  at: number;
  kind: "message" | "status";
  from?: string;
  to?: string;
  messageKind?: TeamMessageKind;
  text?: string;
  agentId?: string;
  status?: TeamAgentStatus;
  queued?: number;
}

/** The full live state of a multi-agent team turn, attached to the assistant container message. */
export interface TeamRunState {
  teamName: string;
  leaderId: string;
  sendMessageEnabled: boolean;
  /** Agent id -> ordered agent block. */
  agents: Record<string, TeamAgentBlock>;
  /** Render order of agent ids (leader first, then members in roster order). */
  order: string[];
  /** Monitoring log (messages + status changes), most recent last. */
  monitor: TeamMonitorEntry[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  tools?: ToolActivity[];
  streaming?: boolean;
  createdAt: number;
  /** Present when this assistant message is the container for a multi-agent team turn. */
  team?: TeamRunState;
}

export interface Conversation {
  /** 20-character alphanumeric session id shared with the backend SQLite database. */
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /**
   * The user profile (account) this conversation belongs to. Conversations are
   * strictly isolated per profile — switching profiles shows only that profile's
   * chats. Missing (legacy) values are treated as the default profile.
   */
  profileId?: string | null;
  /**
   * Branch parent: the conversation this branch was started from, if any. A branch
   * is a brand-new backend session (fresh context for every agent) grouped under
   * its parent in the UI.
   */
  parentId?: string | null;
  /**
   * Server-reported message count for sessions whose full snapshot has not been
   * fetched yet (conversation stubs listed from the database at boot).
   */
  messageCount?: number;
  /**
   * False while this conversation is only a stub from the session list — its
   * snapshot has not been loaded from the database yet. Stubs are never synced
   * back to the server (that would overwrite the stored history).
   */
  loaded?: boolean;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number | null;
  children?: FileNode[];
}

export type SearchProvider = "duckduckgo" | "tavily" | "exa" | "serpapi";

/** Web fetch/scrape provider. "builtin" is our free, keyless scraper (default). */
export type FetchProvider = "builtin" | "firecrawl";

/** Status a todo can be in. */
export type TodoStatus = "pending" | "in_progress" | "completed";

/** Priority a todo can carry. */
export type TodoPriority = "low" | "medium" | "high";

/** A single todo item in the session's task list, stored in the backend SQLite database. */
export interface TodoItem {
  /** Unique string identifier (starts at 1; used to refer to the todo in updates). */
  id: string;
  /** Clear description of the task. */
  content: string;
  /** One of `pending`, `in_progress`, or `completed`. */
  status: TodoStatus;
  /** One of `low`, `medium`, or `high`. */
  priority: TodoPriority;
}

/** Structured result streamed back for the TodoWrite / read_todos tools. */
export interface TodoToolResult {
  ok?: boolean;
  data?: {
    todos?: TodoItem[];
    count?: number;
    message?: string;
  };
  error?: { code?: string; message?: string };
}

/**
 * A single persistent memory file, stored in the backend SQLite database.
 * `path` is relative to the virtual memory root (/memory/): a bare name ("MEMORY.md") or a nested
 * path ("projects/app.md"). The agent reads/maintains these via the `memory` tool to self-evolve
 * across chat sessions. Three files are always pre-added and permanent: MEMORY.md, SOUL.md, USER.md.
 */
export interface MemoryFile {
  path: string;
  content: string;
}

/** Structured result streamed back for any of the five memory tools. */
export interface MemoryToolResult {
  ok?: boolean;
  data?: {
    // memory_list
    count?: number;
    files?: Array<{ path?: string; chars?: number; char_limit?: number; preadded?: boolean }>;
    tree?: string;
    // memory_read
    path?: string;
    content?: string;
    chars?: number;
    char_limit?: number;
    preadded?: boolean;
    line_count?: number;
    total_lines?: number;
    first_line?: number | null;
    last_line?: number | null;
    truncated?: boolean;
    // memory_write / memory_edit / memory_delete
    deleted?: boolean;
    created?: boolean;
    message?: string;
  };
  error?: {
    code?: string;
    message?: string;
    available_paths?: string[];
    attempted_chars?: number;
    char_limit?: number;
    over_by?: number;
    preadded_files?: string[];
  };
}

/**
 * A single persistent knowledge file, stored in the backend SQLite database.
 * `path` is relative to the virtual knowledge root (knowledge/): a bare name ("docs.md") or a nested
 * path ("api/reference.md"). The user curates the knowledge base (manual creation, file/folder
 * upload, or URL fetch); the agent reads/maintains it via the knowledge_* tools. Unlike memory, the
 * knowledge base has NO pre-added files and NO character limits — it starts empty.
 */
export interface KnowledgeFile {
  path: string;
  content: string;
}

/**
 * Where a knowledge file was fetched from (the URL method). Persisted per-path so reopening a
 * URL-sourced file offers a "Refetch" action that re-runs the same request and refreshes its content.
 */
export interface KnowledgeSource {
  /** The fetched URL (empty when the source was a pasted curl command). */
  url: string;
  format?: "markdown" | "text" | "json" | "autodetect";
  headers?: Array<{ key: string; value: string }>;
  apiKey?: string;
  /** Original pasted curl command, when the fetch was curl-based. */
  curl?: string;
  /** Epoch ms of the last successful fetch. */
  fetchedAt: number;
}

/** Structured result streamed back for any of the five knowledge tools. */
export interface KnowledgeToolResult {
  ok?: boolean;
  data?: {
    // knowledge_list
    count?: number;
    files?: Array<{ path?: string; chars?: number; lines?: number }>;
    tree?: string;
    // knowledge_read
    path?: string;
    content?: string;
    chars?: number;
    line_count?: number;
    total_lines?: number;
    first_line?: number | null;
    last_line?: number | null;
    truncated?: boolean;
    // knowledge_create / knowledge_edit / knowledge_delete
    created?: boolean;
    deleted?: boolean;
    message?: string;
  };
  error?: {
    code?: string;
    message?: string;
    available_paths?: string[];
    occurrences?: number;
    path?: string;
  };
}

/** A single search hit: the 1-based line number and that line's content. */
export interface SearchLocatorMatch {
  line?: number;
  content?: string;
}

/**
 * Structured result streamed back for the memory_search / knowledge_search tools. Each result is a
 * matched file path plus, for every hit, the 1-based line number and that line's content (also
 * pre-rendered as a `LINE <n>: <content>` block in `preview`).
 */
export interface SearchLocatorToolResult {
  ok?: boolean;
  data?: {
    query?: string;
    result_count?: number;
    match_count?: number;
    results?: Array<{
      path?: string;
      lines?: number[];
      matches?: SearchLocatorMatch[];
      preview?: string;
    }>;
    message?: string;
  };
  error?: { code?: string; message?: string };
}

/** Result returned by the URL → knowledge fetch endpoint (POST /api/scrape). */
export interface ScrapeResult {
  ok?: boolean;
  url: string;
  status: number;
  format: string;
  title: string;
  description: string;
  content: string;
  content_type: string;
}

/** One file attached to the conversation by the attach_files tool (for preview/download). */
export interface AttachedFile {
  /** The backend-issued unique id for the attachment (used as a React key). */
  id: string;
  /** Display name (basename) of the file. */
  name: string;
  /** Workspace-relative path used to build the preview/download URL. */
  path: string;
  /** File size in bytes. */
  size: number;
  /** Best-effort MIME type derived from the file extension. */
  content_type: string;
  /** Human friendly size label, e.g. "2.4 KB". */
  size_label?: string;
}

/** Structured result streamed back for the embed_url tool. */
export interface EmbedUrlToolResult {
  ok?: boolean;
  data?: {
    url?: string;
    message?: string;
  };
  error?: { code?: string; message?: string; url?: string };
}

/** Structured result streamed back for the attach_files tool. */
export interface AttachFilesToolResult {
  ok?: boolean;
  data?: {
    files?: AttachedFile[];
    file_count?: number;
    errors?: Array<{ path?: string; error?: string }>;
    message?: string;
  };
  error?: { code?: string; message?: string; errors?: Array<{ path?: string; error?: string }> };
}

/** Live browser preview state driven by the embed_url tool. */
export interface BrowserPreview {
  /** The URL currently shown in the browser preview panel. */
  url: string;
  /** Whether the preview panel is open. */
  open: boolean;
}

export interface Settings {
  provider: string;
  model: string;
  apiKeys: Record<string, string>;
  baseUrl: string;
  searchProvider: SearchProvider;
  fetchProvider: FetchProvider;
  tavilyApiKey: string;
  exaApiKey: string;
  serpapiApiKey: string;
  firecrawlApiKey: string;
  /**
   * Composio API key for third-party app connectors (GitHub, Slack, …).
   * Sent with each turn; the backend falls back to its stored/server key when empty.
   */
  composioApiKey: string;
  /**
   * Whether the agent may use the sub-agent session tools (list_sub_agent_sessions /
   * reuse_same_sub_agent_session). "no" (default) hides both tools and their usage guidance;
   * "yes" enables them so the agent can continue previously run sub-agent sessions.
   */
  enableReuseSubAgentSession: "no" | "yes";
  /**
   * Reasoning effort forwarded to the model. One of the presets
   * ("low" | "medium" | "high" | "max") or a custom string the model supports.
   * Defaults to "high"; models without reasoning support ignore it.
   */
  effort: string;
  /**
   * Sampling temperature (0–2) forwarded to the model. Defaults to 0.2; models
   * that don't support custom temperatures ignore or clamp the value.
   */
  temperature: number;
  /**
   * Whether multi-agent teams are enabled. "no" (default) means chat turns use the normal single
   * agent and the team collaboration tools are unavailable. "yes" routes turns through the active
   * team's head/leader when a team is active.
   */
  enableAgentTeams: "no" | "yes";
  /**
   * Whether the sensitive send_message_to_team tool is available to team agents (peer-to-peer
   * agent-to-agent messaging). "no" (default) hides it; "yes" enables direct teammate messaging.
   */
  enableSendMessageToTeam: "no" | "yes";
  /**
   * Whether the CEO multi-agent system is enabled. "no" (default) means chat turns use the normal
   * single agent (or an active team). "yes" routes turns through the active CEO agent, which controls
   * the head/leaders of the teams it manages. Takes precedence over an active team when both are on.
   */
  enableCeoAgents: "no" | "yes";
  /**
   * Whether the background memory agent may run. "yes" (default, on) lets it build memory after
   * every N completed tasks; "no" (off) disables it entirely so no extra LLM tokens are spent.
   */
  memoryAgentEnabled: "no" | "yes";
  /**
   * After how many completed user tasks the background memory agent builds memory.
   * System default is 3: tasks 1–2 stay idle, task 3 triggers a build, then 6, 9, ...
   */
  memoryAgentInterval: number;
  /**
   * Manually entered context-window limits keyed by `"<provider>::<model>"` (see
   * `manualLimitKey` in lib/contextMeter). Fallback used only when the provider's
   * model catalog publishes no `context_window` for the pair — without an
   * effective limit the Main Agent context meter cannot show a percentage and new
   * Main Agent turns stay blocked until one is entered.
   */
  manualContextLimits: Record<string, number>;
  /**
   * Context-management method: "summarization" (Auto context summarization,
   * default) or "sliding_window" (delete oldest tokens at 99%). The backend
   * runs exactly one method per turn.
   */
  contextManagementMethod: "summarization" | "sliding_window";
  /**
   * Fraction of the window freed per sliding-window trigger (0.05..0.9).
   * Default 0.3 (30%). Only used when contextManagementMethod is sliding_window.
   */
  slidingWindowTruncatePercent: number;
}

/** The four built-in reasoning-effort presets shown in Settings. */
export const EFFORT_PRESETS = ["low", "medium", "high", "max"] as const;
export type EffortPreset = (typeof EFFORT_PRESETS)[number];

/** Provider-format message sent to the backend to preserve history across turns. */
export interface BackendMessage {
  role: "user" | "assistant";
  content: string;
}

/** Top-level conversation mode: full agent vs. lightweight chat-only assistant. */
export type AgentMode = "agent" | "chat";

/** Payload sent to POST /api/chat/stream to start (or reconnect to) a turn. */
export interface StreamRequest {
  chat_id: string;
  user_message?: string;
  history?: BackendMessage[];
  provider?: string;
  model?: string;
  api_key?: string;
  base_url?: string;
  custom_provider?: CustomProviderConfig;
  max_iterations?: number;
  temperature?: number;
  /** Reasoning effort preset or custom string; forwarded to the provider. */
  effort?: string;
  since_event_id?: number;
  /** Chat mode: when true, run as a lightweight assistant with only memory + knowledge + web tools. */
  chat_mode?: boolean;
  /** Agent-mode spelling of the same switch ("chat" = chat mode, anything else = agent mode). */
  agent_mode?: AgentMode;
  tavily_api_key?: string;
  exa_api_key?: string;
  serpapi_api_key?: string;
  search_provider?: SearchProvider;
  fetch_provider?: FetchProvider;
  firecrawl_api_key?: string;
  /** Composio API key for this turn (from Settings → Composio). */
  composio_api_key?: string;
  /** The turn's authenticated app connectors (only ACTIVE ones are sent). */
  connectors?: BackendConnector[];
  /** The turn's MCP servers (only ENABLED ones are sent; ids only). */
  mcp_servers?: BackendMcpServer[];
  sub_agents?: BackendSubAgent[];
  skills?: BackendSkill[];
  todos?: TodoItem[];
  memory?: MemoryFile[];
  knowledge?: KnowledgeFile[];
  /** Mirrors settings.enableReuseSubAgentSession; gates the sub-agent session tools this turn. */
  enable_reuse_sub_agent_session?: "no" | "yes";
  /** Background memory-agent schedule: false turns it off (no run, no extra tokens). */
  memory_agent_enabled?: boolean;
  /** After how many completed user tasks the memory agent builds memory (default 3). */
  memory_agent_interval?: number;
  /** When true, run this turn as a multi-agent team (with agent_team) instead of a single agent. */
  multi_agent?: boolean;
  /** The active agent team definition sent when multi_agent is true. */
  agent_team?: BackendTeam;
  /** Mirrors settings.enableSendMessageToTeam; gates the send_message_to_team tool this turn. */
  enable_send_message_to_team?: "no" | "yes";
  /** When true, run this turn as a CEO multi-agent system (with ceo_agent). Takes precedence over
   * ordinary team mode: the first user prompt goes to the CEO agent. */
  ceo_mode?: boolean;
  /** The active CEO agent definition (CEO + controlled teams) sent when ceo_mode is true. */
  ceo_agent?: BackendCeo;
  /**
   * The active Custom Agent (a top-level, user-created Main Agent) for this turn. When present, the
   * turn runs as that independent agent — its own system prompt + selected tools. Absent when the
   * default Main Agent is active.
   */
  custom_agent?: BackendCustomAgent;
  /**
   * The active Custom System Prompt for the built-in Main Agent, used verbatim as its system prompt
   * this turn. Sent only when a custom prompt is active AND the default Main Agent is running (never
   * with a Custom Agent or team). Absent → the Main Agent uses its built-in system prompt.
   */
  system_prompt_override?: string;
  /**
   * Effective context-window limit (tokens) for the selected model, resolved from
   * provider catalog metadata or manual entry. Used with provider-reported
   * prompt_tokens for automatic summarization handoff. Absent = handoff disabled.
   */
  context_limit?: number;
  /** Utilization fraction (0..1) that triggers summarization this turn (server default 90%). */
  summary_threshold?: number;
  /** Context-management method for this turn ("summarization" default, or "sliding_window"). */
  context_management_method?: "summarization" | "sliding_window";
  /** Fraction freed per sliding-window trigger (0.05..0.9, default 0.3). */
  sliding_window_truncate_percent?: number;
}

/** SSE event payloads emitted by the gptloop agent. */
export interface SSEEventData {
  _event_id?: number;
  value?: string;
  current?: number;
  limit?: number;
  state?: string;
  label?: string;
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  result?: Record<string, unknown>;
  message?: string;
  code?: string;
  content?: string;
  reasoning?: string | null;
  iteration_count?: number;
  aborted?: boolean;
  // Sub-agent side-channel fields
  agent?: string;
  task?: string;
  tool_id?: string;
  output?: string;
  error?: string;
  /** Whether this sub-agent run was launched in the background (wait_for_output=false). */
  background?: boolean;
  /** Whether the main agent shared its conversation context (send_my_context=true) with the run. */
  context_shared?: boolean;
  /** Workspace-relative ".gptloop/sub-agent" file where a background run writes its output. */
  output_file?: string;
  /**
   * Parent tool-call id set on every sub_agent_* event that belongs to a call_multiple_sub_agents
   * batch, so the frontend nests the child run inside the batch's tool block instead of a top-level
   * chip. Absent for a plain call_sub_agent run.
   */
  parent_tool_id?: string;
  /** 10-character session id of the individual sub-agent run this event belongs to. */
  sub_session_id?: string;
  // call_multiple_sub_agents batch-start fields
  /** Number of sub-agents in the batch (multi_sub_agents_start). */
  count?: number;
  /** The child sub-agents listed at batch start, each with its own child id + metadata. */
  agents?: Array<{
    id?: string;
    agent?: string;
    task?: string;
    background?: boolean;
    context_shared?: boolean;
    sub_session_id?: string;
    error?: string;
  }>;
  // submit_plan review fields
  chat_id?: string;
  plan?: string;
  // ask_question_to_user fields
  questions?: Array<{ question?: string; context?: string; options?: string[] }>;
  // todo_updated (TodoWrite) fields
  todos?: TodoItem[];
  // memory_updated (memory tool) fields
  memoryFiles?: MemoryFile[];
  // knowledge_updated (knowledge tools) fields
  knowledgeFiles?: KnowledgeFile[];
  // prompt_library_updated (prompt-library tools) fields
  /** The complete prompt library after an agent-driven save/delete. */
  prompts?: PromptLibraryItem[];
  // embed_url fields
  url?: string;
  // attach_files fields
  files?: AttachedFile[];
  file_count?: number;
  // memory-agent fields (memory_agent_queued / memory_agent_start / done)
  /** 10-character id of the background memory-agent run/session. */
  run_id?: string;
  /** Memory file paths a finished memory-agent run wrote/edited/deleted. */
  updated_files?: string[];
  /** How many memory-build requests were waiting behind this run when it started. */
  queued_remaining?: number;
  /** True when a replayed run was interrupted (e.g. backend restart) before finishing. */
  interrupted?: boolean;

  // ---- Sliding-window truncation fields ----
  /** Stable id for one pause→truncate→resume cycle. */
  truncation_id?: string;
  /** Number of old messages deleted in this truncation. */
  removed_messages?: number;
  /** Estimated tokens freed in this truncation. */
  freed_tokens_estimate?: number;
  /** Target tokens the truncation aimed to free. */
  target_tokens?: number;
  /** Fraction of the window freed (0.05..0.9). */
  truncate_percent?: number;
  /** Utilization before truncation (0..1+). */
  utilization_before?: number;
  /** Context-window limit the truncation was computed against. */
  context_limit?: number;
  /** Completed truncations this turn. */
  completed_truncations?: number;
  /** Bounded preview lines of the deleted messages. */
  preview?: string[];

  // ---- Multi-agent team fields ----
  /** team_start: the team name. */
  team_name?: string;  /** team_start: the head/leader agent id. */
  leader_id?: string;
  /** team_start: whether send_message_to_team is enabled for this team. */
  send_message_enabled?: boolean;
  /** team_start: the full roster (each with agent_id, role, description). */
  members?: Array<{ agent_id?: string; role?: TeamAgentRole; description?: string }>;
  /** team_agent_* / team_message / team_status: the agent this event belongs to / involves. */
  agent_id?: string;
  /** team_agent_* / team_status: the agent's role. */
  role?: TeamAgentRole;
  /** team_agent_start: why the agent woke up. */
  trigger?: string;
  /** team_agent_done / team_status: the agent's status. */
  status?: TeamAgentStatus;
  /** team_status: mailbox depth. */
  queued?: number;
  /** team_message: the sender / recipient agent ids and the kind + text. */
  from?: string;
  to?: string;
  kind?: TeamMessageKind;

  // ---- context_usage fields (multi-scope context meter) ----
  /**
   * context_usage: per-request token usage reported by the provider for the current
   * request. `prompt_tokens` is the current context size of that request (system +
   * history + tools) — the most accurate context signal available, NOT a cumulative
   * total. All counts are absent when the provider does not report usage.
   */
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /**
   * context_usage: agent scope tag ("main" | "custom" | "chat" | "sub_agent" |
   * "team" | "ceo"). The meter routes each scope to its own section; unknown scopes
   * are ignored (never shown as another agent's usage).
   */
  // NOTE: `agent` above is reused as the scope tag for context_usage (event name disambiguates).
  /** context_usage: provider id + model id serving the request (for display only). */
  provider?: string;
  model?: string;
  /** context_usage: the agent-loop iteration that produced this usage. */
  iteration?: number;
  /** context_usage (sub_agent scope): display name of the sub-agent that ran. */
  sub_agent?: string;

  // ---- Communication-channel fields ----
  /** channel_connection_request / channel tool results: the channel kind (telegram/discord/slack). */
  channel_name?: string;
  /** Human label of the channel (Telegram/Discord/Slack). */
  channel_label?: string;
  /** Channel catalog description + setup guide + addressing hint for the inline connect form. */
  description?: string;
  setup_guide?: string;
  addressing?: string;
  /** Full channel list mirrored by channels_updated. */
  channels?: unknown[];

  // ---- Automatic context summarization handoff fields ----
  /** Handoff id owning a summarization job (all summary_* events carry it). */
  handoff_id?: string;
  /** Validated summary length in chars (final_summary_validated). */
  chars?: number;
  /** Validated summary length for context replacement (main_agent_context_replaced). */
  summary_chars?: number;
  /** Custom Agent id when a top-level handoff was triggered by a custom agent. */
  custom_agent_id?: string;
  /** Custom Agent display name when a top-level handoff was triggered by a custom agent. */
  custom_agent_name?: string;
}

/**
 * Lifecycle status of one automatic context-summarization handoff for a
 * conversation. Mirrors the backend HandoffState; the UI never shows success
 * before SUMMARY_VALIDATED + CONTEXT_REPLACED + RESUMED.
 */
export type SummaryHandoffStatus =
  | "idle"
  | "pausing"
  | "paused"
  | "summarizing"
  | "validated"
  | "replaced"
  | "resumed"
  | "failed"
  | "incomplete"
  | "recovery";

/** Ephemeral live view of a summarization handoff, rebuilt from its SSE stream. */
export interface SummaryHandoffInfo {
  handoffId: string;
  status: SummaryHandoffStatus;
  /** Accumulated summary output chunks in order (not the validated summary). */
  streamingText: string;
  /** Validated final summary (only after final_summary_validated). */
  finalSummary: string | null;
  summaryChars: number | null;
  error: string | null;
  code: string | null;
  updatedAt: number;
  /** Top-level agent that triggered the handoff ("main" default keeps older payloads valid). */
  agent?: "main" | "custom";
  /** Custom Agent id when `agent` is "custom". */
  customAgentId?: string | null;
  /** Custom Agent display name when `agent` is "custom". */
  customAgentName?: string | null;
}

/**
 * Ephemeral live view of one sub-agent context-summarization handoff, rebuilt
 * from its sub_agent_summary_* SSE stream. Keyed by handoff id per conversation
 * so concurrent summarizations of multiple sub-agents never collide — the popup
 * lists all of them live. Mirrors SummaryHandoffInfo plus the owning run identity.
 */
export interface SubAgentSummaryInfo {
  handoffId: string;
  /** 10-character sub-agent session id this summarization belongs to. */
  subSessionId: string;
  /** Display name of the sub-agent being summarized. */
  subAgentName: string;
  status: SummaryHandoffStatus;
  /** Accumulated summary output chunks in order (not the validated summary). */
  streamingText: string;
  /** Validated final summary (only after sub_agent_final_summary_validated). */
  finalSummary: string | null;
  summaryChars: number | null;
  error: string | null;
  code: string | null;
  updatedAt: number;
}

/**
 * One agent's current context-token usage for a conversation, derived from the
 * latest `context_usage` log event of its scope (see SSEEventData). `promptTokens`
 * is the current context size of the latest provider request — NOT a cumulative
 * total. A missing record means "unavailable" (never ran / provider silent),
 * distinct from a legitimate zero-token count. Shared by main/custom/chat and by
 * every per-agent entry (sub-agents, team, CEO, channels, schedules).
 */
export interface MainContextUsage {
  /** Current context size (prompt tokens of the latest request). Always a finite >= 0 number. */
  promptTokens: number;
  /** Completion tokens of the latest request, when reported. */
  completionTokens?: number;
  /** Total tokens of the latest request, when reported. */
  totalTokens?: number;
  /** Provider id + model id serving the request (display only, when known). */
  provider?: string;
  model?: string;
  /** Agent-loop iteration that produced this usage (when known). */
  iteration?: number;
  /** Epoch ms when this usage was recorded. */
  updatedAt: number;
}

/** Alias for per-agent meter entries (sub-agents, team members, CEO, channels, schedules). */
export type AgentContextUsage = MainContextUsage;

/** One runned sub-agent's meter entry: usage + identity for the raw view. */
export interface SubAgentContextEntry extends AgentContextUsage {
  subSessionId: string;
  subAgentName?: string;
}

/** One team/CEO agent's meter entry: usage + identity/role for the raw view. */
export interface TeamAgentContextEntry extends AgentContextUsage {
  agentId: string;
  role?: string;
}

/** Lifecycle states of a background memory-agent run. */
export type MemoryAgentRunStatus = "queued" | "running" | "completed" | "failed";
/**
 * Metadata of one background memory-agent session, stored in the backend SQLite database.
 * A new run is created every time the main agent completes a turn; runs execute strictly
 * one at a time through the backend queue.
 */
export interface MemoryAgentRunMeta {
  id: string;
  chatSessionId: string;
  status: MemoryAgentRunStatus;
  provider: string;
  model: string;
  summary: string;
  error?: string | null;
  updatedFiles: string[];
  queuedAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
}

/** Counters for the memory-agent sessions popup. */
export interface MemoryAgentRunCounts {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

/**
 * Live (streamed) state of one memory-agent run, rendered in the memory-agent popup.
 * Ephemeral — rebuilt from the run's SSE stream (live or replayed); the durable record
 * lives in the backend SQLite database.
 */
export interface MemoryAgentLiveRun {
  id: string;
  reasoning: string;
  output: string;
  tools: ToolActivity[];
  status: "running" | "completed" | "failed";
  error?: string;
  updatedFiles: string[];
}

/** Live messaging channel kinds (WhatsApp is a coming-soon placeholder). */
export type ChannelKind = "telegram" | "discord" | "slack";

/** Lifecycle status of a messaging-channel connection. */
export type ChannelStatus = "connected" | "connecting" | "error" | "disabled";

/**
 * One messaging-channel connection (browser-safe projection — never carries the
 * token). Tokens stay server-side in the backend SQLite database.
 */
export interface ChannelConnection {
  id: string;
  kind: ChannelKind;
  name: string;
  enabled: boolean;
  status: ChannelStatus;
  lastError?: string;
  botName: string;
  botId: string;
  /** Custom Agent id serving new chats, or null for the Default Agent. */
  activeAgentId: string | null;
  chatCount: number;
  createdAt: number;
  updatedAt: number;
}

/** One per-user chat on a messaging channel. */
export interface ChannelChat {
  chat_id: string;
  user_key: string;
  user_label: string;
  agent_id: string | null;
  agent_name: string;
  title: string;
  created_at: number;
  updated_at: number;
}

/** One transcript message of a channel chat (user/assistant text). */
export interface ChannelChatMessage {
  seq: number;
  role: string;
  text: string;
  has_tools: boolean;
}

// ---------------------------------------------------------------------------
// Text-to-speech (TTS)
// ---------------------------------------------------------------------------

/** The provider kinds the TTS engine understands. */
export type TtsProviderKind =
  | "openrouter"
  | "kittenml"
  | "sarvam"
  | "azure"
  | "elevenlabs"
  | "google"
  | "gradium"
  | "inworld"
  | "minimax"
  | "volcengine"
  | "xai"
  | "mimo"
  | "custom";

/** Supported output container formats. */
export type TtsOutputFormat = "mp3" | "wav" | "flac" | "aac" | "opus" | "pcm";

/**
 * One configured TTS provider (browser-safe projection — never carries the API
 * key). Keys stay server-side in the backend SQLite database.
 */
export interface TtsProvider {
  id: string;
  kind: TtsProviderKind;
  name: string;
  enabled: boolean;
  baseUrl: string;
  model: string;
  voice: string;
  /** BCP-47 language / locale, when the provider needs one. */
  language: string;
  responseFormat: string;
  headers: CustomHeader[];
  /** Manually declared models (custom providers). */
  models: string[];
  /** Manually declared voices (custom providers). */
  voices: string[];
  /** True when a key is stored server-side (or provided by env for a built-in). */
  hasApiKey: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Static provider metadata + setup instructions shown in the panel. */
export interface TtsProviderDefinition {
  kind: TtsProviderKind;
  name: string;
  description: string;
  docsUrl: string;
  signupUrl: string;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  supportsModelListing: boolean;
  supportsVoiceListing: boolean;
  defaultModel: string;
  defaultVoice: string;
  defaultLanguage: string;
  defaultFormat: TtsOutputFormat;
  instructions: string[];
}

/** One selectable voice returned by a provider. */
export interface TtsVoice {
  id: string;
  name: string;
  language?: string;
  type?: string;
  model?: string;
}

/** One TTS model returned by a provider. */
export interface TtsModel {
  id: string;
  name: string;
  voices: TtsVoice[];
  languages: string[];
}

/** The result of a synthesis request (audio is base64-encoded). */
export interface TtsAudioResult {
  providerId: string;
  providerKind: TtsProviderKind;
  providerName: string;
  model: string;
  voice: string;
  format: string;
  mime: string;
  base64: string;
  filename: string;
  bytes: number;
}
