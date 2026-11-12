import { useCallback, useEffect, useRef } from "react";
import { abortChat } from "@/lib/api";
import { runChatStream, type StreamPhase, type StreamResult } from "@/lib/chatStream";
import { DEFAULT_PROFILE_ID } from "@/lib/userProfiles";
import { loadConversationIfNeeded } from "@/lib/statePersistence";
import { isContextLimitRequired, isMainAgentActive, resolveContextLimit } from "@/lib/contextMeter";
import { StreamBatcher } from "@/lib/streamBatcher";
import { dispatchStreamEvent } from "@/lib/streamDispatch";
import { attachLatestMemoryAgentRun } from "@/lib/memoryAgent";
import { CUSTOM_PROVIDER_PREFIX, toCustomProviderConfig } from "@/lib/providers";
import { activeTeam } from "@/lib/defaultTeams";
import { activeCeo, toBackendCeo } from "@/lib/defaultCeo";
import { findActiveCustomAgent, toBackendCustomAgent } from "@/lib/customAgents";
import { findActiveMainAgentPrompt } from "@/lib/mainAgentPrompts";
import { visiblePromptText } from "@/lib/promptVisibility";
import { taskModePromptFor } from "@/lib/taskModes";
import { useStore, type ActiveRun } from "@/store/useStore";
import { uid } from "@/utils/id";
import type {
  BackendConnector,
  BackendMessage,
  BackendRole,
  BackendSkill,
  BackendSubAgent,
  BackendWorkflow,
  ChatMessage,
  ComboChain,
  CustomProvider,
  SSEEventData,
  Settings,
  TurnInterruption,
  KnowledgeFile,
  MemoryFile,
  StreamRequest,
  TodoItem,
} from "@/types";

/** Prompt sent when the user continues an interrupted turn. */
export const CONTINUE_PROMPT =
  "Continue the task from where you left off. You were interrupted before finishing — pick up from the last completed step and don't repeat work that is already done.";

/**
 * Classify how a turn ended. Anything short of a clean `done { ok: true }` is an
 * interruption: an explicit Stop is the user's, everything else is the system's.
 */
function interruptionOf(result: StreamResult, done: SSEEventData | null): TurnInterruption["reason"] | null {
  if (result === "aborted") return "user";
  if (result === "gone" || result === "error") return "system";
  if (!done || done.ok === true) return null;
  return done.aborted === true || done.interrupted_by === "user" ? "user" : "system";
}

function phaseToConnection(phase: StreamPhase): void {
  const setConnection = useStore.getState().setConnection;
  if (phase === "offline") setConnection("offline");
  else if (phase === "reconnecting") setConnection("reconnecting");
  else setConnection(navigator.onLine === false ? "offline" : "online");
}

/**
 * Resolve the active provider combo into the wire payload. Entries with no model
 * are dropped; the first entry is the primary (already reflected in
 * settings.provider/model on activation). Returns undefined when no usable combo
 * is active, so the backend falls back to the fallback policy instead.
 */
function buildComboPayload(
  settings: Settings,
  customProviders: CustomProvider[],
): ComboChain | undefined {
  const comboState = settings.combo;
  if (!comboState?.enabled || !comboState.activeComboId) return undefined;
  const combo = comboState.combos.find((c) => c.id === comboState.activeComboId);
  if (!combo) return undefined;
  const entries = combo.entries
    .filter((entry) => entry.model.trim().length > 0)
    .map((entry) => {
      const custom = customProviders.find((p) => p.id === entry.provider);
      const apiKey = entry.apiKey.trim()
        ? entry.apiKey
        : custom
          ? custom.apiKey
          : (settings.apiKeys[entry.provider] ?? "");
      return {
        id: entry.id,
        provider: entry.provider,
        model: entry.model,
        apiKey,
        baseUrl: entry.baseUrl || undefined,
        customProvider: custom ? toCustomProviderConfig(custom, entry.model) : entry.customProvider,
      };
    });
  if (entries.length < 2) return undefined;
  return { enabled: true, comboId: combo.id, name: combo.name, entries };
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

  const workflows: BackendWorkflow[] = store.workflows.map((wf) => ({
    id: wf.id,
    name: wf.name,
    description: wf.description,
    workflow_file: wf.workflowFile.trim() || "workflow.md",
    content: wf.content,
    enabled: wf.enabled,
  }));

  const roles: BackendRole[] = store.roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    role_file: r.roleFile.trim() || "role.md",
    content: r.content,
    enabled: r.enabled,
  }));

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
    workflows: isChatMode ? [] : workflows,
    roles: isChatMode ? [] : roles,
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
    retry: settings.retry,
    // API-key fallbacks are scoped to the active provider; provider fallbacks are global.
    fallback: settings.fallback
      ? {
          ...settings.fallback,
          apis: settings.fallback.apis.filter((t) => !t.provider || t.provider === settings.provider),
        }
      : undefined,
    // Active provider combo (when set) replaces the fallback policy on the backend.
    combo: buildComboPayload(settings, customProviders),
  };
}

export function useChatStream(onFilesChanged?: () => void) {
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  // Queue plumbing: refs let the queue drain call back into the latest `sendTo`
  // without making `drive`/`drainQueue` depend on each other's identity.
  const sendToRef = useRef<(convId: string, text: string) => Promise<void>>(async () => {});
  const drainRef = useRef<((preferredConvId?: string) => void) | null>(null);
  const drainingRef = useRef(false);

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
      let doneData: SSEEventData | null = null;
      try {
        result = await runChatStream({
          chatId: convId,
          start,
          initialSinceId: -1,
          signal: controller.signal,
          onEvent: (event, data) => {
            if (event === "done") doneData = data;
            dispatchStreamEvent(event, data, { convId, msgId: assistantId, batcher, onFilesChanged, resume: resumeFlag });
          },
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

        const reason = interruptionOf(result, doneData);
        store.updateMessage(convId, assistantId, {
          streaming: false,
          interrupted: reason ? { reason, at: Date.now() } : undefined,
        });
        // Drop a still-waiting retry block (e.g. the turn was aborted mid-backoff);
        // a recovered retry is kept as a compact history line.
        store.clearRetry(convId, assistantId);
        store.setStreaming(false);
        store.setActiveRun(null);
        store.setConnection(navigator.onLine === false ? "offline" : "online");
        onFilesChanged?.();

        // The finished turn enqueued a background memory-build run on the backend. The
        // `memory_agent_queued` SSE event normally attaches the watcher already; this is
        // the fallback that also refreshes the sessions list (idempotent per run).
        void attachLatestMemoryAgentRun();

        // Auto-send the next queued prompt for this session once the turn ends. Only a
        // clean completion ("done") or a run the backend already finished ("gone")
        // drains; an explicit Stop ("aborted") pauses the queue and a hard connect
        // error ("error") waits for the user. This runs off the stream lifecycle, not
        // the UI, so queued prompts keep flowing in the background.
        if (result === "done" || result === "gone") void drainRef.current?.(convId);
      }
    },
    [onFilesChanged],
  );

  /**
   * Send the next queued prompt (for `preferredConvId` first, else any queue in the
   * active profile). Runs one turn at a time; each finished turn re-invokes this so
   * multiple prompts drain one after another with no user interaction. A no-op while
   * a turn is already running. Never sends another profile's queued prompts.
   */
  const drainQueue = useCallback((preferredConvId?: string) => {
    if (runningRef.current || drainingRef.current) return;
    const store = useStore.getState();
    const active = store.activeUserProfileId ?? DEFAULT_PROFILE_ID;
    const drainable = (convId: string): boolean => {
      const list = store.promptQueues[convId];
      if (!list || list.length === 0) return false;
      const conv = store.conversations.find((c) => c.id === convId);
      if (!conv) return false;
      return (conv.profileId ?? DEFAULT_PROFILE_ID) === active;
    };
    const candidate =
      (preferredConvId && drainable(preferredConvId) ? preferredConvId : null) ??
      Object.keys(store.promptQueues).find(drainable) ??
      null;
    if (!candidate) return;

    drainingRef.current = true;
    void (async () => {
      try {
        // A queued prompt restored from the database may target a not-yet-loaded
        // stub; pull its history first so the turn's context is complete.
        try {
          await loadConversationIfNeeded(candidate);
        } catch {
          // best effort — send with whatever is in memory
        }
        const text = useStore.getState().dequeuePrompt(candidate);
        if (text) await sendToRef.current(candidate, text);
      } finally {
        drainingRef.current = false;
        // Continue with the remaining queue (the finished turn triggers the next pass).
        drainRef.current?.(candidate);
      }
    })();
  }, []);

  /**
   * Start a fresh turn in a specific conversation (used by both the composer's
   * `send` and the queued-prompt drain, so a queue can target a session even
   * when it is not the one on screen).
   */
  const sendTo = useCallback(
    async (convId: string, text: string) => {
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

      const conv = useStore.getState().conversations.find((c) => c.id === convId);
      if (!conv) return;

      const start = buildStartRequest(convId, trimmed);

      const userMsg: ChatMessage = {
        id: uid("msg"),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };
      store.addMessage(convId, userMsg);

      if (conv.messages.length === 0) {
        const title = visiblePromptText(trimmed);
        store.renameConversation(convId, title.slice(0, 48) + (title.length > 48 ? "..." : ""));
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

  // Keep the refs current so the drain/drive callbacks always reach the latest logic.
  useEffect(() => {
    sendToRef.current = sendTo;
    drainRef.current = drainQueue;
  }, [sendTo, drainQueue]);

  /** Send a prompt into the current conversation (the composer's Send action). */
  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || runningRef.current) return;
      const convId = useStore.getState().ensureConversation();
      await sendTo(convId, text);
    },
    [sendTo],
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

  /** Resume an interrupted task by asking the agent to carry on in the same conversation. */
  const continueTask = useCallback(
    async (convId: string) => {
      if (runningRef.current) return;
      const store = useStore.getState();
      if (store.currentId !== convId) store.selectConversation(convId);
      await send(CONTINUE_PROMPT);
    },
    [send],
  );

  return { send, resume, stop, continueTask, drainQueue, isRunning: () => runningRef.current };
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
