import { useState } from "react";
import { Plus, Settings, Paperclip, Brain, History, Boxes, Crown, MoreVertical, GitBranch, Copy, Pencil, MessageCircle, Search, RefreshCcw } from "lucide-react";
import { useStore, type Section } from "@/store/useStore";
import { DEFAULT_PROFILE_ID } from "@/lib/userProfiles";
import { ContextMeter } from "@/components/chat/ContextMeter";
import { cn } from "@/utils/cn";
import { newSessionId } from "@/utils/id";
import { forkSessionData, renameSessionData, saveSessionSnapshot } from "@/lib/backendState";
import { loadConversationIfNeeded } from "@/lib/statePersistence";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, TextInput } from "@/components/ui/primitives";

function contextLabel(section: Section, counts: Record<string, number>): string | null {
  switch (section) {
    case "memory":
      return "Across threads";
    case "knowledge":
      return `${counts.knowledge} source${counts.knowledge === 1 ? "" : "s"}`;
    case "agents":
      return `${counts.agents} agent${counts.agents === 1 ? "" : "s"}`;
    case "skills":
      return `${counts.skills} skill${counts.skills === 1 ? "" : "s"}`;
    case "teams":
      return `${counts.teams} team${counts.teams === 1 ? "" : "s"}`;
    case "ceo":
      return `${counts.ceo} CEO${counts.ceo === 1 ? "" : "s"}`;
    case "customagents":
      return `${counts.customagents} agent${counts.customagents === 1 ? "" : "s"}`;
    case "systemprompts":
      return `${counts.systemprompts} prompt${counts.systemprompts === 1 ? "" : "s"}`;
    case "taskmodes":
      return `${counts.taskmodes} mode${counts.taskmodes === 1 ? "" : "s"}`;
    case "prompts":
      return `${counts.prompts} prompt${counts.prompts === 1 ? "" : "s"}`;
    case "promptagent":
      return "Prompt studio";
    case "schedules":
      return `${counts.schedules} schedule${counts.schedules === 1 ? "" : "s"}`;
    case "connectors":
      return `${counts.connectors} app${counts.connectors === 1 ? "" : "s"}`;
    case "mcp":
      return `${counts.mcp} server${counts.mcp === 1 ? "" : "s"}`;
    case "channels":
      return `${counts.channels} channel${counts.channels === 1 ? "" : "s"}`;
    case "tts":
      return "Speech studio";
    case "acp":
      return "External clients";
    case "profiles":
      return `${counts.profiles} profile${counts.profiles === 1 ? "" : "s"}`;
    default:
      return null;
  }
}

export function TopBar() {
  const section = useStore((s) => s.section);
  const newConversation = useStore((s) => s.newConversation);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setFilesOpen = useStore((s) => s.setFilesOpen);
  const setMemoryAgentOpen = useStore((s) => s.setMemoryAgentOpen);
  const setMemoryAgentSessionsOpen = useStore((s) => s.setMemoryAgentSessionsOpen);
  const setSummaryHandoffOpen = useStore((s) => s.setSummaryHandoffOpen);
  const memoryAgentCounts = useStore((s) => s.memoryAgentCounts);
  const knowledge = useStore((s) => s.knowledge);
  const subAgents = useStore((s) => s.subAgents);
  const skills = useStore((s) => s.skills);
  const attachedFiles = useStore((s) => s.attachedFiles);
  const agentTeams = useStore((s) => s.agentTeams);
  const ceoAgents = useStore((s) => s.ceoAgents);
  const settings = useStore((s) => s.settings);
  const customAgents = useStore((s) => s.customAgents);
  const activeCustomAgentId = useStore((s) => s.activeCustomAgentId);
  const mainAgentPrompts = useStore((s) => s.mainAgentPrompts);
  const taskModes = useStore((s) => s.taskModes);
  const promptLibrary = useStore((s) => s.promptLibrary);
  const schedules = useStore((s) => s.schedules);
  const connectors = useStore((s) => s.connectors);
  const mcpServers = useStore((s) => s.mcpServers);
  const channelConnections = useStore((s) => s.channelConnections);
  const userProfiles = useStore((s) => s.userProfiles);
  const setSection = useStore((s) => s.setSection);
  const agentMode = useStore((s) => s.agentMode);
  const isChatMode = agentMode === "chat";

  const label = contextLabel(section, {
    knowledge: knowledge.length,
    agents: subAgents.length,
    skills: skills.length,
    teams: agentTeams.length,
    ceo: ceoAgents.length,
    customagents: customAgents.length,
    systemprompts: mainAgentPrompts.length,
    taskmodes: taskModes.length,
    prompts: promptLibrary.length,
    schedules: schedules.length,
    connectors: connectors.filter((c) => c.status === "active").length,
    mcp: mcpServers.filter((m) => m.status === "connected").length,
    channels: channelConnections.length,
    profiles: userProfiles.length,
  });
  const isChat = section === "chat";
  // Context meter visibility: every chat mode (main, custom, chat, team, CEO) gets a
  // meter — the popup scopes itself to the active agent and lists every runned
  // sub/team/CEO agent with its own tokens + raw view. Subagent views (nested tool
  // blocks) never reach this header.
  const showContextMeter = isChat;
  const activeAgent = customAgents.find((a) => a.id === activeCustomAgentId) ?? null;
  // The active CEO (only when the CEO feature is on and no Custom Agent overrides it) — the first
  // message of a chat goes to this CEO agent.
  const activeCeoAgent =
    settings.enableCeoAgents === "yes" && !activeAgent
      ? (ceoAgents.find((c) => c.enabled) ?? null)
      : null;
  const currentId = useStore((s) => s.currentId);
  const conversations = useStore((s) => s.conversations);
  const currentConv = conversations.find((c) => c.id === currentId) ?? null;
  const isBranch = Boolean(currentConv?.parentId);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between px-6 max-[640px]:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <p className="m-0 text-sm font-medium">Haku</p>
        {isBranch && (
          <span
            title="This thread is a fresh branch — no past context is sent for any agent."
            className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--chip)] px-2.5 py-1 text-xs font-medium text-[var(--muted)]"
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-[var(--secondary)]" />
            <span className="truncate max-w-[10rem]">Branch</span>
          </span>
        )}
        {/* Which top-level agent chat turns run as (only shown when a Custom Agent is active). */}
        {!isChatMode && activeAgent && (
          <button
            type="button"
            onClick={() => setSection("customagents")}
            title={`Chatting with your custom agent "${activeAgent.name}". Click to manage agents.`}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--chip)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--chip-hover)] hover:text-[var(--fg)]"
          >
            <Boxes className="h-3.5 w-3.5 shrink-0 text-[var(--secondary)]" />
            <span className="truncate max-w-[10rem]">{activeAgent.name}</span>
          </button>
        )}
        {/* Which CEO the chat runs under (only shown when a CEO is active and no Custom Agent). */}
        {!isChatMode && activeCeoAgent && (
          <button
            type="button"
            onClick={() => setSection("ceo")}
            title={`Chatting with your CEO agent "${activeCeoAgent.name}". Click to manage CEO agents.`}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--chip)] px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--chip-hover)] hover:text-[var(--fg)]"
          >
            <Crown className="h-3.5 w-3.5 shrink-0 text-[var(--secondary)]" />
            <span className="truncate max-w-[10rem]">{activeCeoAgent.name}</span>
          </button>
        )}
        {/* Chat-mode indicator (chat turns use only memory + knowledge + web tools). */}
        {isChatMode && (
          <span
            title="Chat mode — memory, knowledge, and web only. Switch back to Agent in the sidebar for full tools."
            className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-[var(--chip)] px-2.5 py-1 text-xs font-medium text-[var(--muted)]"
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0 text-[var(--secondary)]" />
            <span className="truncate max-w-[10rem]">Chat</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        {isChat ? (
          <button
            type="button"
            onClick={() => newConversation()}
            title="New thread"
            aria-label="New thread"
            className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[var(--chip)] pl-4 pr-2 text-xs font-medium tracking-[0.02em] text-[var(--muted)] transition-colors hover:bg-[var(--chip-hover)] hover:text-[var(--fg)] active:scale-[0.98]"
          >
            New thread
            <span className="grid h-7 w-7 place-items-center rounded-full text-[var(--muted)]">
              <Plus className="h-4 w-4" strokeWidth={1.9} />
            </span>
          </button>
        ) : (
          label && (
            <span className="inline-flex items-center rounded-full bg-[var(--chip)] px-3 py-1 text-xs font-medium tracking-[0.02em] text-[var(--muted)]">
              {label}
            </span>
          )
        )}

        <TopIcon title="Search everything (Ctrl+K)" onClick={() => useStore.getState().setSearchOpen(true)}>
          <Search className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </TopIcon>
        {showContextMeter && <ContextMeter />}
        {showContextMeter && (
          <TopIcon title="Context summary" onClick={() => setSummaryHandoffOpen(true)}>
            <RefreshCcw className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </TopIcon>
        )}
        <TopIcon
          title="Memory agent"
          onClick={() => setMemoryAgentOpen(true)}
          count={memoryAgentCounts.running + memoryAgentCounts.queued}
        >
          <Brain className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </TopIcon>
        <TopIcon title="Memory agent sessions" onClick={() => setMemoryAgentSessionsOpen(true)}>
          <History className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </TopIcon>
        <TopIcon title="Attached files" onClick={() => setFilesOpen(true)} count={attachedFiles.length}>
          <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </TopIcon>
        <TopIcon title="Settings" onClick={() => setSettingsOpen(true)}>
          <Settings className="h-5 w-5" strokeWidth={1.7} />
        </TopIcon>
        <BranchMenu />
      </div>
    </header>
  );
}

function TopIcon({
  title,
  onClick,
  count,
  children,
}: {
  title: string;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "relative grid h-11 w-11 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]",
      )}
    >
      {children}
      {count != null && count > 0 && (
        <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--secondary)] px-1 text-[10px] font-semibold tabular-nums text-[var(--secondary-fg)]">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * Conversation options menu (top-right "..."): branch, fork (full copy), rename,
 * and switch between a thread and its branches/forks. A branch is a brand-new
 * backend session — no past context is sent for it, so every agent starts clean.
 * A fork is a full 100% copy of the chat (every message, tool run, team run)
 * plus the backend transcript/snapshot, grouped under its parent. Settings and
 * all global things are shared by design, so the fork automatically inherits them.
 */
function BranchMenu() {
  const [open, setOpen] = useState(false);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const currentId = useStore((s) => s.currentId);
  const conversations = useStore((s) => s.conversations);
  const selectConversation = useStore((s) => s.selectConversation);
  const branchConversation = useStore((s) => s.branchConversation);

  const current = conversations.find((c) => c.id === currentId) ?? null;
  const parentId = current?.parentId ?? null;
  const profileId = current?.profileId ?? null;
  // Family = the parent (when inside a branch/fork) plus all of its branches/forks —
  // scoped to the current profile so other profiles' chats never leak in.
  const inProfile = (c: { profileId?: string | null }) =>
    (c.profileId ?? DEFAULT_PROFILE_ID) === (profileId ?? DEFAULT_PROFILE_ID);
  const family = parentId
    ? conversations.filter((c) => inProfile(c) && (c.id === parentId || c.parentId === parentId))
    : conversations.filter((c) => inProfile(c) && c.parentId === currentId);
  const branchCount = conversations.filter(
    (c) => inProfile(c) && c.parentId === currentId,
  ).length;

  const forkCurrent = async () => {
    if (!currentId || forking) return;
    setForking(true);
    setForkError(null);
    try {
      await loadConversationIfNeeded(currentId);
      const source = useStore.getState().conversations.find((c) => c.id === currentId);
      if (!source || source.loaded === false) {
        setForkError("Load the chat first, then fork it.");
        return;
      }
      const newId = newSessionId();
      const forkTitle = `${source.title} (fork)`.slice(0, 200);
      // Copy the server-side transcript/snapshot/events (best-effort: a fresh
      // local-only chat has no server row yet and is still forked locally).
      await forkSessionData(source.id, newId, forkTitle);
      const forkedId = useStore.getState().forkConversation(source.id, newId);
      if (!forkedId) {
        setForkError("Could not fork this chat.");
        return;
      }
      const forked = useStore.getState().conversations.find((c) => c.id === forkedId);
      if (forked) await saveSessionSnapshot(forked);
      setOpen(false);
    } finally {
      setForking(false);
    }
  };

  const openRename = () => {
    if (!current) return;
    setRenameValue(current.title);
    setRenameError(null);
    setRenameOpen(true);
  };

  const saveRename = async () => {
    if (!current) return;
    const title = renameValue.trim();
    if (!title) {
      setRenameError("A chat name is required.");
      return;
    }
    if (title.length > 200) {
      setRenameError("Keep the name to 200 characters or fewer.");
      return;
    }
    useStore.getState().renameConversation(current.id, title);
    await renameSessionData(current.id, title);
    setRenameOpen(false);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Conversation options"
        aria-label="Conversation options"
        className={cn(
          "relative grid h-11 w-11 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]",
        )}
      >
        <MoreVertical className="h-5 w-5" strokeWidth={1.7} />
        {branchCount > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--secondary)] px-1 text-[10px] font-semibold tabular-nums text-[var(--secondary-fg)]">
            {branchCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] py-1 pop-in"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            <button
              type="button"
              onClick={() => {
                branchConversation();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-[var(--secondary)] hover:bg-[var(--chip)]"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--secondary)] text-[var(--secondary-fg)]">
                <Plus className="h-4 w-4" strokeWidth={2} />
              </span>
              New branch — start fresh here
            </button>
            <button
              type="button"
              onClick={() => void forkCurrent()}
              disabled={!current || forking}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-[var(--fg)] hover:bg-[var(--chip)] disabled:opacity-50"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--chip)] text-[var(--muted)]">
                <Copy className="h-4 w-4" strokeWidth={1.8} />
              </span>
              {forking ? "Forking chat…" : "Fork chat — full copy here"}
            </button>
            <button
              type="button"
              onClick={openRename}
              disabled={!current}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-[var(--fg)] hover:bg-[var(--chip)] disabled:opacity-50"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--chip)] text-[var(--muted)]">
                <Pencil className="h-4 w-4" strokeWidth={1.8} />
              </span>
              Rename chat
            </button>
            {forkError && <p className="m-0 px-3 py-1 text-[11px] text-[var(--danger)]">{forkError}</p>}

            {current?.parentId && (
              <p className="m-0 px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-[var(--subtle)]">
                Branched from {conversations.find((c) => c.id === current.parentId)?.title ?? "parent"}
              </p>
            )}

            {family.length > 0 && (
              <>
                <div className="my-1 border-t border-[var(--border)]" />
                <p className="m-0 px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-[var(--subtle)]">
                  Branches
                </p>
                {family.slice(0, 8).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      selectConversation(c.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--chip)]"
                  >
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--fg)]">
                      {c.title}
                      {c.id === currentId ? " (current)" : ""}
                    </span>
                  </button>
                ))}
              </>
            )}

            <p className="m-0 px-3 py-2 text-[10px] leading-relaxed text-[var(--subtle)]">
              A branch starts from fresh with no past context for any agent. A fork copies this chat
              fully and continues from the copy.
            </p>
          </div>
        </>
      )}

      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename chat"
        size="sm"
        footer={<Button onClick={() => void saveRename()}>Save</Button>}
      >
        <div className="space-y-3 p-5">
          <Field label="Chat name" hint={`${renameValue.trim().length}/200`}>
            <TextInput
              value={renameValue}
              maxLength={200}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="e.g. Landing page plan"
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveRename();
              }}
            />
          </Field>
          {renameError && <p className="m-0 text-xs text-[var(--danger)]">{renameError}</p>}
        </div>
      </Modal>
    </div>
  );
}
