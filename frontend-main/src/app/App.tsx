import { useEffect, useRef } from "react";
import { Rail } from "@/components/Rail";
import { TopBar } from "@/components/TopBar";
import { Composer } from "@/components/Composer";
import { NetworkBanner } from "@/components/NetworkBanner";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { MemoryPanel } from "@/components/panels/MemoryPanel";
import { KnowledgePanel } from "@/components/panels/KnowledgePanel";
import { AgentsPanel } from "@/components/panels/AgentsPanel";
import { SkillsPanel } from "@/components/panels/SkillsPanel";
import { TeamsPanel } from "@/components/panels/TeamsPanel";
import { CeoPanel } from "@/components/panels/CeoPanel";
import { CustomAgentsPanel } from "@/components/panels/CustomAgentsPanel";
import { MainAgentPromptsPanel } from "@/components/panels/MainAgentPromptsPanel";
import { TaskModesPanel } from "@/components/panels/TaskModesPanel";
import { PromptLibraryPanel } from "@/components/panels/PromptLibraryPanel";
import { PromptAgentPanel } from "@/components/panels/PromptAgentPanel";
import { SchedulesPanel } from "@/components/panels/SchedulesPanel";
import { ConnectorsPanel } from "@/components/panels/ConnectorsPanel";
import { McpPanel } from "@/components/panels/McpPanel";
import { ChannelsPanel } from "@/components/panels/ChannelsPanel";
import { TtsPanel } from "@/components/panels/TtsPanel";
import { ProfilesPanel } from "@/components/panels/ProfilesPanel";
import { SettingsModal } from "@/components/editors/SettingsModal";
import { FilesPanel } from "@/components/overlays/FilesPanel";
import { PreviewPanel } from "@/components/overlays/PreviewPanel";
import { MemoryAgentPanel } from "@/components/overlays/MemoryAgentPanel";
import { MemoryAgentSessionsPanel } from "@/components/overlays/MemoryAgentSessionsPanel";
import { SummaryHandoffPanel } from "@/components/chat/SummaryHandoffPanel";
import { TeamMonitorPanel } from "@/components/overlays/TeamMonitorPanel";
import { GlobalSearchPanel } from "@/components/overlays/GlobalSearchPanel";
import { useStore } from "@/store/useStore";
import { useChatStream, useConnectionWatch } from "@/hooks/useChatStream";
import { fetchProviders } from "@/lib/api";
import { exchangeMcpOAuthCode, fetchMcpServers } from "@/lib/mcp";
import { fetchWorkspace } from "@/lib/workspace";
import { attachLatestMemoryAgentRun } from "@/lib/memoryAgent";
import {
  bootstrapFromBackend,
  loadConversationIfNeeded,
  startStatePersistence,
} from "@/lib/statePersistence";

export function App() {
  const section = useStore((s) => s.section);
  const currentId = useStore((s) => s.currentId);
  const hydrated = useStore((s) => s.hydrated);
  const setProviders = useStore((s) => s.setProviders);
  const { send, resume, stop } = useChatStream();
  const bootedRef = useRef(false);

  useConnectionWatch();

  // Boot: hydrate the runtime store from the backend SQLite database, start the
  // change-sync bridge, then re-attach to any run the backend is still executing —
  // a page refresh loses nothing and reconnects to the live stream immediately.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    fetchProviders().then(setProviders).catch(() => {});
    fetchWorkspace()
      .then((workspace) => useStore.getState().setWorkspacePath(workspace))
      .catch(() => {});

    void (async () => {
      // OAuth landings: the backend redirects here after a backend-mode MCP
      // flow (?mcp_connected=<id> or ?mcp_error=<message>), and the provider
      // redirects here directly after a frontend-mode MCP flow
      // (?mcp_oauth=1&code=…&state=mcp_…). Refresh the list and land on the
      // MCP page so the user sees the result.
      try {
        const params = new URLSearchParams(window.location.search);
        const connected = params.get("mcp_connected");
        const oauthError = params.get("mcp_error");
        const oauthCode = params.get("code");
        const oauthState = params.get("state");
        const isFrontendReturn =
          (params.get("mcp_oauth") !== null || params.get("mcp") !== null) &&
          Boolean(oauthCode) &&
          (oauthState ?? "").startsWith("mcp_");
        if (connected || oauthError || isFrontendReturn) {
          window.history.replaceState({}, "", window.location.pathname);
          if (isFrontendReturn && oauthCode && oauthState) {
            // Frontend redirect mode: complete the code exchange with the backend.
            try {
              const server = await exchangeMcpOAuthCode(oauthCode, oauthState);
              useStore.getState().upsertMcpServer(server);
            } catch (e) {
              // The server row records the failure; still land on the MCP page.
              void e;
            }
          }
          fetchMcpServers()
            .then((servers) => useStore.getState().setMcpServers(servers))
            .catch(() => {});
          useStore.getState().setSection("mcp");
        }
      } catch {
        // ignore malformed URLs
      }

      const payload = await bootstrapFromBackend();
      startStatePersistence();

      const store = useStore.getState();
      const activeId = store.currentId;
      if (activeId) await loadConversationIfNeeded(activeId);
      useStore.getState().ensureConversation();

      // Load the memory-agent sessions overview and re-attach to any run the backend
      // queue is still executing (the agent keeps running regardless of the browser).
      void attachLatestMemoryAgentRun();

      // Re-attach to a still-running stream (survives refresh/close/reconnect) —
      // but only when that run belongs to the active profile. Profiles are strictly
      // isolated: another profile's running turn must never surface here.
      const running = payload.sessions.find((s) => s.running);
      if (running) {
        const peer = useStore.getState();
        const owner = peer.conversations.find((c) => c.id === running.id);
        if (owner && (owner.profileId ?? null) === (peer.activeUserProfileId ?? null)) {
          await loadConversationIfNeeded(running.id);
          void resume({
            chatId: running.id,
            assistantId: "", // rebuilt by resume(): a fresh placeholder receives the replay
            lastEventId: -1,
            startedAt: Date.now(),
          });
        }
      }
    })();
  }, [resume, setProviders]);

  // Lazily pull a conversation's stored snapshot from the database when it is opened.
  useEffect(() => {
    if (!hydrated || !currentId) return;
    void loadConversationIfNeeded(currentId);
  }, [hydrated, currentId]);

  // Global search shortcut: Cmd/Ctrl+K toggles the search-everything popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const next = !useStore.getState().searchOpen;
        useStore.getState().setSearchOpen(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--bg)] text-[var(--fg)]">
      <Rail />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />

        <main className="relative flex min-h-0 flex-1 flex-col">
          {section === "chat" && <ChatPanel onSend={send} />}
          {section !== "chat" && (
            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6 max-[640px]:px-4">
              {section === "memory" && <MemoryPanel />}
              {section === "knowledge" && <KnowledgePanel />}
              {section === "agents" && <AgentsPanel />}
              {section === "skills" && <SkillsPanel />}
              {section === "teams" && <TeamsPanel />}
              {section === "ceo" && <CeoPanel />}
              {section === "customagents" && <CustomAgentsPanel />}
              {section === "systemprompts" && <MainAgentPromptsPanel />}
              {section === "taskmodes" && <TaskModesPanel />}
              {section === "prompts" && <PromptLibraryPanel />}
              {section === "promptagent" && <PromptAgentPanel />}
              {section === "schedules" && <SchedulesPanel />}
              {section === "connectors" && <ConnectorsPanel />}
              {section === "mcp" && <McpPanel />}
              {section === "channels" && <ChannelsPanel />}
              {section === "tts" && <TtsPanel />}
              {section === "profiles" && <ProfilesPanel />}
            </div>
          )}
        </main>

        {section !== "promptagent" && <Composer onSend={send} onStop={stop} />}
      </div>

      <NetworkBanner />
      <SettingsModal />
      <GlobalSearchPanel />
      <FilesPanel />
      <PreviewPanel />
      <MemoryAgentPanel />
      <MemoryAgentSessionsPanel />
      <SummaryHandoffPanel />
      <TeamMonitorPanel />
    </div>
  );
}
