import { useCallback, useEffect, useRef } from "react";
import { abortChat } from "@/lib/api";
import { runChatStream, type StreamPhase, type StreamResult } from "@/lib/chatStream";
import { isContextLimitRequired, isMainAgentActive, resolveContextLimit } from "@/lib/contextMeter";
import { StreamBatcher } from "@/lib/streamBatcher";
import { dispatchStreamEvent } from "@/lib/streamDispatch";
import { attachLatestMemoryAgentRun } from "@/lib/memoryAgent";
import { CUSTOM_PROVIDER_PREFIX, toCustomProviderConfig } from "@/lib/providers";
import { activeTeam } from "@/lib/defaultTeams";
import { activeCeo, toBackendCeo } from "@/lib/defaultCeo";
import { findActiveCustomAgent, toBackendCustomAgent } from "@/lib/customAgents";
import { findActiveMainAgentPrompt } from "@/lib/mainAgentPrompts";
import { taskModePromptFor } from "@/lib/taskModes";
import { useStore, type ActiveRun } from "@/store/useStore";
import { uid } from "@/utils/id";
import type {
  BackendConnector,
  BackendMessage,
  BackendSkill,
  BackendSubAgent,
  ChatMessage,
  KnowledgeFile,
  MemoryFile,
  StreamRequest,
  TodoItem,
} from "@/types";

function phaseToConnection(phase: StreamPhase): void {
  const setConnection = useStore.getState().setConnection;
  if (phase === "offline") setConnection("offline");
  else if (phase === "reconnecting") setConnection("reconnecting");
  else setConnection(navigator.onLine === false ? "offline" : "online");
}

/** Build the wire payload for a turn from the current store state. */
function buildStartRequest(convId: string, text: string): StreamRequest {
  const store = useStore.getState();
  const { settings, customProviders } = store;
  const isCustom = settings.provider.startsWith(CUSTOM_PROVIDER_PREFIX);
  const customProvider = customProviders.find((p) => p.id === settings.provider);
  const apiKey = isCustom
    ? (customProvider?.apiKey ?? "")
    : (settings.apiKeys[settings.provider] ?? "");

  const conv = store.conversations.find((c) => c.id === convId);
  const history: BackendMessage[] = (conv?.messages ?? [])
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));

  const subAgents: BackendSubAgent[] = store.subAgents.map((a) => ({
    name: a.name,
    description: a.description,
    system_prompt: a.systemPrompt,
    tools: a.tools,
    enabled: a.enabled,
  }));

  const skills: BackendSkill[] = store.skills.map((sk) => {
    const entryName = sk.skillFile.trim() || "SKILL.md";
    const files = [
      { path: entryName, content: sk.skillContent },
      ...sk.files
        .filter((f) => f.path.trim().length > 0)
        .map((f) => ({ path: f.path.trim(), content: f.content })),
    ];
    return {
      name: sk.name,
      description: sk.description,
      skill_file: entryName,
      files,
      enabled: sk.enabled,
    };
  });

  const todos: TodoItem[] = store.todos;
  const memory: MemoryFile[] = store.memory;
  const knowledge: KnowledgeFile[] = store.knowledge;

  // Top-level conversation mode. Chat mode is a lightweight conversational assistant with
  // only memory + knowledge + web tools. Task modes are agent-only and never apply here.
  const isChatMode = store.agentMode === "chat";

  // Connected app connectors (Composio): only ACTIVE connections travel. The backend
  // loads each toolkit's full tool catalog natively for the turn — main, custom,
  // sub-agents, teams, and CEO agents all receive them.
  const connectors: BackendConnector[] = store.connectors
    .filter((c) => c.status === "active" && c.connectedAccountId.trim().length > 0)
    .map((c) => ({ connector_id: c.connectorId, connected_account_id: c.connectedAccountId }));

  // Connected MCP servers: only ENABLED ones travel (ids only — secrets
  // stay server-side). The backend loads each server's full tool catalog
  // natively for the turn — main, custom, sub-agents, teams, and CEO agents.
  const mcpServers = store.mcpServers
    .filter((m) => m.enabled)
    .map((m) => ({ id: m.id }));

  // Task mode: plan / custom modes append their prompt to the user's message so the
  // model approaches the task accordingly. Agent-only: never applied in chat mode.
  const taskModePrompt = isChatMode
    ? null
    : taskModePromptFor(
        store.activeTaskModeId,
        store.taskModes,
        store.planModePrompt,
      );
  const userMessageWithMode =
    taskModePrompt && taskModePrompt.trim().length > 0
      ? `${text}\n\n${taskModePrompt}`
      : text;

  // Custom Agent mode: when a top-level Custom Agent is the active agent, this turn runs as that
  // independent Main Agent (its own system prompt + selected tools). Disabled in chat mode —
  // a chat turn never routes to teams, CEOs, or custom agents.
  const customAgent = isChatMode
    ? null
    : findActiveCustomAgent(store.customAgents, store.activeCustomAgentId);
  const backendCustomAgent = customAgent ? toBackendCustomAgent(customAgent) : undefined;

  // Custom System Prompt for the built-in Main Agent: agent-only, never sent in chat mode.
  const activeMainPrompt = isChatMode
    ? null
    : findActiveMainAgentPrompt(store.mainAgentPrompts, store.activeMainAgentPromptId);
  const systemPromptOverride =
    !backendCustomAgent && activeMainPrompt && activeMainPrompt.content.trim().length > 0
      ? activeMainPrompt.content
      : undefined;

  // CEO multi-agent mode: agent-only, disabled in chat mode. Disabled while a Custom
  // Agent is active; takes precedence over ordinary team mode.
  const ceoEnabled = !isChatMode && settings.enableCeoAgents === "yes" && !backendCustomAgent;
  const ceo = ceoEnabled ? activeCeo(store.ceoAgents) : null;
  const backendCeo = ceo ? toBackendCeo(ceo, store.agentTeams) : null;

  // Multi-agent team mode: agent-only, disabled in chat mode. Disabled while a Custom
  // Agent or an active CEO is running.
  const teamsEnabled = !isChatMode && settings.enableAgentTeams === "yes" && !backendCustomAgent && !backendCeo;
  const team = teamsEnabled ? activeTeam(store.agentTeams) : null;
  const backendTeam = team
    ? {
        id: team.id,
        name: team.name,
        leader_name: team.leaderName,
        leader_system_prompt: team.leaderSystemPrompt,
        members: team.members
          .filter((m) => m.name.trim().length > 0)
          .map((m) => ({
            name: m.name.trim(),
            description: m.description,
            system_prompt: m.systemPrompt,
          })),
      }
    : undefined;

  return {
    chat_id: convId,
    user_message: userMessageWithMode,
    history,
    provider: settings.provider,
    model: settings.model,
    api_key: apiKey,
    base_url: settings.baseUrl || undefined,
    custom_provider:
      isCustom && customProvider ? toCustomProviderConfig(customProvider, settings.model) : undefined,
    temperature: typeof settings.temperature === "number" ? settings.temperature : undefined,
    effort: settings.effort?.trim() || undefined,
    tavily_api_key: settings.tavilyApiKey || undefined,
    exa_api_key: settings.exaApiKey || undefined,
    serpapi_api_key: settings.serpapiApiKey || undefined,
    search_provider: settings.searchProvider,
    fetch_provider: settings.fetchProvider,
    firecrawl_api_key: settings.firecrawlApiKey || undefined,
    chat_mode: isChatMode,
    agent_mode: isChatMode ? "chat" : "agent",
    sub_agents: isChatMode ? [] : subAgents,
    skills: isChatMode ? [] : skills,
    todos: isChatMode ? [] : todos,
    memory,
    knowledge,
    composio_api_key: settings.composioApiKey?.trim() || undefined,
    connectors: isChatMode ? [] : connectors,
    mcp_servers: isChatMode ? [] : mcpServers,
    enable_reuse_sub_agent_session: settings.enableReuseSubAgentSession === "yes" ? "yes" : "no",
    memory_agent_enabled: settings.memoryAgentEnabled !== "no",
    memory_agent_interval:
      typeof settings.memoryAgentInterval === "number" && Number.isFinite(settings.memoryAgentInterval)
        ? Math.min(50, Math.max(1, Math.floor(settings.memoryAgentInterval)))
        : 3,
    multi_agent: Boolean(backendTeam),
    agent_team: backendTeam,
    enable_send_message_to_team: settings.enableSendMessageToTeam === "yes" ? "yes" : "no",
    ceo_mode: Boolean(backendCeo),
    ceo_agent: backendCeo ?? undefined,
    custom_agent: backendCustomAgent,
    system_prompt_override: systemPromptOverride,
    // Effective context-window limit for automatic context management
    // (summarization at 90% or sliding window at 99%):
    // provider catalog wins, else manual entry. Absent = backend management disabled.
    context_limit:
      resolveContextLimit(
        store.models,
        settings.provider,
        settings.model,
        settings.manualContextLimits,
      ).limit ?? undefined,
    context_management_method: settings.contextManagementMethod ?? "summarization",
    sliding_window_truncate_percent: settings.slidingWindowTruncatePercent ?? 0.3,
  };
}

export function useChatStream(onFilesChanged?: () => void) {
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  const drive = useCallback(
    async (params: {
      convId: string;
      assistantId: string;
      start?: StreamRequest;
      resume: boolean;
    }) => {
      const { convId, assistantId, start, resume } = params;
      const controller = new AbortController();
      abortRef.current = controller;
      runningRef.current = true;

      const batcher = new StreamBatcher(convId, assistantId);
      const resumeFlag = { pending: resume };

      useStore.getState().setStreaming(true);
      useStore.getState().setConnection(navigator.onLine === false ? "offline" : "online");

      let result: StreamResult = "aborted";
      try {
        result = await runChatStream({
          chatId: convId,
          start,
          initialSinceId: -1,
          signal: controller.signal,
          onEvent: (event, data) =>
            dispatchStreamEvent(event, data, { convId, msgId: assistantId, batcher, onFilesChanged, resume: resumeFlag }),
          onPhase: phaseToConnection,
          onCursor: (id) => useStore.getState().setActiveRunCursor(id),
        });
      } catch {
        result = "aborted";
      } finally {
        batcher.dispose();
        runningRef.current = false;
        abortRef.current = null;

        const store = useStore.getState();
        // "gone": the backend no longer has this run. If nothing was produced, leave a marker.
        if (result === "gone") {
          const conv = store.conversations.find((c) => c.id === convId);
          const msg = conv?.messages.find((m) => m.id === assistantId);
          if (msg && msg.content.trim().length === 0 && (msg.tools?.length ?? 0) === 0) {
            store.applyAssistantDelta(convId, assistantId, {
              contentDelta: "⚠️ This run is no longer available on the server.",
            });
          }
        }

        store.updateMessage(convId, assistantId, { streaming: false });
        store.setStreaming(false);
        store.setActiveRun(null);
        store.setConnection(navigator.onLine === false ? "offline" : "online");
        onFilesChanged?.();

        // The finished turn enqueued a background memory-build run on the backend. The
        // `memory_agent_queued` SSE event normally attaches the watcher already; this is
        // the fallback that also refreshes the sessions list (idempotent per run).
        void attachLatestMemoryAgentRun();
      }
    },
    [onFilesChanged],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || runningRef.current) return;

      const store = useStore.getState();
      // Main-agent context-limit gate: without an effective limit (provider
      // catalog or the manual entry in Settings) the meter cannot show a
      // percentage, so new turns stay blocked. Open Settings so the manual
      // entry — shown next to the model picker — explains what to do.
      // Other agents never mount the meter and are unaffected.
      if (
        isMainAgentActive({
          agentMode: store.agentMode,
          activeCustomAgentId: store.activeCustomAgentId,
          customAgents: store.customAgents,
          settings: store.settings,
          ceoAgents: store.ceoAgents,
          agentTeams: store.agentTeams,
        }) &&
        isContextLimitRequired({
          models: store.models,
          modelsLoading: store.modelsLoading,
          provider: store.settings.provider,
          model: store.settings.model,
          manualLimits: store.settings.manualContextLimits,
        })
      ) {
        store.setSettingsOpen(true);
        return;
      }

      const convId = store.ensureConversation();
      const conv = useStore.getState().conversations.find((c) => c.id === convId)!;

      const start = buildStartRequest(convId, trimmed);

      const userMsg: ChatMessage = {
        id: uid("msg"),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };
      store.addMessage(convId, userMsg);

      if (conv.messages.length === 0) {
        store.renameConversation(convId, trimmed.slice(0, 48) + (trimmed.length > 48 ? "…" : ""));
      }

      const assistantId = uid("msg");
      store.addMessage(convId, {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
        tools: [],
        createdAt: Date.now(),
      });

      const run: ActiveRun = { chatId: convId, assistantId, lastEventId: -1, startedAt: Date.now() };
      store.setActiveRun(run);

      await drive({ convId, assistantId, start, resume: false });
    },
    [drive],
  );

  /**
   * Re-attach to a run the backend is still executing (after a refresh/reconnect).
   * The stream replays from event 0, so the assistant message is rebuilt in full —
   * after a refresh a fresh placeholder message is created to receive the replay.
   */
  const resume = useCallback(
    async (run: ActiveRun) => {
      if (runningRef.current) return;
      const store = useStore.getState();
      const conv = store.conversations.find((c) => c.id === run.chatId);
      if (!conv) {
        store.setActiveRun(null);
        return;
      }
      let assistantId = run.assistantId;
      const msg = conv.messages.find((m) => m.id === assistantId);
      if (!msg) {
        // Post-refresh: runtime state was rebuilt from the database snapshot. If the
        // snapshot already contains the in-flight (partial) assistant message, REUSE it
        // — the replay resets and refills it in place, so nothing is duplicated. Only
        // create a fresh placeholder when the thread doesn't end with an assistant.
        const last = conv.messages[conv.messages.length - 1];
        if (last && last.role === "assistant") {
          assistantId = last.id;
          store.updateMessage(run.chatId, assistantId, { streaming: true });
        } else {
          assistantId = uid("msg");
          store.addMessage(run.chatId, {
            id: assistantId,
            role: "assistant",
            content: "",
            streaming: true,
            tools: [],
            createdAt: Date.now(),
          });
        }
        store.setActiveRun({ ...run, assistantId });
      }
      await drive({ convId: run.chatId, assistantId, resume: true });
    },
    [drive],
  );

  const stop = useCallback(async () => {
    const store = useStore.getState();
    const run = store.activeRun;
    // Explicit user cancellation — this is the ONLY thing that stops the backend agent.
    abortRef.current?.abort();
    if (run?.chatId) await abortChat(run.chatId);
    store.setActiveRun(null);
    store.setStreaming(false);
  }, []);

  return { send, resume, stop, isRunning: () => runningRef.current };
}

/** Keep the global connection indicator honest even when no stream is active. */
export function useConnectionWatch(): void {
  const setConnection = useStore((s) => s.setConnection);
  const streaming = useStore((s) => s.streaming);
  useEffect(() => {
    const update = () => {
      if (useStore.getState().streaming) return; // the stream owns the status while running
      setConnection(navigator.onLine === false ? "offline" : "online");
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [setConnection, streaming]);
}
