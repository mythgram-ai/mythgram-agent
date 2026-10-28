import type { AppConfig } from "../config.js";
import { buildSystemPrompt } from "./systemprompt.js";
import type { ProviderRegistry } from "./providers/registry.js";
import { resolveProvider } from "./providers/registry.js";
import type { Provider } from "./providers/types.js";
import type { ToolRegistry } from "./tools/index.js";
import {
  buildImageMessage,
  extractImageAttachment,
  withoutImageAttachment,
} from "./tools/readImage.js";
import { isVisionCapableModel } from "../utils/vision.js";
import type { SkillDefinition, SubAgentDefinition, WebToolsConfig } from "./tools/types.js";
import type { ChannelToolContext } from "./tools/types.js";
import type { ToolCall, ToolCallDelta } from "./providers/types.js";
import type { ChatSession, StoredMessage } from "../services/sessionStore.js";
import type { SessionEventBuffer } from "../services/eventBuffer.js";
import type { PlanApprovalStore } from "../services/planApprovalStore.js";
import type { QuestionStore } from "../services/questionStore.js";
import { safeJsonParse } from "../utils/json.js";
import { createSubAgentRuntime } from "./subagents.js";
import { createSkillRuntime } from "./skills.js";
import { mergeDefaultSkills, resolveDefaultSkills } from "./skills/index.js";
import { resolveDefaultSubAgents, mergeDefaultSubAgents } from "./sub-agents/index.js";
import { createTodoRuntime } from "./todos.js";
import { createMemoryRuntime } from "./memory.js";
import { createKnowledgeRuntime } from "./knowledge.js";
import { createPromptLibraryRuntime } from "./promptLibrary.js";
import { createCustomAgentsRuntime } from "./customAgents.js";
import { createCustomSystemPromptsRuntime } from "./customSystemPrompts.js";
import type { KnowledgeFile, MemoryFile, MemoryRuntime, TodoItem } from "./tools/types.js";
import type { MemoryAgentService } from "./memoryagent/index.js";
import { ALL_MULTI_AGENT_TOOL_NAMES } from "./tools/teamTools.js";
import { CHANNEL_ONLY_TOOLS, buildChannelSystemSection } from "./tools/sendResponses.js";
import type { McpManager } from "./mcp/index.js";
import { createScheduleRuntime } from "./tools/scheduleRuntime.js";
import {
  ConnectorManager,
  ConnectorRuntime,
  isConnectorToolName,
  type ConnectorWire,
} from "./connectors/index.js";
import {
  McpRuntime,
  isMcpToolName,
  type McpServerSelection,
} from "./mcp/index.js";
import { isMcpManagementTool } from "./tools/mcpManagement.js";
import { isConnectorManagementTool } from "./tools/connectorManagement.js";
import {
  executeHandoff,
  markResumed,
  shouldTriggerSummarization,
} from "./summarization/index.js";
import {
  createSlidingWindowTruncationId,
  executeSlidingWindowTruncation,
  normalizeContextManagementMethod,
  normalizeSlidingWindowTruncatePercent,
  shouldTriggerSlidingWindow,
  slidingWindowUtilizationOf,
} from "./slidingWindow.js";

export interface RunAgentRequest {
  chatId: string;
  userMessage: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** Full user-defined provider config, present when a `custom_` provider is selected. */
  customProvider?: unknown;
  /**
   * @deprecated The agent runs with NO iteration cap and this value is ignored. Kept only for
   * backward compatibility with the wire request; the loop runs until the agent is done or aborted.
   */
  maxIterations?: number;
  temperature?: number;
  /**
   * Reasoning effort chosen in Settings: a preset (`low` | `medium` | `high` | `max`)
   * or a custom string. Forwarded to the provider; ignored by models without reasoning.
   */
  effort?: string;
  /** Per-request web tool keys/provider (from frontend Settings); falls back to env config. */
  tavilyApiKey?: string;
  exaApiKey?: string;
  serpapiApiKey?: string;
  searchProvider?: "duckduckgo" | "tavily" | "exa" | "serpapi";
  fetchProvider?: "builtin" | "firecrawl";
  firecrawlApiKey?: string;
  /** User-defined sub-agents (from the frontend, stored in the browser) available this turn. */
  subAgents?: SubAgentDefinition[];
  /** User-defined skills (from the frontend, stored in the browser) available this turn. */
  skills?: SkillDefinition[];
  /** User-defined todos (from the frontend, stored in the browser) available this turn. */
  todos?: TodoItem[];
  /** The user's memory files (from the frontend, stored in the browser) available this turn. */
  memory?: MemoryFile[];
  /** The user's knowledge base files (from the frontend, stored in the browser) available this turn. */
  knowledge?: KnowledgeFile[];
  /**
   * Whether the sub-agent session tools (list_sub_agent_sessions / reuse_same_sub_agent_session)
   * are enabled for this turn. Mirrors the user's Settings choice. When false (default) the two
   * tools are hidden from the model and their usage guidance is omitted from the system prompt.
   */
  enableReuseSubAgentSession?: boolean;
  /**
   * When set, this string is used VERBATIM as the system prompt instead of the built Main-Agent
   * prompt. Used by Custom Agents (see agents/customagent) — a Custom Agent is a top-level Main Agent
   * with its own fully-customized system prompt. Undefined for the default Main Agent, which keeps
   * building its prompt exactly as before.
   */
  systemPromptOverride?: string | null;
  /**
   * When set, the tools advertised to the model are restricted to this set of names (the multi-agent
   * team tools are still always removed on top). Used by Custom Agents to run with only their selected
   * tools. Undefined for the default Main Agent, which sees the full registry as before.
   */
  allowedToolNames?: readonly string[] | null;
  /**
   * Present only when THIS turn is executed by a Custom Agent (a top-level, user-created Main Agent).
   * Informational — the actual behavior is driven by `systemPromptOverride` and `allowedToolNames`.
   */
  customAgent?: CustomAgentInfo | null;
  /**
   * Present only when THIS turn arrived from a messaging channel (Telegram / Discord / Slack).
   * The channel tools (send_responses) are advertised, the channel system section is appended
   * to the prompt, and channel-aware tools deliver back to this exact channel + user.
   * Absent for every web-app turn.
   */
  channel?: ChannelToolContext | null;
  /**
   * Per-turn override for how long submit_plan waits for a user decision. Channel turns use a
   * longer window (messaging is slower than the app UI); web-app turns use the server default.
   */
  planApprovalTimeoutMs?: number;
  /**
   * Whether the background memory agent may run after this turn. Mirrors the user's Settings
   * choice ("Memory agent" on/off). Defaults to true (on) — when false the memory agent never
   * starts, so no extra LLM tokens are spent on memory building.
   */
  memoryAgentEnabled?: boolean;
  /**
   * After how many completed user tasks the background memory agent runs. The memory agent
   * starts only when the completed-task count for the chat reaches a multiple of this interval.
   * Defaults to 3 (system default): e.g. it stays idle for tasks 1–2 and builds memory after
   * task 3, then again after task 6, 9, ... Clamped to >= 1.
   */
  memoryAgentInterval?: number;
  /**
   * Composio API key for this turn (from frontend Settings). When present together with
   * `connectors`, every tool of every connected app is advertised as native function tools.
   */
  composioApiKey?: string;
  /**
   * The turn's authenticated app connectors (Composio connected-account references).
   * Only these toolkits are loaded; each contributes its FULL tool catalog (uncapped).
   */
  connectors?: ConnectorWire[];
  /**
   * The turn's MCP servers (Model Context Protocol), by server id. Only enabled
   * servers are loaded; each contributes its FULL tool catalog (uncapped, minus
   * the tools the user switched off). Undefined/empty = every enabled server.
   * Secrets stay server-side — the wire carries ids only.
   */
  mcpServers?: McpServerSelection[];
  /**
   * Effective context-window limit (tokens) for the selected model, resolved by
   * the client from provider catalog metadata or manual entry. Used with the
   * provider-reported prompt_tokens to compute utilization for automatic
   * summarization handoff. Absent = handoff disabled (safe, never triggers).
   */
  contextLimit?: number | null;
  /**
   * Utilization fraction (0..1) that triggers summarization handoff this turn.
   * Defaults to the server summaryThreshold (90%). Per-turn override.
   */
  summaryThreshold?: number;
  /**
   * Context-management method for this turn: "summarization" (Auto context
   * summarization, default) or "sliding_window" (delete oldest tokens at 99%).
   * Per-turn override from Settings; absent = summarization.
   */
  contextManagementMethod?: string;
  /**
   * Fraction of the window freed per sliding-window trigger (0.05..0.9).
   * Defaults to 0.3 (30%). Per-turn override from Settings.
   */
  slidingWindowTruncatePercent?: number;
}

/** Lightweight identity of the Custom Agent handling a turn (see agents/customagent/configuration). */
export interface CustomAgentInfo {
  id: string;
  name: string;
  description: string;
}

/**
 * The sub-agent session tools, gated by the `enable_reuse_sub_agent_session` setting. When the
 * setting is off they are neither advertised to the model nor described in the system prompt.
 */
const SESSION_REUSE_TOOLS: readonly string[] = [
  "list_sub_agent_sessions",
  "reuse_same_sub_agent_session",
];

/**
 * The multi-agent collaboration tools (the five team tools plus the three CEO tools) are ONLY for
 * agents inside an active team or CEO system (see the multiagent runtime). The normal single agent
 * never sees them nor their guidance — it has no `team`/`ceo` runtime, so they would be unusable
 * anyway; hiding them keeps the single-agent surface clean.
 */
const TEAM_TOOLS: readonly string[] = ALL_MULTI_AGENT_TOOL_NAMES;

export class AgentRunner {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly tools: ToolRegistry,
    private readonly config: AppConfig,
    private readonly planApprovals: PlanApprovalStore,
    private readonly askQuestions: QuestionStore,
    /**
     * Optional background memory agent. When present, every completed turn enqueues a
     * memory-build run that receives this turn's FULL context (untruncated transcript +
     * final memory state) and updates the user's memory files autonomously.
     */
    private readonly memoryAgent?: MemoryAgentService,
    /**
     * Optional MCP server manager. When present, every connected + enabled MCP
     * server's FULL tool catalog is advertised as native function tools.
     */
    private readonly mcpManager?: McpManager,
    /**
     * Optional messaging-channel manager. When present, the agent-driven
     * communication-channel tools (request/list/disconnect/status/send) can
     * inspect connections, wait for the user to connect, and deliver messages.
     */
    private channelManager?: import("../channels/manager.js").ChannelManager,
    /**
     * Optional application-connector manager. When present, the agent-driven connector
     * tools (list/connect/disconnect/status) can inspect connections, ask the user to
     * authorize an app, and attach its native tools to the live turn.
     */
    private readonly connectorManager?: ConnectorManager,
  ) {}

  /**
   * Attach the messaging-channel manager (called once at boot, after the
   * ChannelManager is created — it depends on this runner, so it cannot be a
   * constructor argument). When set, the channel_* tools work on this runner;
   * Custom Agents inherit it automatically through the shared core runtime.
   */
  setChannelManager(
    manager?: import("../channels/manager.js").ChannelManager,
  ): void {
    this.channelManager = manager;
  }

  /**
   * Attach the persistent schedule store + background scheduler (called once at boot).
   * When set, the schedule_* tools can manage the cron system; schedules created through
   * them run as the same agent that is active in the turn (Default or Custom Agent).
   */
  setSchedules(
    store?: import("../cron/store.js").ScheduleStore,
    scheduler?: import("../cron/scheduler.js").ScheduleScheduler,
  ): void {
    this.scheduleStore = store;
    this.scheduleScheduler = scheduler;
  }

  private scheduleStore?: import("../cron/store.js").ScheduleStore;
  private scheduleScheduler?: import("../cron/scheduler.js").ScheduleScheduler;

  /**
   * Attach the persistent prompt library (called once at boot). When set, the prompt-library tools
   * (save_prompt_in_prompt_library / delete_prompt_from_prompt_library /
   * list_available_prompts_in_prompt_library) can read and mutate the user's saved prompts for the
   * Main Agent and every Custom Agent (both run through this core runtime). Every mutation emits a
   * `prompt_library_updated` event so the frontend mirrors it immediately. When unset, the tools
   * return a structured "unavailable" error and never touch storage.
   */
  setPromptLibrary(manager?: import("../prompt-library.js").PromptLibraryManager): void {
    this.promptLibraryManager = manager;
  }

  private promptLibraryManager?: import("../prompt-library.js").PromptLibraryManager;

  /**
   * Attach the persistent custom-agent store (called once at boot). When set, the
   * custom-agent management tools (create_agent / list_available_agents / delete_agent)
   * can create, list, and delete top-level custom agents for the Main Agent and every
   * Custom Agent (both run through this core runtime). Every mutation emits a
   * `custom_agents_updated` event so the frontend mirrors it immediately. When unset,
   * the tools return a structured "unavailable" error and never touch storage.
   */
  setCustomAgents(
    manager?: import("./customagent/index.js").CustomAgentManager,
  ): void {
    this.customAgentsManager = manager;
  }

  private customAgentsManager?: import("./customagent/index.js").CustomAgentManager;

  /**
   * Attach the persistent custom-system-prompt store (called once at boot). When set, the
   * custom-system-prompt tools (save_custom_system_prompt / list_available_custom_system_prompt /
   * delete_custom_system_prompt) can save, list, and delete reusable system prompts for the Main
   * Agent and every Custom Agent (both run through this core runtime). Every mutation emits a
   * `custom_system_prompts_updated` event so the frontend mirrors it immediately. When unset, the
   * tools return a structured "unavailable" error and never touch storage.
   */
  setCustomSystemPrompts(
    manager?: import("./mainagentprompt/index.js").MainAgentPromptManager,
  ): void {
    this.customSystemPromptsManager = manager;
  }

  private customSystemPromptsManager?: import("./mainagentprompt/index.js").MainAgentPromptManager;

  /**
   * Attach the speech runtime (called once at boot). When set, the generate_speech tool can
   * synthesize audio with an automatically selected, connected TTS provider for the Main Agent
   * and every Custom Agent (both run through this core runtime). When unset, the tool returns a
   * structured "unavailable" error.
   */
  setSpeechRuntime(runtime?: import("./tools/types.js").SpeechRuntime): void {
    this.speechRuntime = runtime;
  }

  private speechRuntime?: import("./tools/types.js").SpeechRuntime;

  /**
   * Execute a full autonomous turn: stream reasoning + tokens, run tools natively, and
   * loop (Thought -> Action -> Observation) until the model produces a final answer with
   * no further tool calls. The loop is UNBOUNDED — there is no iteration limit; the agent
   * keeps working until it is genuinely done or the turn is aborted.
   */
  async run(
    request: RunAgentRequest,
    session: ChatSession,
    buffer: SessionEventBuffer,
    signal: AbortSignal,
  ): Promise<void> {
    const send = (event: string, data: Record<string, unknown>) => buffer.append(event, data);

    // Hoisted so the post-turn memory-agent trigger (in `finally`) can hand the background
    // memory agent the FINAL memory state of this turn, including the main agent's own writes.
    let memoryRuntime: MemoryRuntime | undefined;
    let turnOk = false;

    try {
      let provider: Provider;
      try {
        provider = resolveProvider(this.providers, request.provider, request.customProvider);
      } catch (error) {
        send("error", { code: "provider_error", message: messageOf(error) });
        send("done", { ok: false });
        return;
      }

      // Memory runtime for this turn — a snapshot of the user's memory files that the `memory`
      // tool reads and mutates. Present only for main-agent tool calls. The four pre-added files
      // (MEMORY.md, SOUL.md, USER.md, session-memory.md) are auto-appended to the user's FIRST
      // message of a chat so the agent starts every conversation already knowing its accumulated
      // context.
      memoryRuntime = createMemoryRuntime(request.memory ?? []);

      // Knowledge runtime for this turn — a browser-backed snapshot of the user's knowledge base
      // (a file-tree of durable reference material) that the knowledge_* tools read and mutate.
      // Present only for main-agent tool calls. Unlike memory it has no pre-added files; a one-time
      // notice is appended to the user's FIRST message ONLY when the user actually has knowledge
      // files, telling the agent to discover/read them with the knowledge tools.
      const knowledgeRuntime = createKnowledgeRuntime(request.knowledge ?? []);

      // Prompt-library runtime for this turn — a bridge over the persistent prompt library (the
      // SQLite app_state document the frontend syncs) so the prompt-library tools can list, save,
      // and delete the user's reusable prompts. Present for the Main Agent, every Custom Agent
      // (which runs through this same core runtime), and team/CEO agents — never for sub-agents,
      // chat mode, or the memory agent.
      const promptLibraryRuntime = this.promptLibraryManager
        ? createPromptLibraryRuntime(this.promptLibraryManager)
        : undefined;

      // Custom-agents runtime for this turn — a bridge over the persistent custom-agent store
      // (the SQLite app_state document the frontend syncs) so the custom-agent management
      // tools (create_agent / list_available_agents / delete_agent) can create, list, and
      // delete top-level custom agents. Present for the Main Agent and every Custom Agent
      // (same core runtime), and team/CEO agents — never for sub-agents, chat mode, or the
      // memory agent.
      const customAgentsRuntime = this.customAgentsManager
        ? createCustomAgentsRuntime(this.customAgentsManager)
        : undefined;

      // Custom-system-prompts runtime for this turn — a bridge over the persistent store
      // (the SQLite app_state document the frontend syncs) so the custom-system-prompt tools
      // (save_custom_system_prompt / list_available_custom_system_prompt /
      // delete_custom_system_prompt) can save, list, and delete reusable system prompts.
      // Present for the Main Agent and every Custom Agent (same core runtime), and team/CEO
      // agents — never for sub-agents, chat mode, or the memory agent.
      const customSystemPromptsRuntime = this.customSystemPromptsManager
        ? createCustomSystemPromptsRuntime(this.customSystemPromptsManager)
        : undefined;

      // "First user input" = no prior user turn exists in this session's history. On that first
      // message (and only then) we prepend the pre-added memory files so the model has its
      // persistent context; later turns rely on the `memory` tool to read anything it needs. The
      // knowledge-base notice is likewise appended only on this first message (and only if any
      // knowledge files exist).
      const isFirstUserMessage = !session.messages.some((m) => m.role === "user");
      const userContent = isFirstUserMessage
        ? withFirstMessageContext(
            request.userMessage,
            memoryRuntime.firstMessageContext(),
            knowledgeRuntime.firstMessageContext(),
          )
        : request.userMessage;

      session.messages.push({ role: "user", content: userContent });
      const reuseSessionsEnabled = request.enableReuseSubAgentSession === true;
      // A Custom Agent (top-level, user-created Main Agent) supplies its own fully-customized system
      // prompt, used verbatim. The default Main Agent has no override and builds its prompt as before.
      const promptOverride = request.systemPromptOverride?.trim();
      const basePrompt =
        promptOverride && promptOverride.length > 0
          ? promptOverride
          : buildSystemPrompt(this.config.workspaceRoot, {
              enableReuseSubAgentSession: reuseSessionsEnabled,
            });
      // Expose the sub-agent session tools to the model only when the setting is on. Everything else
      // in the registry is always available; the two session tools are filtered out otherwise. The
      // multi-agent team tools are always hidden from a single agent. The channel-only tools
      // (send_responses) are hidden too — unless this turn arrived from a messaging channel.
      const hiddenTools = new Set<string>(TEAM_TOOLS);
      if (!reuseSessionsEnabled) for (const name of SESSION_REUSE_TOOLS) hiddenTools.add(name);
      if (!request.channel) for (const name of CHANNEL_ONLY_TOOLS) hiddenTools.add(name);
      let toolSchemas = this.tools.schemas.filter((s) => !hiddenTools.has(s.function.name));
      // Custom Agents run with only their selected tools (team tools remain excluded above).
      // Connector tool names (SCREAMING_SNAKE_CASE, never in the static registry) survive this
      // filter below: they are re-added from the connector runtime when selected.
      if (request.allowedToolNames) {
        const allow = new Set(request.allowedToolNames);
        toolSchemas = toolSchemas.filter((s) => allow.has(s.function.name));
      }
      // Channel turns always carry the channel tools, even when a Custom Agent did not select
      // them (they are never selectable in the UI — the runner appends them explicitly).
      if (request.channel) {
        const present = new Set(toolSchemas.map((s) => s.function.name));
        for (const schema of this.tools.schemasFor(CHANNEL_ONLY_TOOLS)) {
          if (!present.has(schema.function.name)) toolSchemas.push(schema);
        }
      }
      const visionCapable = isVisionCapableModel(request.model, this.config);
      // Connected app connectors (Composio): every tool of every connected toolkit is
      // advertised as NATIVE function tools — no allowlist, no subset, no cap. The
      // runtime is always handed to the tool context (not only when it is already
      // active) so an app the agent connects mid-turn can be attached and used within
      // the SAME turn; it stays inert (zero network) while nothing is connected.
      const connectorRuntime = await ConnectorRuntime.create({
        apiKey: request.composioApiKey ?? "",
        connections: request.connectors ?? [],
      });
      if (connectorRuntime.active) {
        const connectorSchemas = connectorRuntime.schemas();
        if (request.allowedToolNames) {
          // Custom Agent: keep only the connector tools the agent selected.
          const allow = new Set(request.allowedToolNames);
          toolSchemas = [...toolSchemas, ...connectorSchemas.filter((s) => allow.has(s.function.name))];
        } else {
          toolSchemas = [...toolSchemas, ...connectorSchemas];
        }
      }
      // Tell the model about its connected apps (a short hint — the tools themselves
      // carry full descriptions as native schemas).
      const connectorHint = connectorRuntime.active ? connectorRuntime.hint() : "";
      // Connected MCP servers: every enabled server's FULL tool catalog is
      // advertised as NATIVE function tools — no allowlist, no subset, no cap
      // (minus the tools the user switched off per server). Inert (zero
      // network) when no server is enabled. Secrets never leave the backend:
      // the wire carries server ids, the manager resolves the full configs.
      const mcpRuntime = this.mcpManager
        ? await McpRuntime.create({
            manager: this.mcpManager,
            serverIds: request.mcpServers?.map((s) => s.id),
            signal,
          })
        : null;
      if (mcpRuntime?.active) {
        const mcpSchemas = mcpRuntime.schemas();
        if (request.allowedToolNames) {
          // Custom Agent: keep only the MCP tools the agent selected.
          const allow = new Set(request.allowedToolNames);
          toolSchemas = [...toolSchemas, ...mcpSchemas.filter((s) => allow.has(s.function.name))];
        } else {
          toolSchemas = [...toolSchemas, ...mcpSchemas];
        }
      }
      // Tell the model about its MCP servers (a short hint — the tools themselves
      // carry full descriptions as native schemas).
      const mcpHint = mcpRuntime?.active ? mcpRuntime.hint() : "";
      // Channel turns additionally see the channel rules (send_responses usage, disabled
      // ask_question_to_user, plan approval via /@ok / /@no). Web-app turns never see this.
      const channelSection = request.channel ? buildChannelSystemSection(request.channel) : "";
      const systemPrompt = [basePrompt, connectorHint ? `# Connected apps\n- ${connectorHint}` : "", mcpHint ? `# Connected MCP servers\n- ${mcpHint}` : "", channelSection]
        .filter((part) => part.length > 0)
        .join("\n\n");
      const web: WebToolsConfig = {
        searchProvider: request.searchProvider ?? this.config.searchProvider,
        fetchProvider: request.fetchProvider ?? this.config.fetchProvider,
        tavilyApiKey: request.tavilyApiKey || this.config.tavilyApiKey || undefined,
        exaApiKey: request.exaApiKey || this.config.exaApiKey || undefined,
        serpapiApiKey: request.serpapiApiKey || this.config.serpapiApiKey || undefined,
        firecrawlApiKey: request.firecrawlApiKey || this.config.firecrawlApiKey || undefined,
      };

      // Sub-agent runtime for this turn — a separate LLM call per sub-agent, using the same
      // provider/model/credentials the user chose for the main agent. Streams `sub_agent_*`
      // side-channel events onto the same buffer so the UI can show live progress. The agent's
      // built-in default sub-agents are merged underneath so they are pre-added and always
      // available, unless the user provides their own sub-agent with the same name (which
      // overrides the default).
      const defaultSubAgents = await resolveDefaultSubAgents();
      const subAgentRuntime = createSubAgentRuntime({
        provider,
        tools: this.tools,
        config: this.config,
        chatId: request.chatId,
        definitions: mergeDefaultSubAgents(defaultSubAgents, request.subAgents ?? []),
        model: request.model,
        apiKey: request.apiKey,
        baseUrl: request.baseUrl,
        temperature: request.temperature,
        effort: request.effort,
        send,
        // The turn's connector runtime is shared with sub-agents so a sub-agent granted
        // connector tools can execute them natively (same account, same catalog).
        connectors: connectorRuntime.active ? connectorRuntime : undefined,
        // The turn's MCP runtime is shared with sub-agents so a sub-agent granted
        // MCP tools can execute them natively (same servers, same catalog).
        mcp: mcpRuntime?.active ? mcpRuntime : undefined,
        // Snapshot the live conversation so a call_sub_agent with send_my_context=true can share
        // the surrounding context. Returns the current messages at the moment the sub-agent is called.
        getConversationContext: () => session.messages,
        // Same effective context limit + threshold the main agent uses this turn, so
        // sub-agents trigger the SAME automatic summarization at 90% and continue.
        contextLimit: typeof request.contextLimit === "number" ? request.contextLimit : null,
        summaryThreshold: request.summaryThreshold ?? this.config.summaryThreshold ?? 0.9,
        contextManagementMethod: request.contextManagementMethod,
        slidingWindowTruncatePercent: request.slidingWindowTruncatePercent,
      });

      // Skill runtime for this turn — enumerates the user's skills (list_skills) and materializes
      // them onto disk inside the workspace's ".mythgram/skills" directory (skill_initialize). Skills, like
      // sub-agents, are authored in the frontend and travel with each turn. The agent's built-in
      // default skills are merged underneath so they are pre-added and always available, unless
      // the user provides their own skill with the same name (which overrides the default).
      const defaultSkills = await resolveDefaultSkills();
      const skillRuntime = createSkillRuntime(mergeDefaultSkills(defaultSkills, request.skills ?? []));

      // Todo runtime for this turn — a browser-backed snapshot of the user's todo list that the
      // TodoWrite / read_todos tools read and update. Present only for main-agent tool calls.
      const todoRuntime = createTodoRuntime(request.todos ?? []);

      // Schedule runtime for this turn — a bridge over the persistent cron system (SQLite
      // schedules table + background scheduler) so the schedule_* tools can create/list/
      // update/on/off/run-now/delete/inspect schedules. Schedules created here run as the
      // SAME agent that is active this turn: the Custom Agent handling it (with its id),
      // or the built-in Default Agent.
      const scheduleRuntime = createScheduleRuntime({
        store: this.scheduleStore,
        scheduler: this.scheduleScheduler,
        agent: {
          type: request.customAgent ? "custom" : "default",
          customAgentId: request.customAgent?.id ?? null,
          provider: request.provider,
          model: request.model,
        },
      });

      const visibleAnswer: string[] = [];
      const visibleReasoning: string[] = [];
      let iteration = 0;
      // Automatic summarization handoffs may run MULTIPLE times per turn and
      // across turns in one session: each time utilization reaches the
      // threshold a new handoff job owns the pause→resume cycle. Only one job
      // is ever active (the loop awaits it); a failed job blocks further
      // auto-triggers this turn to avoid an indefinite retry loop, while a
      // successful replacement resets usage tracking so growth can trigger again.
      let handoffFailedThisTurn = false;
      let completedHandoffs = 0;
      let slidingWindowFailedThisTurn = false;
      let completedTruncations = 0;
      let lastPromptTokens: number | undefined;

      // The agent runs with NO iteration cap. `limit: null` signals "unlimited" to any UI listener.
      send("iteration", { current: 0, limit: null });

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (signal.aborted) {
          send("done", { ok: false, aborted: true });
          return;
        }

        iteration += 1;
        send("iteration", { current: iteration, limit: null });
        send("status", { state: "thinking", label: "Thinking..." });

        const answerParts: string[] = [];
        const reasoningParts: string[] = [];
        let toolCalls: ToolCall[] = [];
        let finishReason: string | null = null;
        // Per-request token usage reported by the provider for THIS LLM call. `prompt_tokens`
        // is the current context size of the request (system + history + tools) — the most
        // accurate context signal available. Later iterations supersede earlier ones; the
        // frontend keeps the latest per conversation. Null when the provider reports nothing.
        let requestUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

        try {
          const stream = provider.streamChatCompletion({
            apiKey: request.apiKey,
            model: request.model,
            messages: this.buildProviderMessages(systemPrompt, session.messages),
            tools: toolSchemas,
            baseUrl: request.baseUrl,
            temperature: request.temperature,
            effort: request.effort,
            signal,
          });

          for await (const delta of stream) {
            if (delta.reasoning) {
              const cleaned = normalize(delta.reasoning);
              reasoningParts.push(cleaned);
              visibleReasoning.push(cleaned);
              send("reasoning", { value: cleaned });
            }
            if (delta.text) {
              const cleaned = normalize(delta.text);
              answerParts.push(cleaned);
              visibleAnswer.push(cleaned);
              send("token", { value: cleaned });
            }
            if (delta.toolCalls) {
              toolCalls = mergeToolCalls(toolCalls, delta.toolCalls);
            }
            if (delta.finishReason) {
              finishReason = delta.finishReason;
            }
            // Keep the latest usage payload of this request (providers typically send it
            // once, on the final chunk). Malformed values are dropped, never forwarded.
            const usage = sanitizeUsage(delta.usage);
            if (usage) requestUsage = usage;
          }
        } catch (error) {
          if (signal.aborted) {
            send("done", { ok: false, aborted: true });
            return;
          }
          send("error", { code: "provider_api_error", message: `Provider API error: ${messageOf(error)}` });
          send("done", { ok: false });
          return;
        }

        // Record this request's context size in the turn's event log (the existing logging
        // pipeline: SessionEventBuffer → SQLite stream_events → SSE replay). The `agent` tag
        // identifies the top-level agent through the run-request architecture: the shared core
        // runtime handles both the built-in Main Agent and Custom Agents, distinguished by
        // `request.customAgent`. Team/CEO/chat turns never reach this runner, and sub-agent
        // loops emit only `sub_agent_*` events — so `agent: "main"` reliably means the main
        // agent. Tagged (rather than filtered) so additional agents can be supported later
        // without changing the pipeline.
        if (requestUsage) {
          send("context_usage", {
            agent: request.customAgent ? "custom" : "main",
            provider: request.provider,
            model: request.model,
            prompt_tokens: requestUsage.prompt_tokens,
            completion_tokens: requestUsage.completion_tokens,
            total_tokens: requestUsage.total_tokens,
            iteration,
          });
          if (typeof requestUsage.prompt_tokens === "number") {
            lastPromptTokens = requestUsage.prompt_tokens;
          }
        }

        const hasToolCalls = toolCalls.some((c) => c.function.name) || finishReason === "tool_calls";

        if (hasToolCalls) {
          const assistantMessage: StoredMessage = {
            role: "assistant",
            content: answerParts.join("") || null,
            tool_calls: toolCalls.map((c) => ({
              id: c.id,
              type: c.type,
              function: { name: c.function.name, arguments: c.function.arguments },
            })),
          };
          if (reasoningParts.length > 0) assistantMessage.reasoning_content = reasoningParts.join("");
          session.messages.push(assistantMessage);

          const imageMessages: StoredMessage[] = [];
          // Custom Agents carry an explicit tool allow-list (built once per turn).
          const customAllow = request.allowedToolNames ? new Set(request.allowedToolNames) : null;

          for (const toolCall of toolCalls) {
            if (!toolCall.function.name) continue;
            const args = safeJsonParse(toolCall.function.arguments);
            const toolName = toolCall.function.name;
            // Connector tools (Composio) are native function tools served by the turn's
            // connector runtime; MCP tools are native function tools served by the
            // turn's MCP runtime; everything else goes through the static registry.
            // A Custom Agent may only reach the connector/MCP tools it selected
            // (its allow-list).
            const isConnectorTool =
              connectorRuntime.has(toolName) && (!customAllow || customAllow.has(toolName));
            const isMcpTool =
              (mcpRuntime?.has(toolName) ?? false) && (!customAllow || customAllow.has(toolName));
            const toolLabel = isConnectorTool
              ? connectorRuntime.label(toolName)
              : isMcpTool && mcpRuntime
                ? mcpRuntime.label(toolName)
                : this.tools.label(toolName, args);

            send("tool_call", {
              id: toolCall.id,
              name: toolName,
              args,
              label: toolLabel,
            });

            const result = isConnectorTool
              ? await connectorRuntime.execute(toolName, args)
              : isMcpTool && mcpRuntime
              ? await mcpRuntime.execute(toolName, args)
              : await this.tools.execute(toolName, args, {
              workspaceRoot: this.config.workspaceRoot,
              shellTimeoutMs: this.config.shellTimeoutMs,
              signal,
              web,
              subAgents: subAgentRuntime,
              skills: skillRuntime,
              todos: todoRuntime,
              memory: memoryRuntime,
              knowledge: knowledgeRuntime,
              speech: this.speechRuntime,
              promptLibrary: promptLibraryRuntime,
              customAgents: customAgentsRuntime,
              customSystemPrompts: customSystemPromptsRuntime,
              schedules: scheduleRuntime,
              toolCallId: toolCall.id ?? undefined,
              chatId: request.chatId,
              emit: send,
              planApprovals: this.planApprovals,
              planApprovalTimeoutMs:
                request.planApprovalTimeoutMs ?? this.config.planApprovalTimeoutMs,
              askQuestions: this.askQuestions,
              questionTimeoutMs: this.config.questionTimeoutMs,
              model: request.model,
              visionCapable,
              channel: request.channel ?? undefined,
              connectors: connectorRuntime,
              connectorManager: this.connectorManager,
              mcp: mcpRuntime ?? undefined,
              mcpManager: this.mcpManager,
              channelManager: this.channelManager,
              // LLM-created sub-agents may also use the turn's connector + MCP tools.
              availableToolNames: [
                ...this.tools.names(),
                ...(connectorRuntime.active ? connectorRuntime.names() : []),
                ...(mcpRuntime?.active ? mcpRuntime.names() : []),
              ],
            });

            // read_image attaches the loaded image to its result. The base64 payload
            // is stripped from the model-visible tool message (it is useless as text
            // and would bloat every follow-up request); the image is instead injected
            // as a vision content part after all tool responses so the model can see it.
            const resultForModel = withoutImageAttachment(result);
            const imageAttachment = extractImageAttachment(result);

            session.messages.push({
              role: "tool",
              tool_call_id: toolCall.id ?? undefined,
              name: toolCall.function.name,
              content: JSON.stringify(resultForModel),
            });

            if (imageAttachment) imageMessages.push(buildImageMessage(imageAttachment));

            send("tool_result", {
              id: toolCall.id,
              name: toolCall.function.name,
              ok: result.ok,
              result: resultForModel,
              label: toolLabel,
            });

            // Agent-driven MCP management tools mutate the persisted servers AND the
            // live turn runtime (attach/detach). Refresh the advertised native mcp_*
            // schemas so the VERY NEXT model iteration can call the new tools —
            // without waiting for the next chat turn.
            if (isMcpManagementTool(toolCall.function.name) && mcpRuntime) {
              try {
                const freshSchemas = mcpRuntime.schemas();
                const base = toolSchemas.filter((s) => !isMcpToolName(s.function.name));
                if (request.allowedToolNames) {
                  const allow = new Set(request.allowedToolNames);
                  toolSchemas = [...base, ...freshSchemas.filter((s) => allow.has(s.function.name))];
                } else {
                  toolSchemas = [...base, ...freshSchemas];
                }
              } catch {
                // schema refresh is best-effort — the turn still continues
              }
            }

            // Same for the application connectors: connect_applications_connectors
            // attaches the freshly authorized app's FULL tool catalog to the live
            // runtime, and disconnect_application_connector detaches it. Refresh the
            // advertised native schemas so an app the user just connected is usable on
            // the VERY NEXT model iteration instead of the next chat turn.
            if (isConnectorManagementTool(toolCall.function.name)) {
              try {
                const freshSchemas = connectorRuntime.schemas();
                // Drop every previously advertised connector tool by NAME SHAPE, not by
                // runtime membership: a tool that was just detached must disappear too.
                const base = toolSchemas.filter((s) => !isConnectorToolName(s.function.name));
                if (request.allowedToolNames) {
                  const allow = new Set(request.allowedToolNames);
                  toolSchemas = [...base, ...freshSchemas.filter((s) => allow.has(s.function.name))];
                } else {
                  toolSchemas = [...base, ...freshSchemas];
                }
              } catch {
                // schema refresh is best-effort — the turn still continues
              }
            }
          }

          // Append any vision inputs after all tool responses so providers see
          // contiguous tool messages immediately following the assistant tool_calls.
          for (const imageMessage of imageMessages) {
            session.messages.push(imageMessage);
          }

          // Automatic context handoff: the current iteration's tools have fully
          // completed (no in-flight result is discarded), so this is the safe
          // pause point before the next LLM generation. May run multiple times
          // per session whenever utilization reaches the threshold again.
          //
          // Two mutually exclusive methods (Settings → Context management):
          //  - "summarization" (default): pause → summary agent → replace context.
          //  - "sliding_window": pause (stop) → delete oldest 30% tokens → resume.
          const contextMethod = normalizeContextManagementMethod(request.contextManagementMethod);
          if (contextMethod === "sliding_window") {
            if (!slidingWindowFailedThisTurn) {
              const contextLimit =
                typeof request.contextLimit === "number" ? request.contextLimit : null;
              if (shouldTriggerSlidingWindow(lastPromptTokens, contextLimit) && contextLimit) {
                const truncatePercent = normalizeSlidingWindowTruncatePercent(
                  request.slidingWindowTruncatePercent ?? this.config.slidingWindowTruncatePercent,
                );
                const utilizationBefore = slidingWindowUtilizationOf(lastPromptTokens, contextLimit);
                const truncation = executeSlidingWindowTruncation({
                  messages: session.messages,
                  contextLimit,
                  truncatePercent,
                });
                if (truncation.removed.length > 0) {
                  const isCustomAgent = Boolean(request.customAgent);
                  const truncationId = createSlidingWindowTruncationId();
                  // Atomic replacement: oldest truncatable messages are dropped;
                  // protected head (memory/knowledge) + latest user input survive.
                  session.messages = truncation.kept;
                  completedTruncations += 1;
                  // Fresh usage is required before another truncation: the stale
                  // high reading must not retrigger before the next LLM call.
                  lastPromptTokens = undefined;
                  send("sliding_window_truncated", {
                    truncation_id: truncationId,
                    chat_id: request.chatId,
                    agent: isCustomAgent ? "custom" : "main",
                    ...(isCustomAgent && request.customAgent?.id
                      ? { custom_agent_id: request.customAgent.id }
                      : {}),
                    ...(isCustomAgent && request.customAgent?.name
                      ? { custom_agent_name: request.customAgent.name }
                      : {}),
                    removed_messages: truncation.removed.length,
                    freed_tokens_estimate: truncation.freedTokens,
                    target_tokens: truncation.targetTokens,
                    truncate_percent: truncatePercent,
                    utilization_before: utilizationBefore,
                    context_limit: contextLimit,
                    completed_truncations: completedTruncations,
                    preview: truncation.preview,
                    // Tool-chip shape so the chat renders a clickable block with
                    // the deleted tokens inside its expandable result.
                    id: truncationId,
                    name: "sliding_window_truncated",
                    label: `Sliding window: removed ${truncation.removed.length} old message(s) (~${truncation.freedTokens.toLocaleString("en-US")} tokens)`,
                    ok: true,
                    result: {
                      ok: true,
                      data: {
                        removed_messages: truncation.removed.length,
                        freed_tokens_estimate: truncation.freedTokens,
                        truncate_percent: truncatePercent,
                        preview: truncation.preview,
                        message: `Deleted the oldest ${truncation.removed.length} message(s) (~${truncation.freedTokens} tokens, target ${truncation.targetTokens}) to stay within context. Newest context preserved.`,
                      },
                    },
                  });
                } else {
                  // Nothing truncatable (only protected context remains) — block
                  // further triggers this turn to avoid an infinite retry loop.
                  slidingWindowFailedThisTurn = true;
                }
              }
            }
          } else if (!handoffFailedThisTurn) {
            const contextLimit =
              typeof request.contextLimit === "number" ? request.contextLimit : null;
            const threshold = request.summaryThreshold ?? this.config.summaryThreshold ?? 0.9;
            if (shouldTriggerSummarization(lastPromptTokens, contextLimit, { threshold })) {
              const isCustomAgent = Boolean(request.customAgent);
              const handoffOutcome = await executeHandoff({
                chatId: request.chatId,
                messages: session.messages,
                systemPrompt,
                memoryActive: (memoryRuntime?.files.length ?? 0) > 0,
                knowledgeActive: (knowledgeRuntime?.files.length ?? 0) > 0,
                agent: isCustomAgent ? "custom" : "main",
                customAgentId: isCustomAgent ? request.customAgent?.id : undefined,
                customAgentName: isCustomAgent ? request.customAgent?.name : undefined,
                provider,
                model: request.model,
                apiKey: request.apiKey,
                baseUrl: request.baseUrl,
                temperature: request.temperature,
                effort: request.effort,
                signal,
                send,
              });
              if (handoffOutcome.ok && handoffOutcome.replacement) {
                // Atomic replacement: the active LLM history now contains only
                // the approved continuation inputs. Old history is dereferenced
                // and cannot be reloaded by context builders.
                session.messages = handoffOutcome.replacement;
                markResumed(handoffOutcome.handoff, send);
                completedHandoffs += 1;
                // Fresh usage is required before another handoff: the stale
                // high reading must not retrigger before the next LLM call.
                lastPromptTokens = undefined;
              } else {
                // Failure preserves the original context for recovery. Never
                // resume with a missing summary; block further auto-triggers
                // this turn so a persistently high reading cannot loop forever.
                // The next user turn may trigger again with fresh context.
                handoffFailedThisTurn = true;
                send("recovery_required", {
                  chat_id: request.chatId,
                  handoff_id: handoffOutcome.handoff.handoffId,
                  state: handoffOutcome.state,
                  code: handoffOutcome.code ?? "handoff_failed",
                  completed_handoffs: completedHandoffs,
                  agent: request.customAgent ? "custom" : "main",
                  ...(request.customAgent?.id ? { custom_agent_id: request.customAgent.id } : {}),
                  ...(request.customAgent?.name ? { custom_agent_name: request.customAgent.name } : {}),
                });
              }
            }
          }

          // Observation delivered — loop again so the model can reason about the results.
          continue;
        }

        // No tool calls -> this is the final assistant answer for the turn.
        const finalContent = answerParts.join("");
        const finalMessage: StoredMessage = { role: "assistant", content: finalContent };
        if (reasoningParts.length > 0) finalMessage.reasoning_content = reasoningParts.join("");
        session.messages.push(finalMessage);

        send("message_complete", {
          content: visibleAnswer.join(""),
          reasoning: visibleReasoning.length > 0 ? visibleReasoning.join("") : null,
          iteration_count: iteration,
        });
        turnOk = true;
        send("done", { ok: true });
        return;
      }
    } finally {
      // The main agent's turn is over — hand the COMPLETE turn context (full untruncated
      // transcript, the triggering user prompt, and the FINAL memory state) to the background
      // memory agent, but ONLY when its schedule allows it. By default the memory agent builds
      // memory after every N completed user tasks (N = memoryAgentInterval, default 3) and stays
      // idle before that; when memoryAgentEnabled is false it never runs, so no extra LLM tokens
      // are spent. Every trigger starts a brand-new memory-agent session; the service's FIFO queue
      // serializes overlapping requests. Enqueued BEFORE the buffer closes so the
      // `memory_agent_queued` notice still reaches any attached client.
      if (
        this.memoryAgent &&
        memoryRuntime &&
        session.messages.some((m) => m.role === "user") &&
        shouldRunMemoryAgent(session.messages, request.memoryAgentEnabled, request.memoryAgentInterval)
      ) {
        try {
          const runId = this.memoryAgent.enqueue({
            chatId: request.chatId,
            userMessage: request.userMessage,
            transcript: session.messages.map((m) => ({ ...m })),
            memoryFiles: memoryRuntime.files,
            turnOk,
            aborted: signal.aborted,
            provider: request.provider,
            model: request.model,
            apiKey: request.apiKey,
            baseUrl: request.baseUrl,
            customProvider: request.customProvider,
            temperature: request.temperature,
            effort: request.effort,
          });
          if (runId) {
            send("memory_agent_queued", { run_id: runId, chat_id: request.chatId });
          }
        } catch {
          // The memory agent must never break the chat flow.
        }
      }

      buffer.setDone();
      session.running = false;
      session.updatedAt = Date.now();
    }
  }

  private buildProviderMessages(systemPrompt: string, messages: StoredMessage[]): Array<Record<string, unknown>> {
    const built: Array<Record<string, unknown>> = [{ role: "system", content: systemPrompt }];
    for (const message of messages) {
      const entry: Record<string, unknown> = { role: message.role };
      if (message.content !== undefined && message.content !== null) entry.content = message.content;
      else if (message.role === "assistant" && message.tool_calls) entry.content = null;
      if (message.tool_calls) entry.tool_calls = message.tool_calls;
      if (message.tool_call_id) entry.tool_call_id = message.tool_call_id;
      if (message.name) entry.name = message.name;
      // Reasoning-capable models (e.g. OpenCode Zen thinking mode, DeepSeek) require the
      // reasoning_content of a prior assistant message to be passed back unchanged on the
      // next request; omitting it triggers a 400 invalid_request_error.
      if (message.reasoning_content) entry.reasoning_content = message.reasoning_content;
      built.push(entry);
    }
    return built;
  }
}

/**
 * Decide whether the background memory agent should run after the just-finished turn.
 *
 * System default: the memory agent builds memory after every N completed user tasks
 * (N = `interval`, default 3) and stays idle before that — e.g. tasks 1–2 produce no run,
 * task 3 triggers a build, then tasks 4–5 are idle and task 6 triggers again. When `enabled`
 * is explicitly false the memory agent never runs, so no extra LLM tokens are spent.
 * The completed-task count is the number of user-role messages in the session transcript,
 * which survives backend restarts (rehydrated from SQLite) and covers Custom Agents too
 * (they execute through this same runtime).
 */
export function shouldRunMemoryAgent(
  messages: Array<{ role: string }>,
  enabled?: boolean,
  interval?: number,
): boolean {
  if (enabled === false) return false;
  const every = Math.floor(interval ?? 3);
  const n = every >= 1 ? every : 3;
  let userTasks = 0;
  for (const m of messages) {
    if (m.role === "user") userTasks += 1;
  }
  if (userTasks <= 0) return false;
  return userTasks % n === 0;
}

/**
 * Prepend the one-time context blocks to the user's FIRST message of a chat: the pre-added memory
 * files (MEMORY.md/SOUL.md/USER.md), then the knowledge-base notice (only present when the user has
 * knowledge files). Each block is added only when non-empty; the raw message is returned unchanged
 * when there is nothing to add.
 */
function withFirstMessageContext(
  userMessage: string,
  memoryContext: string,
  knowledgeContext: string,
): string {
  const blocks = [memoryContext.trim(), knowledgeContext.trim()].filter((b) => b.length > 0);
  if (blocks.length === 0) return userMessage;
  return `${blocks.join("\n\n")}\n\n${userMessage}`;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Sanitize a provider-reported usage payload. Returns the cleaned usage when at least
 * one non-negative finite token count is present, otherwise null (unavailable —
 * callers must not emit a zero-usage event for it). Never throws on malformed input.
 */
function sanitizeUsage(
  raw: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined,
): { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  const prompt_tokens = num((raw as Record<string, unknown>).prompt_tokens);
  const completion_tokens = num((raw as Record<string, unknown>).completion_tokens);
  const total_tokens = num((raw as Record<string, unknown>).total_tokens);
  if (prompt_tokens === undefined && completion_tokens === undefined && total_tokens === undefined) {
    return null;
  }
  return { prompt_tokens, completion_tokens, total_tokens };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Merge streamed tool-call fragments into complete tool calls, keyed by index. */
function mergeToolCalls(accumulated: ToolCall[], incoming: ToolCallDelta[]): ToolCall[] {
  const merged = accumulated.slice();
  for (const chunk of incoming) {
    const index = chunk.index ?? merged.length;
    while (merged.length <= index) {
      merged.push({ id: null, type: "function", function: { name: "", arguments: "" } });
    }
    const target = merged[index]!;
    if (chunk.id) target.id = chunk.id;
    if (chunk.function?.name) target.function.name += chunk.function.name;
    if (chunk.function?.arguments) target.function.arguments += chunk.function.arguments;
  }
  return merged;
}
