import type { z } from "zod";

/** Structured result returned by every tool. Mirrors the shape the model observes. */
export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
}

/**
 * Web search providers supported by the web_search / image_search tools.
 * "duckduckgo" is free and keyless — it never requires an API key and is the
 * default. The paid providers (tavily, exa, serpapi) each require a key that
 * the user can add in Settings.
 */
export type SearchProvider = "duckduckgo" | "tavily" | "exa" | "serpapi";

/**
 * Web fetching/scraping provider. "builtin" is our free, keyless scraper (the
 * default). "firecrawl" uses the paid Firecrawl API and requires a key.
 */
export type FetchProvider = "builtin" | "firecrawl";

/** API keys + provider selection for the web_search and fatch_web_urls tools. */
export interface WebToolsConfig {
  /** Active search provider; duckduckgo (free, keyless) is the default. */
  searchProvider: SearchProvider;
  /** Active web fetch/scrape provider; builtin (free, keyless) is the default. */
  fetchProvider?: FetchProvider;
  tavilyApiKey?: string;
  exaApiKey?: string;
  serpapiApiKey?: string;
  firecrawlApiKey?: string;
}

/**
 * A user-defined sub-agent. Definitions are authored in the frontend and stored in the
 * SQLite database (and browser runtime state); they are sent with each turn. A sub-agent
 * is a completely separate LLM call — its own system prompt, its own allowed tools, and its
 * own conversation memory keyed by session name — with no access to the main agent history.
 */
export interface SubAgentDefinition {
  /** Short unique name the main agent uses to target this sub-agent (e.g. "deepexplorer"). */
  name: string;
  /** Short human description shown by list_sub_agents. */
  description: string;
  /** System prompt that specialises this sub-agent. */
  system_prompt: string;
  /** Tool names (from the main tool registry) this sub-agent is allowed to use. */
  tools: string[];
  /** When false the sub-agent is hidden from list_sub_agents and cannot be called. */
  enabled?: boolean;
}

/**
 * One entry in a call_multiple_sub_agents invocation — a single independent sub-agent to run as
 * part of the batch. Mirrors the single-call parameters but is named for the batch tool: `prompt`
 * is that sub-agent's task, `wait_for_output` decides whether the main agent blocks on it, and
 * `send_my_output` shares the main agent's current conversation/output with the sub-agent.
 */
export interface MultiSubAgentParam {
  /** Name of the specialized sub-agent to run for this entry. */
  agent: string;
  /** The specific task/instructions for this sub-agent. */
  prompt: string;
  /** When true (default) the main agent waits for this sub-agent; when false it runs detached. */
  wait_for_output?: boolean;
  /** When true, the main agent's current conversation/output is shared with this sub-agent. */
  send_my_output?: boolean;
}

/**
 * Runtime bridge injected into the ToolContext for the main agent's turn so the
 * call_sub_agent / call_multiple_sub_agents / list_sub_agents tools can enumerate and execute
 * sub-agents. It is intentionally absent from the context handed to a sub-agent's own tool calls,
 * which prevents recursive sub-agent invocation.
 */
export interface SubAgentRuntime {
  /** All definitions provided by the user for this turn (enabled + disabled). */
  readonly definitions: SubAgentDefinition[];
  /** Names + descriptions of the sub-agents that can currently be called (enabled only). */
  available(): Array<{ name: string; description: string }>;
  /**
   * Add (or replace, matched case-insensitively by name) a sub-agent definition in the live turn so
   * a sub-agent just created with create_sub_agent is immediately callable by call_sub_agent /
   * call_multiple_sub_agents and visible to list_sub_agents within the SAME turn — without waiting
   * for the frontend to persist it and send it back on the next turn.
   */
  register(subAgent: SubAgentDefinition): void;
  /**
   * Execute a sub-agent for the given task. When `wait_for_output` is true (default) the sub-agent
   * runs to completion and its final output is returned directly. When false the sub-agent is
   * launched in the background — fully detached from the main turn — and the tool returns
   * immediately with the ".gptloop/sub-agent" file path where the output will be written.
   * When `send_my_context` is true a summary of the main agent's current conversation is shared
   * with the sub-agent so it understands the broader goal; when false (default) the sub-agent sees
   * only `task`. Streams live progress (tokens, reasoning, nested tool calls) via SSE side-channel
   * events.
   */
  run(
    params: {
      agent: string;
      task: string;
      wait_for_output?: boolean;
      send_my_context?: boolean;
    },
    ctx: ToolContext,
  ): Promise<ToolResult>;
  /**
   * Execute several sub-agents concurrently in a single call. Each entry runs as its own fully
   * independent sub-agent — its own session id, system prompt, allowed tools, and conversation —
   * exactly like a call_sub_agent invocation. The main agent blocks until every entry whose
   * `wait_for_output` is true (the default) has finished, and their outputs are returned inline.
   * Entries whose `wait_for_output` is false are launched detached in the background: the call does
   * not wait for them, and each writes its final report to its own ".gptloop/sub-agent" file for the
   * main agent to read later. When `send_my_output` is true for an entry, a summary of the main
   * agent's current conversation is shared with that sub-agent. Streams the same `sub_agent_*`
   * side-channel events as call_sub_agent, additionally stamped with `parent_tool_id` so the UI can
   * group every child run inside the batch's tool block.
   */
  runMany(params: { agents: MultiSubAgentParam[] }, ctx: ToolContext): Promise<ToolResult>;
  /**
   * List every sub-agent session created so far in this chat by call_sub_agent /
   * call_multiple_sub_agents. Each entry carries the 10-character session id, the sub-agent name,
   * and the session's current status — the ids to pass to `reuseSession`.
   */
  listSessions(): Array<{ session_id: string; agent: string; status: string }>;
  /**
   * Continue an existing sub-agent session (identified by its 10-character session id) with a new
   * prompt, preserving that session's full prior conversation as context. Streams the same
   * `sub_agent_*` side-channel events as a fresh run (stamped with the session id) and returns the
   * sub-agent's new final output.
   */
  reuseSession(
    params: { session_id: string; prompt: string },
    ctx: ToolContext,
  ): Promise<ToolResult>;
}

/**
 * A single file belonging to a skill. `path` is relative to the skill's own folder — it may be
 * a bare file name ("SKILL.md", "example.md") or a nested path ("references/branching.md",
 * "scripts/commit.sh"). `content` is the raw text written to disk when the skill is initialized.
 */
export interface SkillFileDefinition {
  path: string;
  content: string;
}

/**
 * A user-defined skill. Definitions are authored in the frontend and stored in the user's
 * SQLite database (and browser runtime state); they are sent with each turn. A skill is a reusable,
 * packaged capability — a folder named after the skill, containing an entry markdown file (by
 * convention SKILL.md, but renameable) plus any number of reference/example/script files. The
 * agent discovers skills with list_skills, then materializes the ones it needs onto disk (inside
 * a workspace ".gptloop/skills" directory) with skill_initialize before reading their files.
 */
export interface SkillDefinition {
  /** Folder name and unique identifier used by skill_initialize (e.g. "git-workflow"). */
  name: string;
  /** Short human description surfaced to the agent by list_skills. */
  description: string;
  /** Entry markdown file name inside the skill folder (renameable, defaults to "SKILL.md"). */
  skillFile: string;
  /** Every file in the skill folder, including the entry file. */
  files: SkillFileDefinition[];
  /** When false the skill is hidden from list_skills and cannot be initialized. */
  enabled?: boolean;
}

/** One skill that skill_initialize successfully wrote to disk. */
export interface InitializedSkill {
  skill_name: string;
  /** Skill folder path relative to the provided file_path, e.g. ".gptloop/skills/git-workflow". */
  path: string;
  /** Entry file path relative to the provided file_path, e.g. ".gptloop/skills/git-workflow/SKILL.md". */
  skill_file: string;
  /** All file paths written for this skill, relative to the provided file_path. */
  files: string[];
}

/** One skill skill_initialize could not write (unknown, disabled, or already initialized). */
export interface FailedSkill {
  skill_name: string;
  error: string;
}

/**
 * A single memory file. `path` is relative to the virtual memory root ("/memory/") — a bare name
 * ("MEMORY.md") or a nested path ("projects/app.md"). Memory files are authored/maintained by the
 * agent via the `memory` tool and stored in the SQLite database; they travel with
 * each turn. Three files are always pre-added and permanent: MEMORY.md, SOUL.md, USER.md.
 */
export interface MemoryFile {
  path: string;
  content: string;
}

/** Options for a memory_read call — incremental reads and optional line-number annotation. */
export interface MemoryReadOptions {
  /** Maximum number of lines to return. */
  limit?: number;
  /** 1-based line number from which reading begins. */
  offset?: number;
  /** When true, prefix each returned line with its line number. */
  returnLineNumber?: boolean;
}

/**
 * Runtime bridge injected into the ToolContext for the main agent's turn so the memory_* tools can
 * list/read/write/edit/delete memory files. Absent from the sub-agent tool context. Every mutation
 * emits a `memory_updated` SSE event so the frontend persists the change back to the user's browser.
 * Each operation returns a fully structured ToolResult (including structured errors for char-limit
 * overflows, missing files, and attempts to delete a pre-added file).
 */
export interface MemoryRuntime {
  /** The current memory files received from the user's browser at turn start. */
  readonly files: MemoryFile[];
  /** The MEMORY.md/SOUL.md/USER.md context block appended to the user's FIRST message of a chat. */
  firstMessageContext(): string;
  list(): ToolResult;
  /** Full-text search across all memory files; returns matching paths + 1-based line numbers only. */
  search(query: string): ToolResult;
  read(path: string, options?: MemoryReadOptions): ToolResult;
  write(path: string, content: unknown, ctx: ToolContext): ToolResult;
  edit(path: string, oldStr: unknown, newStr: unknown, ctx: ToolContext): ToolResult;
  remove(path: string, ctx: ToolContext): ToolResult;
}

/**
 * A single knowledge file. `path` is relative to the virtual knowledge root ("/knowledge/") — a bare
 * name ("docs.md") or a nested path ("api/reference.md"). Knowledge files are curated by the user
 * (manual creation, file/folder upload, or URL fetch) and maintained by the agent via the
 * knowledge_* tools; they are stored in the SQLite database (and browser runtime state) and travel with each turn.
 * Unlike memory, the knowledge base has NO pre-added files and NO character limits — it starts empty.
 */
export interface KnowledgeFile {
  path: string;
  content: string;
}

/** Options for a knowledge_read call — incremental reads and optional line-number annotation. */
export interface KnowledgeReadOptions {
  /** Maximum number of lines to return. */
  limit?: number;
  /** 1-based line number from which reading begins. */
  offset?: number;
  /** When true, prefix each returned line with its line number. */
  returnLineNumber?: boolean;
}

/**
 * Runtime bridge injected into the ToolContext for the main agent's turn so the knowledge_* tools can
 * list/read/create/edit/delete knowledge files. Absent from the sub-agent tool context. Every
 * mutation emits a `knowledge_updated` SSE event so the frontend persists the change back to the
 * user's browser. Each operation returns a fully structured ToolResult (including structured errors
 * for missing files, invalid paths, duplicate creates, and non-unique edit matches).
 */
export interface KnowledgeRuntime {
  /** The current knowledge files received from the user's browser at turn start (may be empty). */
  readonly files: KnowledgeFile[];
  /** The one-time notice appended to the user's FIRST message — only when knowledge files exist. */
  firstMessageContext(): string;
  list(): ToolResult;
  /** Full-text search across all knowledge files; returns matching paths + 1-based line numbers only. */
  search(query: string): ToolResult;
  read(path: string, options?: KnowledgeReadOptions): ToolResult;
  create(path: string, content: unknown, ctx: ToolContext): ToolResult;
  edit(path: string, oldStr: unknown, newStr: unknown, ctx: ToolContext): ToolResult;
  remove(path: string, ctx: ToolContext): ToolResult;
}

/**
 * A prompt-library entry as surfaced by the prompt-library tools. `content` is intentionally NOT
 * part of the list shape: the tools expose the id/title/description needed to find and delete an
 * entry, while the full prompt text stays in the library (and in the frontend's synced state).
 */
export interface PromptLibraryEntryInfo {
  /** Stable unique id (20-character alphanumeric) used to delete the prompt. */
  id: string;
  /** Short, clear title of the prompt. */
  title: string;
  /** Brief description of what the prompt is used for (may be empty). */
  description: string;
}

/** Fields accepted by the prompt-library save operation (mirrors the tool's zod schema). */
export interface PromptLibrarySaveInput {
  /** Short, clear title for the prompt. */
  title: string;
  /** Brief description explaining what the prompt is used for. */
  description?: string;
  /** The complete prompt content to store, preserved exactly as provided. */
  prompt: string;
}

/**
 * Runtime bridge injected into the ToolContext for the top-level agent surfaces that may manage the
 * user's prompt library (the built-in Main Agent, Custom Agents, and every agent inside a
 * multi-agent team or CEO system). It is backed by the SAME persistent PromptLibraryManager the
 * backend API and the frontend's app-state sync use, so a prompt saved by an agent shows up in the
 * Prompt Library page immediately (every mutation also emits a `prompt_library_updated` SSE event).
 * Absent from the sub-agent, chat-mode, and memory-agent tool contexts, so those surfaces can never
 * read or mutate the library.
 */
export interface PromptLibraryRuntime {
  /** List every saved prompt as id + title + description (newest first). */
  list(): ToolResult;
  /** Save a new prompt to the library; emits `prompt_library_updated` on success. */
  save(input: PromptLibrarySaveInput, ctx: ToolContext): ToolResult;
  /** Delete a prompt by its exact id; emits `prompt_library_updated` on success. */
  remove(promptId: string, ctx: ToolContext): ToolResult;
}

/**
 * A custom-system-prompt entry as surfaced by the custom-system-prompt tools.
 * `content` is intentionally NOT part of the list shape: the tools expose the
 * name/short description/exact 20-digit id needed to find and delete an entry,
 * while the full prompt text stays in the library (and in the frontend's synced state).
 */
export interface CustomSystemPromptEntryInfo {
  /** Stable unique id (exact 20 digits) used to delete the prompt. */
  id: string;
  /** Unique human-readable name of the custom system prompt. */
  name: string;
  /** Short description of the purpose and behavior (may be empty). */
  description: string;
}

/** Fields accepted by the custom-system-prompt save operation (mirrors the tool's zod schema). */
export interface CustomSystemPromptSaveInput {
  /** A unique, human-readable name for the custom system prompt. */
  name: string;
  /** A short description of the purpose and behavior. */
  description?: string;
  /** Absolute filesystem path to the existing file holding the complete prompt. */
  filePath: string;
}

/**
 * Runtime bridge injected into the ToolContext for the top-level agent surfaces that may manage
 * the user's custom system prompts (the built-in Main Agent, Custom Agents, and every agent inside
 * a multi-agent team or CEO system). It is backed by the SAME persistent MainAgentPromptManager
 * the Custom system prompts panel reads (the SQLite `mainAgentPrompts` app_state document the
 * frontend syncs to), so a prompt saved by an agent shows up in the panel immediately
 * (every mutation also emits a `main_agent_prompts_updated` SSE event).
 * Absent from the sub-agent, chat-mode, and memory-agent tool contexts, so those surfaces can never
 * read or mutate the library.
 */
export interface CustomSystemPromptsRuntime {
  /** List every saved prompt as name + short description + exact 20-digit id (newest first). */
  list(): ToolResult;
  /** Save a prompt from a workspace file; emits `main_agent_prompts_updated` on success. */
  save(input: CustomSystemPromptSaveInput, ctx: ToolContext): Promise<ToolResult>;
  /** Delete a prompt by its exact 20-digit id; emits `main_agent_prompts_updated` on success. */
  remove(promptId: string, ctx: ToolContext): ToolResult;
}

/**
 * A custom agent as surfaced by the custom-agent management tools. Only the
 * identity fields are exposed (exact name + short description) — never the
 * full system prompt or tool allow-list, so listing stays compact and safe
 * for the model to consume.
 */
export interface CustomAgentInfo {
  /** Stable unique id (16-character alphanumeric). */
  id: string;
  /** Exact agent name (used to delete the agent). */
  name: string;
  /** Short description of what the agent does. */
  description: string;
}

/** Fields accepted by the custom-agent create operation (mirrors the tool's zod schema). */
export interface CustomAgentCreateInput {
  /** The name of the custom agent. */
  name: string;
  /** A short description of what the custom agent does. */
  shortDescription: string;
  /** Workspace-relative path to the Markdown file holding the system prompt. */
  systemPromptFile: string;
  /**
   * Every tool name currently registered (used to grant the new agent its
   * default tool allow-list). When omitted the agent is created with no tools.
   */
  availableToolNames?: string[];
}

/**
 * Runtime bridge injected into the ToolContext for the top-level agent surfaces that may manage
 * custom agents (the built-in Main Agent, Custom Agents, and every agent inside a multi-agent
 * team or CEO system). It is backed by the SAME persistent CustomAgentManager the backend API
 * (/api/custom-agents) and the frontend's app-state sync use, so an agent created or deleted by
 * another agent shows up everywhere immediately (every mutation also emits a
 * `custom_agents_updated` SSE event).
 * Absent from the sub-agent, chat-mode, and memory-agent tool contexts, so those surfaces can
 * never create, list, or delete custom agents.
 */
export interface CustomAgentsRuntime {
  /** List every custom agent as exact name + short description (newest first). */
  list(): ToolResult;
  /** Create a custom agent from a workspace Markdown prompt file; emits `custom_agents_updated`. */
  create(input: CustomAgentCreateInput, ctx: ToolContext): Promise<ToolResult>;
  /** Delete a custom agent by its exact name; emits `custom_agents_updated` on success. */
  removeByName(name: string, ctx: ToolContext): ToolResult;
}

/**
 * Role of an agent inside a multi-agent collaboration team. The single "leader" (head) delegates
 * tasks and reviews work; every other agent is a "member" specialist.
 */
export type TeamAgentRole = "leader" | "member";

/**
 * Lifecycle status of one team agent, surfaced by get_team_members_status. "idle" = free and
 * waiting, "working" = currently running its own agentic loop, "queued" = free but has pending
 * messages waiting to be delivered, "completed"/"failed" = finished its most recent run.
 */
export type TeamAgentStatus = "idle" | "working" | "queued" | "completed" | "failed";

/** A single team member as surfaced by list_agent_team_members (name + description only). */
export interface TeamMemberInfo {
  /** The agent's unique id (its name is the id). */
  agent_id: string;
  /** Human-readable role: "leader" for the head, "member" otherwise. */
  role: TeamAgentRole;
  /** Short description of the member's specialization. */
  description: string;
}

/** Status record for one team agent returned by get_team_members_status. */
export interface TeamMemberStatus extends TeamMemberInfo {
  status: TeamAgentStatus;
  /** How many messages are waiting in this agent's mailbox to be delivered when it is free. */
  queued_messages: number;
}

/** Result of delivering messages to one or more team agents. */
export interface TeamDeliveryResult {
  ok: boolean;
  /** Agent ids the message was successfully queued/delivered to. */
  delivered: string[];
  /** Requested agent ids that do not exist in the team (skipped). */
  unknown: string[];
  /** Human/model-facing message describing the outcome. */
  message: string;
  /** Structured error (e.g. collaboration budget exceeded) when ok is false. */
  error?: { code: string; message: string };
}

/**
 * Runtime bridge injected into the ToolContext for a team agent's tool calls so the five
 * multi-agent collaboration tools (delegate_task_or_send_message, get_team_members_status,
 * send_message_to_team, list_agent_team_members, message_team_leader) can enumerate the team,
 * inspect member status, and deliver messages. It is bound to the CALLING agent: `selfId` is the
 * agent running the tool, so message_team_leader knows who is speaking and the leader-only tools
 * can be gated. Delivering a message never spawns a new session — it appends to the target agent's
 * EXISTING conversation (via its mailbox), preserving every agent's full context.
 */
export interface TeamRuntime {
  /** Id (name) of the agent whose tool call is executing. */
  readonly selfId: string;
  /** Whether the calling agent is the team head/leader. */
  readonly isLeader: boolean;
  /** Id (name) of the team's head/leader. */
  readonly leaderId: string;
  /** Whether the sensitive send_message_to_team tool is enabled for this team (user setting). */
  readonly sendMessageToTeamEnabled: boolean;
  /** All members (leader + specialists) with their name/role/description. */
  listMembers(): TeamMemberInfo[];
  /** Current status of the requested agents (unknown ids are omitted). */
  status(agentIds: string[]): TeamMemberStatus[];
  /**
   * Deliver one message to each requested agent. Each message is pushed onto the target agent's
   * mailbox and its processing is kicked; a busy agent receives everything queued while it was
   * busy in one batch when it next becomes free. `kind` shapes the framing prompt the recipient
   * sees ("delegate" = a task from the leader, "message" = peer-to-peer, "to_leader" = a member
   * reporting up). Returns which agents were reached and which ids were unknown.
   */
  deliver(
    messages: Array<{ agent_id: string; message: string }>,
    kind: "delegate" | "message" | "to_leader",
  ): TeamDeliveryResult;
  /**
   * True when this team is operating UNDER a CEO agent (the CEO multi-agent mode). Only then does the
   * team leader see and use the report_task_completion_to_ceo tool and its guidance; in the normal
   * team mode this is false/undefined and that tool is hidden.
   */
  readonly inCeoMode?: boolean;
  /** Id (name) of the CEO agent this team reports to (present only in CEO mode). */
  readonly ceoId?: string;
  /**
   * Report a completed task up to the CEO agent (CEO mode only). The summary is appended to the CEO's
   * EXISTING conversation via its mailbox — no new session is created. If the CEO is busy the report
   * waits in the queue and is delivered together with any other pending reports when the CEO is next
   * free (exactly like a member reporting to a team leader in the normal multi-agent system).
   */
  reportToCeo?(summary: string): TeamDeliveryResult;
}

/**
 * A single team as surfaced to the CEO by list_teams — the team's name, its head/leader id, and its
 * specialist members (name + description only; no system prompts are exposed).
 */
export interface CeoTeamInfo {
  /** Stable team id. */
  team_id: string;
  /** Human-readable team name. */
  team_name: string;
  /** The head/leader's agent id (the id the CEO passes to assign_tasks_to_teams). */
  team_leader: string;
  /** The specialist members of this team. */
  members: Array<{ name: string; description: string }>;
}

/**
 * Runtime bridge injected into the ToolContext for the CEO agent's tool calls so its two tools
 * (assign_tasks_to_teams, list_teams) can enumerate the teams it controls and delegate tasks to the
 * teams' head/leaders. Present ONLY when the tool call belongs to the CEO agent running inside an
 * active CEO multi-agent system; absent for the single agent, sub-agents, and ordinary team agents.
 * Delivering a task never spawns a new session — it appends to the target team leader's EXISTING
 * conversation (via its mailbox), so a leader the CEO re-activates keeps its full prior context.
 */
export interface CeoRuntime {
  /** Id (name) of the CEO agent whose tool call is executing. */
  readonly selfId: string;
  /** All teams the CEO controls, with each team's name, leader id, and members (+descriptions). */
  listTeams(): CeoTeamInfo[];
  /**
   * Assign one task prompt to each named team leader/head. Each prompt is framed so the leader knows
   * the task comes from the CEO and must report completion back to the CEO. Independent teams can be
   * assigned tasks in a single call; the leaders then run on their own and report back. Returns which
   * team leaders were reached and which names were unknown.
   */
  assignTasks(tasks: Array<{ team_leader: string; prompt: string }>): TeamDeliveryResult;
}

/** Status a todo can be in. */
export type TodoStatus = "pending" | "in_progress" | "completed";

/** Priority a todo can carry. */
export type TodoPriority = "low" | "medium" | "high";

/**
 * A single todo item in the session's task list. Todos are authored by the main agent and stored
 * in the SQLite database; they travel with each turn and are rendered in a popup.
 */
export interface TodoItem {
  /** Unique string identifier — recreated during a turn only if missing/unfit. */
  id: string;
  /** Clear description of the task. */
  content: string;
  /** One of `pending`, `in_progress`, or `completed`. */
  status: TodoStatus;
  /** One of `low`, `medium`, or `high`. */
  priority: TodoPriority;
}

/**
 * Runtime bridge injected into the ToolContext for the main agent's turn so the todo tools
 * (TodoWrite / read_todos) can read and update the user's todo list. It is intentionally absent
 * from the context handed to a sub-agent's own tool calls.
 */
export interface TodoRuntime {
  /** The current todo list received from the user's browser at turn start (may be empty). */
  readonly todos: TodoItem[];
  /**
   * Replace the whole todo list (create/update/delete in one call), emit a `todo_updated` SSE
   * event so the frontend persists the change to the user's browser, and return the new list.
   */
  write(todos: TodoItem[], ctx: ToolContext): TodoItem[];
}

/**
 * Which top-level agent a schedule runs as. Schedules created by the agent tools always run as
 * the SAME agent that is active in the turn: the built-in Default Agent, or the active Custom
 * Agent (with its id). Team/CEO/sub-agent turns resolve to the Default Agent — the scheduler
 * only executes default or custom agents.
 */
export interface ScheduleAgentIdentity {
  type: "default" | "custom";
  customAgentId?: string | null;
  provider: string;
  model: string;
}

/** Cadence choices accepted by the schedule_create tool (mapped to the cron kinds). */
export type ScheduleCreateCadence =
  | "one_time"
  | "every_x"
  | "daily"
  | "weekly"
  | "monthly"
  | "custom_cron";

/** Normalized input for creating a schedule (mirrors the schedule_create zod schema). */
export interface ScheduleCreateInput {
  scheduleName: string;
  taskPrompt: string;
  cadence: ScheduleCreateCadence;
  date?: string;
  time?: string;
  interval?: number;
  intervalUnit?: "minutes" | "hours" | "days";
  weekdays?: string[];
  dayOfMonth?: number;
  cronExpression?: string;
  timezone: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Runtime bridge injected into the ToolContext so the schedule_* tools can manage the
 * persistent cron system (schedules table + background scheduler). Built per turn with the
 * turn's agent identity, so schedules created by the agent run as that same agent.
 * Absent when the backend schedule system is unavailable (e.g. in tests without a store).
 */
export interface ScheduleRuntime {
  /** The agent identity schedules created through this runtime will run as. */
  readonly agent: ScheduleAgentIdentity;
  /** List schedules filtered by status (active / paused / all). */
  list(status: "active" | "paused" | "all"): ToolResult;
  /** Full details of one schedule by id. */
  get(id: string): ToolResult;
  /** Create and activate a schedule running as this runtime's agent. */
  create(input: ScheduleCreateInput): ToolResult;
  /**
   * Replace only the task prompt of a schedule. Timing, cadence, timezone, and every
   * other setting are preserved — in particular the computed next run is untouched.
   */
  updatePrompt(id: string, prompt: string): ToolResult;
  /** Turn a schedule on (enabled) or off (paused). */
  setEnabled(id: string, enabled: boolean): ToolResult;
  /** Permanently delete a schedule and its execution history. */
  remove(id: string): ToolResult;
  /** Immediately execute a schedule (manual run) without waiting for its next fire time. */
  runNow(id: string): Promise<ToolResult>;
}

/** Result of a skill_initialize call. */
export interface SkillInitializeResult {
  success: boolean;
  initialized: InitializedSkill[];
  failed: FailedSkill[];
}

/**
 * Messaging-channel context for one tool call. Present ONLY when the turn arrived from a
 * messaging channel (Telegram / Discord / Slack) — never for web-app, sub-agent, team, CEO,
 * or chat-mode turns. It lets channel-aware tools (send_responses, attach_files) deliver
 * results back to the exact channel + user the request came from.
 */
export interface ChannelToolContext {
  /** Which messaging channel the turn came from. */
  readonly kind: "telegram" | "discord" | "slack";
  /** Stable id of the channel connection that received the message. */
  readonly channelId: string;
  /** Human-readable channel connection name (for prompts and labels). */
  readonly channelName: string;
  /** Stable external user key (e.g. "tg:123", "dc:456", "sl:T1:U2"). */
  readonly userKey: string;
  /** Human-readable user label (for prompts). */
  readonly userLabel: string;
  /** Send a text message back to the user on the channel. */
  sendMessage(text: string): Promise<void>;
  /** Deliver files back to the user on the channel. Never throws. */
  sendFiles(
    files: Array<{ absolutePath: string; filename: string; contentType: string }>,
  ): Promise<{ delivered: number; errors: string[] }>;
}/** A skill as surfaced to the agent by list_skills — name, description, and its file tree. */
export interface SkillListEntry {
  name: string;
  description: string;
  /** Entry file name (e.g. "SKILL.md"). */
  skill_file: string;
  /** All file paths relative to the skill folder, sorted. */
  files: string[];
  /** Pretty ASCII tree of the skill folder, ready to show the model. */
  tree: string;
}

/**
 * Runtime bridge injected into the ToolContext for the main agent's turn so the list_skills /
 * skill_initialize tools can enumerate the user's skills and materialize them onto disk. It is
 * intentionally absent from the context handed to a sub-agent's own tool calls.
 */
export interface SkillRuntime {
  /** All skill definitions provided by the user for this turn (enabled + disabled). */
  readonly definitions: SkillDefinition[];
  /** Enabled skills, each with its file tree — what list_skills returns. */
  list(): SkillListEntry[];
  /**
   * Add (or replace, matched case-insensitively by name) a skill definition in the live turn so a
   * skill just created with create_skill is immediately discoverable by list_skills and can be
   * materialized by skill_initialize within the same turn — without waiting for the frontend to
   * persist it and send it back on the next turn.
   */
  register(skill: SkillDefinition): void;
  /**
   * Create a ".gptloop/skills" directory under `filePath` (if missing) and write each requested skill's
   * files into it. Skills that are unknown, disabled, or already initialized are reported in
   * `failed` without aborting the others.
   */
  initialize(
    params: { filePath: string; skillNames: string[] },
    ctx: ToolContext,
  ): Promise<SkillInitializeResult>;
}

/** Runtime context handed to a tool on execution. */
export interface ToolContext {
  /** Absolute path all file operations are sandboxed to. */
  workspaceRoot: string;
  /** Id of the chat session the tool is running within (used by human-in-the-loop tools). */
  chatId?: string;
  /** Push an SSE event onto the session buffer so the frontend can react before the tool returns. */
  emit?: (event: string, data: Record<string, unknown>) => void;
  /** Human-in-the-loop plan approval runtime — present only for main-agent tool calls. */
  planApprovals?: import("../../services/planApprovalStore.js").PlanApprovalStore;
  /** How long a submitted plan waits for a user decision before auto-continuing. */
  planApprovalTimeoutMs?: number;
  /** Human-in-the-loop question-answer runtime — present only for main-agent tool calls. */
  askQuestions?: import("../../services/questionStore.js").QuestionStore;
  /** How long the user's questions wait for answers before auto-continuing. */
  questionTimeoutMs?: number;
  /** Timeout (ms) applied to shell commands. */
  shellTimeoutMs: number;
  /** Abort signal so long running tools stop when the turn is cancelled. */
  signal?: AbortSignal;
  /** Optional keys/provider for the web search and fetch tools. */
  web?: WebToolsConfig;
  /**
   * The user's connected TTS configuration (provider/credentials/model/voice) from the TTS
   * panel, carried per turn. Present for main-agent, custom-agent, team-agent and CEO tool
   * calls — absent for chat mode and sub-agent tool calls, so generate_speech is only
   * available to those top-level agents. When absent the tool returns a clear
   * tts_not_configured error instead of failing silently.
   */
  tts?: import("../../tts/types.js").TtsToolsConfig;
  /** Sub-agent runtime — present only for main-agent tool calls, never for sub-agent tool calls
   * (a sub-agent must never delegate recursively). */
  subAgents?: SubAgentRuntime;
  /** Skill runtime — present for main-agent tool calls and forwarded to sub-agent tool calls so a
   * sub-agent granted list_skills / skill_initialize / create_skill can use them. */
  skills?: SkillRuntime;
  /** Todo runtime — present only for main-agent tool calls, never for sub-agent tool calls
   * (the todo tools are restricted from sub-agents). */
  todos?: TodoRuntime;
  /** Memory runtime — present for main-agent tool calls and forwarded to sub-agent tool calls so a
   * sub-agent granted the memory_* tools can read/maintain the shared memory base. */
  memory?: MemoryRuntime;
  /** Knowledge runtime — present for main-agent tool calls and forwarded to sub-agent tool calls so
   * a sub-agent granted the knowledge_* tools can read/maintain the shared knowledge base. */
  knowledge?: KnowledgeRuntime;
  /** Prompt-library runtime — present ONLY for the top-level surfaces that may manage the user's
   * saved prompts (Main Agent, Custom Agents, team agents, and the CEO system agents). Absent for
   * sub-agents, chat mode, and the memory agent, which is why the prompt-library tools are
   * unavailable there. */
  promptLibrary?: PromptLibraryRuntime;
  /** Custom-agents runtime — present ONLY for the top-level surfaces that may manage custom agents
   * (Main Agent, Custom Agents, team agents, and the CEO system agents). Absent for sub-agents,
   * chat mode, and the memory agent, which is why the custom-agent management tools are
   * unavailable there. */
  customAgents?: CustomAgentsRuntime;
  /** Custom-system-prompts runtime — present ONLY for the top-level surfaces that may manage the
   * user's saved custom system prompts (Main Agent, Custom Agents, team agents, and the CEO system
   * agents). Absent for sub-agents, chat mode, and the memory agent, which is why the
   * custom-system-prompt tools are unavailable there. */
  customSystemPrompts?: CustomSystemPromptsRuntime;
  /** Schedule runtime — present for main-agent tool calls and forwarded to sub-agent tool calls so
   * an agent granted the schedule_* tools can manage the persistent cron system. Absent when the
   * backend schedule system is unavailable. */
  schedules?: ScheduleRuntime;
  /** Multi-agent team runtime — present ONLY when the tool call belongs to a team agent (head or
   * member) running inside an active agent team. Absent for the normal single agent and sub-agents,
   * which is why the five team collaboration tools are unavailable outside a team. */
  team?: TeamRuntime;
  /** CEO multi-agent runtime — present ONLY when the tool call belongs to the CEO agent running
   * inside an active CEO multi-agent system. Absent for the single agent, sub-agents, and ordinary
   * team agents, which is why the CEO tools (assign_tasks_to_teams, list_teams) are unavailable
   * outside the CEO mode. */
  ceo?: CeoRuntime;
  /** Connector runtime — present when the turn has authenticated app connectors (Composio).
   * Lets any tool-execution path route connector tool calls; absent when no connector is
   * connected this turn. */
  connectors?: import("../connectors/runtime.js").ConnectorRuntime;
  /** Connector manager — present for main/custom/team/CEO agent tool calls so the
   * agent-driven connector management tools (connect/list/disconnect/status) can
   * inspect connections, wait for the user to authorize, and mutate the stored state.
   * Absent for sub-agents, chat mode, and the memory agent (which never manage connectors). */
  connectorManager?: import("../connectors/manager.js").ConnectorManager;
  /** MCP runtime — present when the turn has connected MCP servers.
   * Lets any tool-execution path route MCP tool calls; absent when no MCP
   * server is connected this turn. */
  mcp?: import("../mcp/runtime.js").McpRuntime;
  /** MCP server manager — present for main/team/CEO agent tool calls so the
   * agent-driven MCP management tools (connect/list/delete/on-off/status) can
   * create, inspect, and mutate the persisted MCP servers. Absent for
   * sub-agents, chat mode, and the memory agent (which never manage servers). */
  mcpManager?: import("../mcp/manager.js").McpManager;
  /** Messaging-channel manager — present for main/custom/team/CEO agent tool calls so the
   * agent-driven communication-channel tools (request/list/disconnect/status/send) can
   * inspect connections, wait for the user to connect, and deliver messages. Absent for
   * sub-agents, chat mode, and the memory agent (which never manage channels). */
  channelManager?: import("../../channels/manager.js").ChannelManager;
  /**
   * Messaging-channel context — present ONLY when the tool call belongs to a turn that
   * arrived from a messaging channel (Telegram / Discord / Slack). Absent everywhere
   * else, which is why channel-only tools (send_responses) refuse to run outside channels.
   */
  channel?: ChannelToolContext;
  /** Id of the tool call currently executing; used to correlate nested sub-agent events in the UI. */
  toolCallId?: string;
  /**
   * Every tool name currently registered in the agent's tool registry (in registration order).
   * Present in both the main-agent and sub-agent tool contexts so LLM-created sub-agents
   * (create_sub_agent) can enumerate which tools they will be granted by default.
   */
  availableToolNames?: string[];
  /** The model id currently serving the agent (used by the read_image tool for error reporting). */
  model?: string;
  /** Whether the selected model accepts image inputs; false blocks the read_image tool. */
  visionCapable?: boolean;
}

/**
 * A Tool is fully self describing: name, description, a zod schema (used both to build
 * the OpenAI function schema and to validate arguments), a label helper for the UI, and
 * an async executor. Adding a new tool = create one file exporting a Tool and register it.
 */
export interface Tool<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: Schema;
  /** Short human friendly label for UI chips, e.g. "Create: src/app.ts". */
  label: (args: z.infer<Schema>) => string;
  execute: (args: z.infer<Schema>, ctx: ToolContext) => Promise<ToolResult>;
}

/**
 * A tool with its schema type erased — used wherever tools of different schema shapes are stored
 * together. `Tool<Schema>` is invariant in Schema (the schema field is covariant while the
 * label/execute params are contravariant), so a generic alias won't accept heterogeneous tools.
 * This standalone interface widens the schema-dependent parts to accept any concrete Tool.
 */
export interface AnyTool {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  label: (args: never) => string;
  execute: (args: never, ctx: ToolContext) => Promise<ToolResult>;
}

/** Helper to define a tool with full type inference from its schema. */
export function defineTool<Schema extends z.ZodTypeAny>(tool: Tool<Schema>): Tool<Schema> {
  return tool;
}
