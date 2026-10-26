import type { AppConfig } from "../../config.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { resolveProvider } from "../providers/registry.js";
import type { Provider } from "../providers/types.js";
import type { ToolRegistry } from "../tools/index.js";
import type { ChatSession } from "../../services/sessionStore.js";
import type { SessionEventBuffer } from "../../services/eventBuffer.js";
import type { WebToolsConfig } from "../tools/types.js";
import { createMemoryRuntime } from "../memory.js";
import { createKnowledgeRuntime } from "../knowledge.js";
import { createSkillRuntime } from "../skills.js";
import { mergeDefaultSkills, resolveDefaultSkills } from "../skills/index.js";
import { createTodoRuntime } from "../todos.js";
import { createPromptLibraryRuntime } from "../promptLibrary.js";
import { createCustomAgentsRuntime } from "../customAgents.js";
import { createCustomSystemPromptsRuntime } from "../customSystemPrompts.js";
import { resolveDefaultSubAgents } from "../sub-agents/index.js";
import { ConnectorRuntime } from "../connectors/index.js";
import { McpRuntime, type McpManager } from "../mcp/index.js";
import { MultiAgentSessionStore } from "./store.js";
import { TeamOrchestrator } from "./runtime.js";
import type { RunTeamRequest } from "./types.js";

export type { AgentTeamDefinition, TeamMemberDefinition, RunTeamRequest } from "./types.js";
export { MultiAgentSessionStore } from "./store.js";

/**
 * The multi-agent team runner — the team counterpart of AgentRunner. It drives a whole agent team
 * (head + members) for one chat turn, streaming every agent's output onto the SAME turn event
 * buffer the single agent uses, so resume/replay/persistence all work unchanged. Agent contexts
 * persist across turns via an in-memory session store, so the team keeps its full context.
 */
export class MultiAgentRunner {
  private readonly store = new MultiAgentSessionStore();

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly tools: ToolRegistry,
    private readonly config: AppConfig,
    private readonly mcpManager?: McpManager,
    /**
     * Optional application-connector manager. When set, team agents (head + members)
     * can list/connect/disconnect/status the app connectors.
     */
    private readonly connectorManager?: import("../connectors/manager.js").ConnectorManager,
  ) {}

  /**
   * Attach the persistent schedule store + background scheduler (called once at boot).
   * When set, team agents granted the schedule_* tools can manage the cron system
   * (schedules run as the Default Agent).
   */
  setSchedules(
    store?: import("../../cron/store.js").ScheduleStore,
    scheduler?: import("../../cron/scheduler.js").ScheduleScheduler,
  ): void {
    this.scheduleStore = store;
    this.scheduleScheduler = scheduler;
  }

  private scheduleStore?: import("../../cron/store.js").ScheduleStore;
  private scheduleScheduler?: import("../../cron/scheduler.js").ScheduleScheduler;
  private channelManager?: import("../../channels/manager.js").ChannelManager;
  private promptLibrary?: import("../tools/types.js").PromptLibraryRuntime;
  private customAgents?: import("../tools/types.js").CustomAgentsRuntime;
  private customSystemPrompts?: import("../tools/types.js").CustomSystemPromptsRuntime;

  /**
   * Attach the persistent prompt library (called once at boot). When set, every team agent
   * (head/leader + members) granted the prompt-library tools can list, save, and delete the user's
   * saved prompts; every mutation emits a `prompt_library_updated` event the frontend mirrors.
   */
  setPromptLibrary(manager?: import("../../prompt-library.js").PromptLibraryManager): void {
    this.promptLibrary = manager ? createPromptLibraryRuntime(manager) : undefined;
  }

  /**
   * Attach the persistent custom-agent store (called once at boot). When set, every team agent
   * (head/leader + members) granted the custom-agent management tools can create, list, and
   * delete top-level custom agents; every mutation emits a `custom_agents_updated` event.
   */
  setCustomAgents(
    manager?: import("../customagent/index.js").CustomAgentManager,
  ): void {
    this.customAgents = manager ? createCustomAgentsRuntime(manager) : undefined;
  }

  /**
   * Attach the persistent custom-system-prompt store (called once at boot). When set, every team
   * agent (head/leader + members) granted the custom-system-prompt tools can save, list, and
   * delete reusable system prompts; every mutation emits a `custom_system_prompts_updated` event.
   */
  setCustomSystemPrompts(
    manager?: import("../mainagentprompt/index.js").MainAgentPromptManager,
  ): void {
    this.customSystemPrompts = manager
      ? createCustomSystemPromptsRuntime(manager)
      : undefined;
  }

  /**
   * Attach the messaging-channel manager (called once at boot). When set, team
   * agents granted the channel_* tools can inspect connections, wait for the
   * user to connect, and deliver messages.
   */
  setChannelManager(manager?: import("../../channels/manager.js").ChannelManager): void {
    this.channelManager = manager;
  }

  async run(
    request: RunTeamRequest,
    session: ChatSession,
    buffer: SessionEventBuffer,
    signal: AbortSignal,
  ): Promise<void> {
    const send = (event: string, data: Record<string, unknown>) => buffer.append(event, data);

    try {
      let provider: Provider;
      try {
        provider = resolveProvider(this.providers, request.provider, request.customProvider);
      } catch (error) {
        send("error", { code: "provider_error", message: messageOf(error) });
        send("done", { ok: false });
        return;
      }

      if (!request.team || !request.team.leader_name?.trim()) {
        send("error", { code: "invalid_team", message: "No valid agent team was provided." });
        send("done", { ok: false });
        return;
      }

      // Shared team tooling — one memory/knowledge/skill/todo surface for the whole team.
      const memory = createMemoryRuntime(request.memory ?? []);
      const knowledge = createKnowledgeRuntime(request.knowledge ?? []);
      const defaultSkills = await resolveDefaultSkills();
      const skills = createSkillRuntime(mergeDefaultSkills(defaultSkills, request.skills ?? []));
      const todos = createTodoRuntime(request.todos ?? []);
      const subAgentDefinitions = await resolveDefaultSubAgents();

      const web: WebToolsConfig = {
        searchProvider: request.searchProvider ?? this.config.searchProvider,
        fetchProvider: request.fetchProvider ?? this.config.fetchProvider,
        tavilyApiKey: request.tavilyApiKey || this.config.tavilyApiKey || undefined,
        exaApiKey: request.exaApiKey || this.config.exaApiKey || undefined,
        serpapiApiKey: request.serpapiApiKey || this.config.serpapiApiKey || undefined,
        firecrawlApiKey: request.firecrawlApiKey || this.config.firecrawlApiKey || undefined,
      };

      const teamSession = this.store.getOrCreate(request.chatId, request.team.id);
      const leaderKey = request.team.leader_name.trim().toLowerCase();
      const headCtx = teamSession.contexts.get(leaderKey);
      const isFirstMessage = !headCtx || !headCtx.messages.some((m) => m.role === "user");

      const firstMessageContext = isFirstMessage
        ? [memory.firstMessageContext().trim(), knowledge.firstMessageContext().trim()]
            .filter((b) => b.length > 0)
            .join("\n\n")
        : "";

      // Mirror the user message into the chat session transcript for persistence + the sidebar title.
      session.messages.push({ role: "user", content: request.userMessage });

      // Connected app connectors (Composio): the turn's connector runtime is shared by
      // the head, every member, and their sub-agents — every connected app's full tool
      // catalog is advertised natively to each of them. Inert when unconfigured.
      const connectors = await ConnectorRuntime.create({
        apiKey: request.composioApiKey ?? "",
        connections: request.connectors ?? [],
      });

      // Connected MCP servers for this turn (shared by the head, every
      // member, and their sub-agents). Inert when none are enabled.
      const mcp = this.mcpManager
        ? await McpRuntime.create({
            manager: this.mcpManager,
            serverIds: request.mcpServers?.map((s) => s.id),
            signal,
          })
        : null;

      const orchestrator = new TeamOrchestrator({
        provider,
        tools: this.tools,
        config: this.config,
        team: request.team,
        sendMessageToTeamEnabled: request.sendMessageToTeamEnabled,
        contexts: teamSession.contexts,
        chatId: request.chatId,
        model: request.model,
        providerId: request.provider,
        apiKey: request.apiKey,
        baseUrl: request.baseUrl,
        temperature: request.temperature,
        effort: request.effort,
        web,
        memory,
        knowledge,
        promptLibrary: this.promptLibrary,
        customAgents: this.customAgents,
        customSystemPrompts: this.customSystemPrompts,
        skills,
        todos,
        subAgentDefinitions,
        userSubAgents: request.subAgents ?? [],
        connectors,
        connectorManager: this.connectorManager,
        mcp: mcp ?? undefined,
        mcpManager: this.mcpManager,
        scheduleStore: this.scheduleStore,
        scheduleScheduler: this.scheduleScheduler,
        channelManager: this.channelManager,
        send,
        signal,
        contextLimit: typeof request.contextLimit === "number" ? request.contextLimit : null,
        summaryThreshold: request.summaryThreshold ?? this.config.summaryThreshold ?? 0.9,
        contextManagementMethod: request.contextManagementMethod,
        slidingWindowTruncatePercent: request.slidingWindowTruncatePercent,
      });

      await orchestrator.run(request.userMessage, firstMessageContext);

      if (signal.aborted) {
        send("done", { ok: false, aborted: true });
      } else {
        send("done", { ok: true });
      }
    } catch (error) {
      send("error", { code: "team_crashed", message: messageOf(error) });
      send("done", { ok: false });
    } finally {
      buffer.setDone();
      session.running = false;
      session.updatedAt = Date.now();
    }
  }

  /**
   * Raw context for one team agent (leader/member) in a chat: its persistent
   * conversation + the system prompt it last ran with. Returns null when the
   * chat has no team session or the agent id is unknown. Powers the context
   * popup's per-agent raw view (team section, runned agents only).
   */
  agentContext(
    chatId: string,
    agentId: string,
  ): { systemPrompt: string; messages: import("../../services/sessionStore.js").StoredMessage[] } | null {
    try {
      const session = this.store.get(chatId);
      if (!session) return null;
      const ctx = session.contexts.get(agentId.trim().toLowerCase());
      if (!ctx) return null;
      return {
        systemPrompt: ctx.systemPrompt,
        messages: ctx.messages.map((m) => ({ ...m })),
      };
    } catch {
      return null;
    }
  }

  /** Agent ids with a persisted team context in a chat (for raw-view discovery). */
  agentIds(chatId: string): string[] {
    try {
      const session = this.store.get(chatId);
      if (!session) return [];
      return [...session.contexts.values()].map((c) => c.id);
    } catch {
      return [];
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
