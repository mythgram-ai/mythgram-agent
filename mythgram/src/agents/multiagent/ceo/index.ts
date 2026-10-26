import type { AppConfig } from "../../../config.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import { resolveProvider } from "../../providers/registry.js";
import type { Provider } from "../../providers/types.js";
import type { ToolRegistry } from "../../tools/index.js";
import type { ChatSession } from "../../../services/sessionStore.js";
import type { SessionEventBuffer } from "../../../services/eventBuffer.js";
import type { WebToolsConfig } from "../../tools/types.js";
import { createMemoryRuntime } from "../../memory.js";
import { createKnowledgeRuntime } from "../../knowledge.js";
import { createSkillRuntime } from "../../skills.js";
import { mergeDefaultSkills, resolveDefaultSkills } from "../../skills/index.js";
import { createTodoRuntime } from "../../todos.js";
import { createPromptLibraryRuntime } from "../../promptLibrary.js";
import { createCustomAgentsRuntime } from "../../customAgents.js";
import { createCustomSystemPromptsRuntime } from "../../customSystemPrompts.js";
import { resolveDefaultSubAgents } from "../../sub-agents/index.js";
import { ConnectorRuntime } from "../../connectors/index.js";
import { McpRuntime, type McpManager } from "../../mcp/index.js";
import { CeoSessionStore } from "./store.js";
import { CeoOrchestrator } from "./runtime.js";
import type { RunCeoRequest } from "./types.js";

export type { CeoAgentDefinition, RunCeoRequest, CeoActorRole } from "./types.js";
export { CeoSessionStore } from "./store.js";
export { CeoOrchestrator } from "./runtime.js";

/**
 * The CEO multi-agent runner — the CEO counterpart of MultiAgentRunner. It drives a whole CEO
 * organization (a CEO agent controlling several agent teams' head/leaders + members) for one chat
 * turn, streaming every agent's output onto the SAME turn event buffer the single agent and the team
 * runner use, so resume/replay/persistence all work unchanged. It reuses the SAME multi-agent runtime
 * building blocks (agent loop, head/member runners, mailbox actor model). Agent contexts persist
 * across turns via an in-memory session store, so the organization keeps its full context.
 */
export class CeoAgentRunner {
  private readonly store = new CeoSessionStore();

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly tools: ToolRegistry,
    private readonly config: AppConfig,
    private readonly mcpManager?: McpManager,
    /**
     * Optional application-connector manager. When set, the CEO, its leaders, and its
     * members can list/connect/disconnect/status the app connectors.
     */
    private readonly connectorManager?: import("../../connectors/manager.js").ConnectorManager,
  ) {}

  /**
   * Attach the persistent schedule store + background scheduler (called once at boot).
   * When set, CEO, leader, and member agents granted the schedule_* tools can manage the
   * cron system (schedules run as the Default Agent).
   */
  setSchedules(
    store?: import("../../../cron/store.js").ScheduleStore,
    scheduler?: import("../../../cron/scheduler.js").ScheduleScheduler,
  ): void {
    this.scheduleStore = store;
    this.scheduleScheduler = scheduler;
  }

  private scheduleStore?: import("../../../cron/store.js").ScheduleStore;
  private scheduleScheduler?: import("../../../cron/scheduler.js").ScheduleScheduler;
  private channelManager?: import("../../../channels/manager.js").ChannelManager;
  private promptLibrary?: import("../../tools/types.js").PromptLibraryRuntime;
  private customAgents?: import("../../tools/types.js").CustomAgentsRuntime;
  private customSystemPrompts?: import("../../tools/types.js").CustomSystemPromptsRuntime;

  /**
   * Attach the persistent prompt library (called once at boot). When set, the CEO, every team
   * leader, and every team member granted the prompt-library tools can list, save, and delete the
   * user's saved prompts; every mutation emits a `prompt_library_updated` event the frontend mirrors.
   */
  setPromptLibrary(manager?: import("../../../prompt-library.js").PromptLibraryManager): void {
    this.promptLibrary = manager ? createPromptLibraryRuntime(manager) : undefined;
  }

  /**
   * Attach the persistent custom-agent store (called once at boot). When set, the CEO, every
   * team leader, and every team member granted the custom-agent management tools can create,
   * list, and delete top-level custom agents; every mutation emits a `custom_agents_updated`
   * event.
   */
  setCustomAgents(
    manager?: import("../../customagent/index.js").CustomAgentManager,
  ): void {
    this.customAgents = manager ? createCustomAgentsRuntime(manager) : undefined;
  }

  /**
   * Attach the persistent custom-system-prompt store (called once at boot). When set, the CEO,
   * every team leader, and every team member granted the custom-system-prompt tools can save,
   * list, and delete reusable system prompts; every mutation emits a
   * `custom_system_prompts_updated` event.
   */
  setCustomSystemPrompts(
    manager?: import("../../mainagentprompt/index.js").MainAgentPromptManager,
  ): void {
    this.customSystemPrompts = manager
      ? createCustomSystemPromptsRuntime(manager)
      : undefined;
  }

  /**
   * Attach the messaging-channel manager (called once at boot). When set, CEO,
   * leader, and member agents granted the channel_* tools can inspect
   * connections, wait for the user to connect, and deliver messages.
   */
  setChannelManager(manager?: import("../../../channels/manager.js").ChannelManager): void {
    this.channelManager = manager;
  }

  async run(
    request: RunCeoRequest,
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

      if (!request.ceo || !request.ceo.name?.trim()) {
        send("error", { code: "invalid_ceo", message: "No valid CEO agent was provided." });
        send("done", { ok: false });
        return;
      }

      // Shared tooling — one memory/knowledge/skill/todo surface for the whole organization.
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

      const ceoSession = this.store.getOrCreate(request.chatId, request.ceo.id);
      const ceoKey = request.ceo.name.trim().toLowerCase();
      const ceoCtx = ceoSession.contexts.get(ceoKey);
      const isFirstMessage = !ceoCtx || !ceoCtx.messages.some((m) => m.role === "user");

      const firstMessageContext = isFirstMessage
        ? [memory.firstMessageContext().trim(), knowledge.firstMessageContext().trim()]
            .filter((b) => b.length > 0)
            .join("\n\n")
        : "";

      // Mirror the user message into the chat session transcript for persistence + the sidebar title.
      session.messages.push({ role: "user", content: request.userMessage });

      // Connected app connectors (Composio): shared by the CEO, every leader, every
      // member, and their sub-agents. Inert when unconfigured.
      const connectors = await ConnectorRuntime.create({
        apiKey: request.composioApiKey ?? "",
        connections: request.connectors ?? [],
      });

      // Connected MCP servers for this turn (shared by the CEO, every
      // leader, every member, and their sub-agents). Inert when unconfigured.
      const mcp = this.mcpManager
        ? await McpRuntime.create({
            manager: this.mcpManager,
            serverIds: request.mcpServers?.map((s) => s.id),
            signal,
          })
        : null;

      const orchestrator = new CeoOrchestrator({
        provider,
        tools: this.tools,
        config: this.config,
        ceo: request.ceo,
        sendMessageToTeamEnabled: request.sendMessageToTeamEnabled,
        contexts: ceoSession.contexts,
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
      send("error", { code: "ceo_crashed", message: messageOf(error) });
      send("done", { ok: false });
    } finally {
      buffer.setDone();
      session.running = false;
      session.updatedAt = Date.now();
    }
  }

  /**
   * Raw context for one CEO-system agent (CEO/leader/member) in a chat: its
   * persistent conversation + the system prompt it last ran with. Returns null
   * when unknown. Powers the context popup's CEO section (runned agents only).
   */
  agentContext(
    chatId: string,
    agentId: string,
  ): { systemPrompt: string; messages: import("../../../services/sessionStore.js").StoredMessage[]; role: string } | null {
    try {
      const session = this.store.get(chatId);
      if (!session) return null;
      const ctx = session.contexts.get(agentId.trim().toLowerCase());
      if (!ctx) return null;
      return {
        systemPrompt: ctx.systemPrompt,
        messages: ctx.messages.map((m) => ({ ...m })),
        role: ctx.role,
      };
    } catch {
      return null;
    }
  }

  /** Agent ids with a persisted CEO-system context in a chat (for raw-view discovery). */
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
