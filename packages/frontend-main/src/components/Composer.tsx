import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Paperclip, ArrowUp, Square, FolderOpen, X, Loader2, ChevronDown, ListChecks, Plus, Layers, Check, Brain, Bot, KeyRound, ArrowUpRight } from "lucide-react";
import { PromptLibraryIcon, RoleIcon, WorkflowIcon, SkillsIcon, ConnectorsIcon, McpIcon, KnowledgeIcon } from "@/components/icons/NavIcons";
import { useStore } from "@/store/useStore";
import { isCustomProviderId, isLocalProviderId } from "@/lib/providers";
import { isContextLimitRequired, isMainAgentActive } from "@/lib/contextMeter";
import { fetchWorkspace, mkdirWorkspace, setWorkspace } from "@/lib/workspace";
import { buildAttachmentPrompt, uploadFiles, type UploadedFile } from "@/lib/uploads";
import { buildAttachedWorkflowPrompt } from "@/lib/workflows";
import { buildAttachedRolePrompt } from "@/lib/roles";
import {
  buildAttachedConnectorsPrompt,
  buildAttachedKnowledgePrompt,
  buildAttachedMcpPrompt,
  buildAttachedMemoryPrompt,
  buildAttachedSkillsPrompt,
  buildAttachedSubAgentsPrompt,
  type AttachedConnector,
} from "@/lib/composerAttachments";
import { fetchConnectorsOverview, validateComposioKey } from "@/lib/connectors";
import { saveStateKey } from "@/lib/backendState";
import { visiblePromptText, withAttachedContext } from "@/lib/promptVisibility";
import { PLAN_TASK_MODE_ID, DEFAULT_TASK_MODE_ID } from "@/lib/taskModes";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, TextArea, TextInput } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";
import type { ConnectorOverviewItem } from "@/types";

/** The sections the composer's "/" picker can show. */
type SlashStage =
  | "menu"
  | "prompts"
  | "workflows"
  | "roles"
  | "skills"
  | "connectors"
  | "subagents"
  | "mcp"
  | "knowledge"
  | "memory";

/** One selectable row in a "/" picker list stage (prompt library, attachments, ...). */
interface SlashListItem {
  key: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  /** Render the title in a monospace font (used for file paths). */
  mono?: boolean;
  selected?: boolean;
  onSelect: () => void;
}

/** Class shared by every list-row icon in the "/" picker. */
const SLASH_ICON_CLASS = "mt-0.5 h-4 w-4 shrink-0 text-[var(--subtle)]";

/** Human-readable size of a knowledge/memory file's content. */
function charCount(content: string): string {
  return `${content.length.toLocaleString()} characters`;
}

/** Toggle one id in an attachment list (multiple selection, toggling removes). */
function toggleId(
  setter: (updater: (prev: string[]) => string[]) => void,
  id: string,
): void {
  setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
}

export function Composer({ onSend, onStop }: { onSend: (text: string) => void; onStop: () => void }) {
  const [value, setValue] = useState("");
  // Multi-session: "streaming" is scoped to the conversation on screen, so a running
  // session elsewhere never turns Send into Queue here.
  const streaming = useStore((s) => (s.currentId ? Boolean(s.streamingChats[s.currentId]) : false));
  const settings = useStore((s) => s.settings);
  const customProviders = useStore((s) => s.customProviders);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setSection = useStore((s) => s.setSection);
  const agentMode = useStore((s) => s.agentMode);
  const workspacePath = useStore((s) => s.workspacePath);
  const setWorkspacePath = useStore((s) => s.setWorkspacePath);
  const promptLibrary = useStore((s) => s.promptLibrary);
  const workflows = useStore((s) => s.workflows);
  const roles = useStore((s) => s.roles);
  const skills = useStore((s) => s.skills);
  const subAgents = useStore((s) => s.subAgents);
  const mcpServers = useStore((s) => s.mcpServers);
  const knowledge = useStore((s) => s.knowledge);
  const memory = useStore((s) => s.memory);
  const composerPrefill = useStore((s) => s.composerPrefill);
  const setComposerPrefill = useStore((s) => s.setComposerPrefill);
  const models = useStore((s) => s.models);
  const modelsLoading = useStore((s) => s.modelsLoading);
  const activeCustomAgentId = useStore((s) => s.activeCustomAgentId);
  const customAgents = useStore((s) => s.customAgents);
  const ceoAgents = useStore((s) => s.ceoAgents);
  const agentTeams = useStore((s) => s.agentTeams);
  const currentId = useStore((s) => s.currentId);
  const promptQueues = useStore((s) => s.promptQueues);
  const queuePrompt = useStore((s) => s.queuePrompt);
  const removeQueuedPrompt = useStore((s) => s.removeQueuedPrompt);
  const clearPromptQueue = useStore((s) => s.clearPromptQueue);
  const currentQueue = currentId ? (promptQueues[currentId] ?? []) : [];
  // "/" shortcut stages: "menu" shows the section options; the other stages show a pickable list
  // (saved prompts, or a capability — workflow/role/skill/connector/sub-agent/MCP/knowledge/memory
  // — that can be attached to this prompt).
  const [slashStage, setSlashStage] = useState<SlashStage>("menu");
  const [attachedWorkflows, setAttachedWorkflows] = useState<string[]>([]);
  const [attachedRoles, setAttachedRoles] = useState<string[]>([]);
  const [attachedSkills, setAttachedSkills] = useState<string[]>([]);
  const [attachedSubAgents, setAttachedSubAgents] = useState<string[]>([]);
  const [attachedMcp, setAttachedMcp] = useState<string[]>([]);
  const [attachedKnowledge, setAttachedKnowledge] = useState<string[]>([]);
  const [attachedMemory, setAttachedMemory] = useState<string[]>([]);
  const [attachedConnectors, setAttachedConnectors] = useState<AttachedConnector[]>([]);
  // Live connector catalog for the "/" connectors stage (connected apps only).
  const [connectorItems, setConnectorItems] = useState<ConnectorOverviewItem[]>([]);
  const [connectorConfigured, setConnectorConfigured] = useState(true);
  const [connectorLoading, setConnectorLoading] = useState(false);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [composioKeyOpen, setComposioKeyOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Insert prompt-library "Use" content into the composer (set by the panel or
  // the "/" picker). Consumed during render (same pattern as WorkspaceModal
  // below) so no sync effect is needed. Appends below existing text.
  const [prevPrefill, setPrevPrefill] = useState<string | null>(null);
  if (composerPrefill !== prevPrefill) {
    setPrevPrefill(composerPrefill);
    if (composerPrefill) {
      setValue((prev) =>
        prev.trim().length > 0 ? `${prev}\n\n${composerPrefill}` : composerPrefill,
      );
      setComposerPrefill(null);
      // Focus after paint so the user can edit before sending.
      requestAnimationFrame(() => document.getElementById("composer")?.focus());
    }
  }

  // The "/" shortcut is active while the composer starts with "/". The text after the slash filters
  // whichever list stage is open.
  const slashActive = !streaming && value.startsWith("/");
  const slashFilter = slashActive ? value.slice(1).trim().toLowerCase() : "";
  const slashMatches = (text: string) =>
    slashFilter.length === 0 || text.toLowerCase().includes(slashFilter);

  const enabledWorkflows = workflows.filter((wf) => wf.enabled);
  const enabledRoles = roles.filter((r) => r.enabled);
  const enabledSkills = skills.filter((sk) => sk.enabled);
  const enabledSubAgents = subAgents.filter((a) => a.enabled);
  const enabledMcp = mcpServers.filter((m) => m.enabled && m.status === "connected");

  const attachedWorkflowItems = workflows.filter((wf) => attachedWorkflows.includes(wf.id));
  const attachedRoleItems = roles.filter((r) => attachedRoles.includes(r.id));
  const attachedSkillItems = skills.filter((sk) => attachedSkills.includes(sk.id));
  const attachedSubAgentItems = subAgents.filter((a) => attachedSubAgents.includes(a.id));
  const attachedMcpItems = mcpServers.filter((m) => attachedMcp.includes(m.id));
  const attachedKnowledgeItems = knowledge.filter((f) => attachedKnowledge.includes(f.path));
  const attachedMemoryItems = memory.filter((f) => attachedMemory.includes(f.path));

  const hasAttachments =
    attachedWorkflowItems.length > 0 ||
    attachedRoleItems.length > 0 ||
    attachedSkillItems.length > 0 ||
    attachedSubAgentItems.length > 0 ||
    attachedMcpItems.length > 0 ||
    attachedKnowledgeItems.length > 0 ||
    attachedMemoryItems.length > 0 ||
    attachedConnectors.length > 0;

  const autoGrow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    // Leaving the "/" shortcut resets its stages (handled here in the change
    // handler so no sync effect is needed).
    if (!next.startsWith("/")) setSlashStage("menu");
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  useEffect(() => {
    if (workspacePath) return;
    fetchWorkspace()
      .then((workspace) => setWorkspacePath(workspace))
      .catch(() => {});
  }, [workspacePath, setWorkspacePath]);

  /** Load the live connector catalog (connected apps only) for the "/" connectors stage. */
  const loadConnectors = useCallback(async () => {
    setConnectorLoading(true);
    setConnectorError(null);
    try {
      const overview = await fetchConnectorsOverview();
      setConnectorConfigured(overview.configured);
      setConnectorItems(overview.connectors.filter((c) => c.status === "active"));
    } catch (e) {
      setConnectorError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnectorLoading(false);
    }
  }, []);

  /** Open the connectors stage and refresh the connected-app catalog. */
  const openConnectorsStage = () => {
    setSlashStage("connectors");
    void loadConnectors();
  };

  const isCustom = isCustomProviderId(settings.provider);
  const customProvider = customProviders.find((p) => p.id === settings.provider);
  const ready = isCustom
    ? Boolean(customProvider && settings.model)
    : isLocalProviderId(settings.provider)
      ? Boolean(settings.model)
      : Boolean(settings.apiKeys[settings.provider] && settings.model);

  // Main-agent context-limit requirement (mirrors the manual entry in Settings):
  // a model is selected but no limit is known, so new turns stay blocked until a
  // manual limit is saved. Other agents never mount the meter and are unaffected.
  const limitRequired =
    isMainAgentActive({
      agentMode,
      activeCustomAgentId,
      customAgents,
      settings,
      ceoAgents,
      agentTeams,
    }) &&
    isContextLimitRequired({
      models,
      modelsLoading,
      provider: settings.provider,
      model: settings.model,
      manualLimits: settings.manualContextLimits,
    });

  /** Clear every staged attachment after the draft is sent (or queued). */
  const clearAttachments = () => {
    setAttachments([]);
    setAttachedWorkflows([]);
    setAttachedRoles([]);
    setAttachedSkills([]);
    setAttachedSubAgents([]);
    setAttachedMcp([]);
    setAttachedKnowledge([]);
    setAttachedMemory([]);
    setAttachedConnectors([]);
  };

  /** Assemble every prompt fragment attached to the current draft (files plus workflows, roles,
   * skills, connectors, sub-agents, MCP servers, knowledge and memory). The file notice stays
   * visible; every capability fragment is placed behind a marker so it reaches the LLM but is
   * hidden from the user in the chat UI. */
  const buildNotices = () => {
    const visible = buildAttachmentPrompt(attachments);
    const hidden = [
      buildAttachedWorkflowPrompt(attachedWorkflowItems),
      buildAttachedRolePrompt(attachedRoleItems),
      buildAttachedSkillsPrompt(attachedSkillItems),
      buildAttachedConnectorsPrompt(attachedConnectors),
      buildAttachedSubAgentsPrompt(attachedSubAgentItems),
      buildAttachedMcpPrompt(attachedMcpItems),
      buildAttachedKnowledgePrompt(attachedKnowledgeItems),
      buildAttachedMemoryPrompt(attachedMemoryItems),
    ]
      .filter((part) => part.trim().length > 0)
      .join("\n\n");
    return withAttachedContext(visible, hidden);
  };

  /** Stage the current draft for automatic sending after the running turn ends. */
  const addToQueue = () => {
    const text = value.trim();
    if (!text || !currentId || uploading) return;
    const notice = buildNotices();
    queuePrompt(currentId, notice ? `${text}\n\n${notice}` : text);
    setValue("");
    setSlashStage("menu");
    clearAttachments();
    setUploadError(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const submit = () => {
    const text = value.trim();
    if (!text || uploading) return;
    // While a turn is running, extra prompts are queued and sent automatically once
    // the current task finishes (no need to wait or interact again).
    if (streaming) {
      addToQueue();
      return;
    }
    if (!ready) {
      setSettingsOpen(true);
      return;
    }
    if (limitRequired) {
      // Keep the draft: open Settings so the manual entry explains what to do.
      setSettingsOpen(true);
      return;
    }
    setSection("chat");
    const notice = buildNotices();
    onSend(notice ? `${text}\n\n${notice}` : text);
    setValue("");
    setSlashStage("menu");
    clearAttachments();
    setUploadError(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const pickFiles = () => {
    if (streaming || uploading) return;
    fileInputRef.current?.click();
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded = await uploadFiles(list);
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && slashActive) {
      e.preventDefault();
      if (slashStage !== "menu") setSlashStage("menu");
      else {
        setValue("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const insertLibraryPrompt = (content: string) => {
    setValue(content);
    setSlashStage("menu");
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
      el.focus();
    });
  };

  /** Close the "/" picker and refocus the composer after attaching (multiple allowed). */
  const finishAttach = () => {
    setValue("");
    setSlashStage("menu");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  /** Toggle a connected app from the "/" connectors stage. */
  const toggleConnector = (item: ConnectorOverviewItem) => {
    const entry: AttachedConnector = {
      id: item.id,
      name: item.name,
      accountLabel: item.account_label,
    };
    setAttachedConnectors((prev) =>
      prev.some((c) => c.id === entry.id)
        ? prev.filter((c) => c.id !== entry.id)
        : [...prev, entry],
    );
    finishAttach();
  };

  /** Open the Connectors page from the "/" connectors stage. */
  const openConnectorsPage = () => {
    setValue("");
    setSlashStage("menu");
    setSection("connectors");
  };

  /** Header title for the currently open "/" list stage. */
  const slashStageTitle: Record<SlashStage, string> = {
    menu: "",
    prompts: "Saved prompts",
    skills: "Attach skill",
    subagents: "Attach sub-agent",
    mcp: "Attach MCP server",
    connectors: "Attach connector",
    knowledge: "Attach knowledge",
    memory: "Attach memory",
    workflows: "Attach workflow",
    roles: "Attach role",
  };

  /** The selectable rows for the active "/" list stage (filtered by the text after "/"). */
  const slashListItems: SlashListItem[] = (() => {
    switch (slashStage) {
      case "prompts":
        return promptLibrary
          .filter((item) => slashMatches(`${item.title} ${item.description}`))
          .slice(0, 20)
          .map((item) => ({
            key: item.id,
            icon: <PromptLibraryIcon className={SLASH_ICON_CLASS} />,
            title: item.title,
            subtitle: item.description || "No description.",
            onSelect: () => insertLibraryPrompt(item.content),
          }));
      case "workflows":
        return enabledWorkflows
          .filter((wf) => slashMatches(`${wf.name} ${wf.description}`))
          .slice(0, 20)
          .map((wf) => ({
            key: wf.id,
            icon: <WorkflowIcon className={SLASH_ICON_CLASS} />,
            title: wf.name,
            subtitle: wf.description || "No description.",
            selected: attachedWorkflows.includes(wf.id),
            onSelect: () => {
              toggleId(setAttachedWorkflows, wf.id);
              finishAttach();
            },
          }));
      case "roles":
        return enabledRoles
          .filter((r) => slashMatches(`${r.name} ${r.description}`))
          .slice(0, 20)
          .map((r) => ({
            key: r.id,
            icon: <RoleIcon className={SLASH_ICON_CLASS} />,
            title: r.name,
            subtitle: r.description || "No description.",
            selected: attachedRoles.includes(r.id),
            onSelect: () => {
              toggleId(setAttachedRoles, r.id);
              finishAttach();
            },
          }));
      case "skills":
        return enabledSkills
          .filter((sk) => slashMatches(`${sk.name} ${sk.description}`))
          .slice(0, 20)
          .map((sk) => ({
            key: sk.id,
            icon: <SkillsIcon className={SLASH_ICON_CLASS} />,
            title: sk.name,
            subtitle: sk.description || "No description.",
            selected: attachedSkills.includes(sk.id),
            onSelect: () => {
              toggleId(setAttachedSkills, sk.id);
              finishAttach();
            },
          }));
      case "subagents":
        return enabledSubAgents
          .filter((a) => slashMatches(`${a.name} ${a.description}`))
          .slice(0, 20)
          .map((a) => ({
            key: a.id,
            icon: <Bot className={SLASH_ICON_CLASS} />,
            title: a.name,
            subtitle: a.description || "No description.",
            selected: attachedSubAgents.includes(a.id),
            onSelect: () => {
              toggleId(setAttachedSubAgents, a.id);
              finishAttach();
            },
          }));
      case "mcp":
        return enabledMcp
          .filter((m) => slashMatches(`${m.name} ${m.description}`))
          .slice(0, 20)
          .map((m) => ({
            key: m.id,
            icon: <McpIcon className={SLASH_ICON_CLASS} />,
            title: m.name,
            subtitle: m.description || "Connected MCP server.",
            selected: attachedMcp.includes(m.id),
            onSelect: () => {
              toggleId(setAttachedMcp, m.id);
              finishAttach();
            },
          }));
      case "knowledge":
        return knowledge
          .filter((f) => slashMatches(f.path))
          .slice(0, 20)
          .map((f) => ({
            key: f.path,
            icon: <KnowledgeIcon className={SLASH_ICON_CLASS} />,
            title: f.path,
            subtitle: charCount(f.content),
            mono: true,
            selected: attachedKnowledge.includes(f.path),
            onSelect: () => {
              toggleId(setAttachedKnowledge, f.path);
              finishAttach();
            },
          }));
      case "memory":
        return memory
          .filter((f) => slashMatches(f.path))
          .slice(0, 20)
          .map((f) => ({
            key: f.path,
            icon: <Brain className={SLASH_ICON_CLASS} />,
            title: f.path,
            subtitle: charCount(f.content),
            mono: true,
            selected: attachedMemory.includes(f.path),
            onSelect: () => {
              toggleId(setAttachedMemory, f.path);
              finishAttach();
            },
          }));
      default:
        return [];
    }
  })();

  /** Empty-state message for the active "/" list stage. */
  const slashEmptyMessage = (() => {
    switch (slashStage) {
      case "prompts":
        return promptLibrary.length === 0
          ? "No saved prompts yet. Save one from the Prompt library page or the bookmark button on any chat prompt."
          : `No saved prompts match “${value.slice(1).trim()}”.`;
      case "workflows":
        return enabledWorkflows.length === 0
          ? "No workflows yet. Create one from the Workflows page."
          : `No workflows match “${value.slice(1).trim()}”.`;
      case "roles":
        return enabledRoles.length === 0
          ? "No roles yet. Create one from the Roles page."
          : `No roles match “${value.slice(1).trim()}”.`;
      case "skills":
        return enabledSkills.length === 0
          ? "No skills yet. Create one from the Skills page."
          : `No skills match “${value.slice(1).trim()}”.`;
      case "subagents":
        return enabledSubAgents.length === 0
          ? "No sub-agents yet. Create one from the Sub-agents page."
          : `No sub-agents match “${value.slice(1).trim()}”.`;
      case "mcp":
        return enabledMcp.length === 0
          ? "No connected MCP servers yet. Connect one from the MCP servers page."
          : `No MCP servers match “${value.slice(1).trim()}”.`;
      case "knowledge":
        return knowledge.length === 0
          ? "No knowledge files yet. Add one from the Knowledge base page."
          : `No knowledge files match “${value.slice(1).trim()}”.`;
      case "memory":
        return memory.length === 0
          ? "No memory files yet."
          : `No memory files match “${value.slice(1).trim()}”.`;
      default:
        return "";
    }
  })();

  return (
    <div className="relative shrink-0 px-6 pb-5 pt-2 max-[640px]:px-3 max-[640px]:pb-3">
      <div
        className="pointer-events-none absolute inset-x-0 bottom-full h-10"
        style={{ background: "linear-gradient(to top, var(--bg), transparent)" }}
      />

      <div className="mx-auto w-full max-w-3xl">
        {!ready && (
          <button
            onClick={() => setSettingsOpen(true)}
            className="mb-2 w-full rounded-[var(--radius-md)] border px-3 py-2 text-xs transition-colors"
            style={{
              borderColor: "color-mix(in oklab, var(--warning) 32%, transparent)",
              background: "var(--warning-soft)",
              color: "var(--warning)",
            }}
          >
            Add your API key and pick a model in Settings to start chatting.
          </button>
        )}
        {ready && limitRequired && (
          <button
            onClick={() => setSettingsOpen(true)}
            className="mb-2 w-full rounded-[var(--radius-md)] border px-3 py-2 text-xs transition-colors"
            style={{
              borderColor: "color-mix(in oklab, var(--warning) 32%, transparent)",
              background: "var(--warning-soft)",
              color: "var(--warning)",
            }}
          >
            Enter the context limit for “{settings.model}” in Settings to start
            chatting.
          </button>
        )}

        <div
          className="relative rounded-[var(--radius-2xl)] bg-[var(--bg)] p-4 transition-shadow focus-within:[box-shadow:var(--shadow-card-focus)] max-[640px]:p-3"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          {slashActive && (
            <div
              className="absolute bottom-full left-0 z-50 mb-2 max-h-[70vh] w-72 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] py-1 pop-in"
              style={{ boxShadow: "var(--shadow-pop)" }}
              role="listbox"
              aria-label="Composer shortcuts"
            >
              {slashStage === "menu" ? (
                <>
                  <SlashMenuOption
                    icon={<PromptLibraryIcon className="h-5 w-5" />}
                    title="Prompt library"
                    hint={
                      promptLibrary.length === 0
                        ? "No saved prompts yet"
                        : `${promptLibrary.length} saved prompt${promptLibrary.length === 1 ? "" : "s"}`
                    }
                    onClick={() => setSlashStage("prompts")}
                  />
                  <SlashMenuOption
                    icon={<SkillsIcon className="h-5 w-5" />}
                    title="Attach skill"
                    hint={
                      enabledSkills.length === 0
                        ? "No skills yet"
                        : `${enabledSkills.length} skill${enabledSkills.length === 1 ? "" : "s"}`
                    }
                    onClick={() => setSlashStage("skills")}
                  />
                  <SlashMenuOption
                    icon={<Bot className="h-5 w-5" />}
                    title="Attach sub-agent"
                    hint={
                      enabledSubAgents.length === 0
                        ? "No sub-agents yet"
                        : `${enabledSubAgents.length} sub-agent${enabledSubAgents.length === 1 ? "" : "s"}`
                    }
                    onClick={() => setSlashStage("subagents")}
                  />
                  <SlashMenuOption
                    icon={<McpIcon className="h-5 w-5" />}
                    title="Attach MCP server"
                    hint={
                      enabledMcp.length === 0
                        ? "No connected servers"
                        : `${enabledMcp.length} connected server${enabledMcp.length === 1 ? "" : "s"}`
                    }
                    onClick={() => setSlashStage("mcp")}
                  />
                  <SlashMenuOption
                    icon={<ConnectorsIcon className="h-5 w-5" />}
                    title="Attach connector"
                    hint="Connected apps only"
                    onClick={openConnectorsStage}
                  />
                  <SlashMenuOption
                    icon={<KnowledgeIcon className="h-5 w-5" />}
                    title="Attach knowledge"
                    hint={
                      knowledge.length === 0
                        ? "No knowledge files yet"
                        : `${knowledge.length} knowledge file${knowledge.length === 1 ? "" : "s"}`
                    }
                    onClick={() => setSlashStage("knowledge")}
                  />
                  <SlashMenuOption
                    icon={<Brain className="h-5 w-5" />}
                    title="Attach memory"
                    hint={
                      memory.length === 0
                        ? "No memory files yet"
                        : `${memory.length} memory file${memory.length === 1 ? "" : "s"}`
                    }
                    onClick={() => setSlashStage("memory")}
                  />
                  <SlashMenuOption
                    icon={<WorkflowIcon className="h-5 w-5" />}
                    title="Attach workflow"
                    hint={
                      enabledWorkflows.length === 0
                        ? "No workflows yet"
                        : `${enabledWorkflows.length} workflow${enabledWorkflows.length === 1 ? "" : "s"}`
                    }
                    onClick={() => setSlashStage("workflows")}
                  />
                  <SlashMenuOption
                    icon={<RoleIcon className="h-5 w-5" />}
                    title="Attach role"
                    hint={
                      enabledRoles.length === 0
                        ? "No roles yet"
                        : `${enabledRoles.length} role${enabledRoles.length === 1 ? "" : "s"}`
                    }
                    onClick={() => setSlashStage("roles")}
                  />
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between px-3 pb-1 pt-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
                      {slashStageTitle[slashStage]}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSlashStage("menu")}
                      className="text-[10px] font-medium text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      Back
                    </button>
                  </div>
                  {slashStage === "connectors" ? (
                    <ConnectorStage
                      configured={connectorConfigured}
                      loading={connectorLoading}
                      error={connectorError}
                      items={connectorItems}
                      attachedIds={attachedConnectors.map((c) => c.id)}
                      onAddKey={() => setComposioKeyOpen(true)}
                      onOpenPage={openConnectorsPage}
                      onToggle={toggleConnector}
                      matches={slashMatches}
                      query={value.slice(1).trim()}
                    />
                  ) : slashListItems.length === 0 ? (
                    <p className="m-0 px-3 py-2 text-xs text-[var(--muted)]">
                      {slashEmptyMessage}
                    </p>
                  ) : (
                    <SlashList items={slashListItems} />
                  )}
                </>
              )}
            </div>
          )}
          <label htmlFor="composer" className="sr-only">
            Message
          </label>
          <textarea
            id="composer"
            ref={textareaRef}
            value={value}
            onChange={autoGrow}
            onKeyDown={onKeyDown}
            rows={3}
            placeholder="Ask Mythgram AI anything"
            className="block max-h-[200px] min-h-[4.5rem] w-full resize-none border-0 bg-transparent text-base leading-relaxed text-[var(--fg)] outline-none placeholder:text-[var(--subtle)]"
          />

          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {attachments.map((f) => (
                <span
                  key={f.path}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--chip)] px-2.5 py-1 text-xs text-[var(--fg)]"
                  title={f.path}
                >
                  <Paperclip className="h-3 w-3 shrink-0 text-[var(--muted)]" />
                  <span className="max-w-[10rem] truncate font-mono">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== f.path))}
                    className="text-[var(--subtle)] hover:text-[var(--danger)]"
                    title="Remove attachment"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {hasAttachments && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {attachedSkillItems.map((sk) => (
                <AttachmentChip
                  key={`skill-${sk.id}`}
                  icon={<SkillsIcon className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
                  label={sk.name}
                  title={`Skill: ${sk.name}`}
                  removeLabel={`Remove skill ${sk.name}`}
                  onRemove={() => toggleId(setAttachedSkills, sk.id)}
                />
              ))}
              {attachedConnectors.map((c) => (
                <AttachmentChip
                  key={`connector-${c.id}`}
                  icon={<ConnectorsIcon className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
                  label={c.name || c.id}
                  title={`Connector: ${c.name || c.id}`}
                  removeLabel={`Remove connector ${c.name || c.id}`}
                  onRemove={() =>
                    setAttachedConnectors((prev) => prev.filter((x) => x.id !== c.id))
                  }
                />
              ))}
              {attachedSubAgentItems.map((a) => (
                <AttachmentChip
                  key={`subagent-${a.id}`}
                  icon={<Bot className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
                  label={a.name}
                  title={`Sub-agent: ${a.name}`}
                  removeLabel={`Remove sub-agent ${a.name}`}
                  onRemove={() => toggleId(setAttachedSubAgents, a.id)}
                />
              ))}
              {attachedMcpItems.map((m) => (
                <AttachmentChip
                  key={`mcp-${m.id}`}
                  icon={<McpIcon className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
                  label={m.name}
                  title={`MCP server: ${m.name}`}
                  removeLabel={`Remove MCP server ${m.name}`}
                  onRemove={() => toggleId(setAttachedMcp, m.id)}
                />
              ))}
              {attachedKnowledgeItems.map((f) => (
                <AttachmentChip
                  key={`knowledge-${f.path}`}
                  icon={<KnowledgeIcon className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
                  label={f.path}
                  mono
                  title={`Knowledge: ${f.path}`}
                  removeLabel={`Remove knowledge ${f.path}`}
                  onRemove={() => toggleId(setAttachedKnowledge, f.path)}
                />
              ))}
              {attachedMemoryItems.map((f) => (
                <AttachmentChip
                  key={`memory-${f.path}`}
                  icon={<Brain className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
                  label={f.path}
                  mono
                  title={`Memory: ${f.path}`}
                  removeLabel={`Remove memory ${f.path}`}
                  onRemove={() => toggleId(setAttachedMemory, f.path)}
                />
              ))}
              {attachedWorkflowItems.map((wf) => (
                <AttachmentChip
                  key={`workflow-${wf.id}`}
                  icon={<WorkflowIcon className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
                  label={wf.name}
                  title={`Workflow: ${wf.name}`}
                  removeLabel={`Remove workflow ${wf.name}`}
                  onRemove={() => toggleId(setAttachedWorkflows, wf.id)}
                />
              ))}
              {attachedRoleItems.map((r) => (
                <AttachmentChip
                  key={`role-${r.id}`}
                  icon={<RoleIcon className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
                  label={r.name}
                  title={`Role: ${r.name}`}
                  removeLabel={`Remove role ${r.name}`}
                  onRemove={() => toggleId(setAttachedRoles, r.id)}
                />
              ))}
            </div>
          )}
          {uploadError && (
            <p className="mt-2 text-xs text-[var(--danger)]">{uploadError}</p>
          )}

          {currentQueue.length > 0 && (
            <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <ListChecks className="h-3.5 w-3.5" />
                  Queue · {currentQueue.length}
                  {streaming ? " · sending after this task" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => currentId && clearPromptQueue(currentId)}
                  className="text-[10px] font-medium text-[var(--muted)] hover:text-[var(--danger)]"
                >
                  Clear
                </button>
              </div>
              <ul className="m-0 max-h-28 list-none space-y-1 overflow-y-auto p-0">
                {currentQueue.map((queued, index) => (
                  <li
                    key={`${index}-${queued.slice(0, 16)}`}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--bg)] px-2 py-1.5"
                  >
                    <span className="w-4 shrink-0 text-center text-[10px] text-[var(--subtle)]">
                      {index + 1}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-xs text-[var(--fg)]"
                      title={visiblePromptText(queued)}
                    >
                      {visiblePromptText(queued)}
                    </span>
                    <button
                      type="button"
                      onClick={() => currentId && removeQueuedPrompt(currentId, index)}
                      className="shrink-0 text-[var(--subtle)] hover:text-[var(--danger)]"
                      title="Remove from queue"
                      aria-label={`Remove queued prompt ${index + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={pickFiles}
                title="Upload attachments (any type, 300 MB each)"
                aria-label="Upload attachments"
                disabled={uploading}
                className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)] disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={1.8} />
                ) : (
                  <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.8} />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => void handleFiles(e.target.files)}
              />
              <button
                type="button"
                onClick={() => setWorkspaceOpen(true)}
                title={workspacePath ? `Workspace: ${workspacePath}` : "Choose workspace"}
                aria-label="Choose workspace"
                className="flex h-11 min-w-0 max-w-[12rem] items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]"
              >
                <FolderOpen className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
                <span className="truncate text-xs">
                  {workspacePath ? workspacePath.split("/").pop() || workspacePath : "Workspace"}
                </span>
              </button>
              {agentMode !== "chat" && <TaskModePicker />}
              <ComboPicker />
            </div>

            {streaming ? (
              <div className="flex items-center gap-2">
                {value.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={addToQueue}
                    title="Add this prompt to the queue — it sends automatically once the current task finishes"
                    aria-label="Add to queue"
                    className="flex h-11 items-center gap-1.5 rounded-full bg-[var(--chip)] px-3.5 text-xs font-medium text-[var(--fg)] transition-colors hover:bg-[var(--chip-hover)] active:scale-95"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2} />
                    Add to queue
                  </button>
                )}
                <button
                  type="button"
                  onClick={onStop}
                  title="Stop"
                  aria-label="Stop"
                  className="grid h-11 w-11 place-items-center rounded-full bg-[var(--secondary)] text-[var(--secondary-fg)] transition-transform active:scale-95"
                >
                  <Square className="h-4 w-4" fill="currentColor" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!value.trim()}
                title="Send"
                aria-label="Send"
                className={cn(
                  "grid h-11 w-11 place-items-center rounded-full transition-transform active:scale-95",
                  value.trim()
                    ? "bg-[var(--secondary)] text-[var(--secondary-fg)]"
                    : "cursor-not-allowed bg-[var(--chip)] text-[var(--subtle)]",
                )}
              >
                <ArrowUp className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
            )}
          </div>
        </div>

        <p className="mx-auto mt-3 max-w-3xl text-center text-xs text-[var(--subtle)]">
          Mythgram AI can be wrong. Check anything that matters.
        </p>
      </div>

      <WorkspaceModal
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
      />
      <ComposioKeyModal
        open={composioKeyOpen}
        onClose={() => setComposioKeyOpen(false)}
        onSaved={() => void loadConnectors()}
      />
    </div>
  );
}

function SlashMenuOption({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--chip)]"
      role="option"
      aria-selected="false"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--chip)] text-[var(--muted)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-[var(--fg)]">{title}</span>
        <span className="block truncate text-[10px] text-[var(--subtle)]">{hint}</span>
      </span>
    </button>
  );
}

function WorkspaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const workspacePath = useStore((s) => s.workspacePath);
  const setWorkspacePath = useStore((s) => s.setWorkspacePath);
  const [path, setPath] = useState(workspacePath);
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Reset the form whenever the modal opens (derived during render so opening
  // never triggers a cascading effect render).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPath(workspacePath);
      setFolder("");
      setError(null);
      setNotice(null);
    }
  }

  const switchWorkspace = async () => {
    const next = path.trim();
    if (!next) {
      setError("Enter a workspace path first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const workspace = await setWorkspace(next);
      setWorkspacePath(workspace);
      setNotice(`Workspace set to ${workspace}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createFolder = async () => {
    const name = folder.trim();
    if (!name) {
      setError("Enter a folder name first (e.g. <folder name> or <a>/<b>/<c>).");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await mkdirWorkspace(name);
      setNotice(`Created folder ${created} inside the current workspace.`);
      setFolder("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<FolderOpen className="h-4 w-4" />}
      title="Agent workspace"
      size="md"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4 p-5">
        <Field label="Current agent workspace path" hint="where the agent reads/writes files">
          <div className="break-all rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 font-mono text-xs text-[var(--fg)]">
            {workspacePath || "(loading…)"}
          </div>
        </Field>

        <Field
          label="Switch workspace"
          hint="absolute path, or relative to the current workspace"
        >
          <TextInput
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/home/user/project or my-project/sub"
            className="font-mono text-xs"
          />
        </Field>
        <div className="flex justify-end">
          <Button onClick={switchWorkspace} disabled={busy}>
            Switch workspace
          </Button>
        </div>

        <Field
          label="Create new folder here"
          hint="<folder name> or <a>/<b>/<c>"
        >
          <TextInput
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="e.g. docs or projects/app/docs"
            className="font-mono text-xs"
          />
        </Field>
        <div className="flex justify-end">
          <Button variant="outline" onClick={createFolder} disabled={busy}>
            Create folder
          </Button>
        </div>

        {notice && <p className="text-xs text-[var(--success)]">{notice}</p>}
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </Modal>
  );
}

function TaskModePicker() {
  const taskModes = useStore((s) => s.taskModes);
  const activeTaskModeId = useStore((s) => s.activeTaskModeId);
  const setActiveTaskMode = useStore((s) => s.setActiveTaskMode);
  const addTaskMode = useStore((s) => s.addTaskMode);
  const setSection = useStore((s) => s.setSection);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeName =
    !activeTaskModeId || activeTaskModeId === DEFAULT_TASK_MODE_ID
      ? "Default"
      : activeTaskModeId === PLAN_TASK_MODE_ID
        ? "Plan"
        : (taskModes.find((m) => m.id === activeTaskModeId)?.name ?? "Default");

  const create = () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setError("A mode name is required.");
      return;
    }
    if (!prompt.trim()) {
      setError("The prompt to append cannot be empty.");
      return;
    }
    if (cleanName.toLowerCase() === "plan" || cleanName.toLowerCase() === "default") {
      setError(`"${cleanName}" is reserved for the built-in modes.`);
      return;
    }
    if (taskModes.some((m) => m.name.trim().toLowerCase() === cleanName.toLowerCase())) {
      setError(`A task mode named "${cleanName}" already exists.`);
      return;
    }
    const created = addTaskMode({ name: cleanName, prompt });
    setActiveTaskMode(created.id);
    setCreating(false);
    setName("");
    setPrompt("");
    setError(null);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Task mode: ${activeName}`}
        aria-label="Task mode"
        className="flex h-11 items-center gap-1 rounded-[var(--radius-md)] px-2 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)]"
      >
        <ListChecks className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
        <span className="max-w-[5rem] truncate">{activeName}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute bottom-12 left-0 z-50 w-56 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] py-1 pop-in"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            <ModeOption
              label="Default"
              hint="Works normally"
              active={activeName === "Default"}
              onClick={() => {
                setActiveTaskMode(null);
                setOpen(false);
              }}
            />
            <ModeOption
              label="Plan"
              hint="Plan first, then work"
              active={activeName === "Plan"}
              onClick={() => {
                setActiveTaskMode(PLAN_TASK_MODE_ID);
                setOpen(false);
              }}
            />
            {taskModes.length > 0 && <div className="my-1 border-t border-[var(--border)]" />}
            {taskModes.map((m) => (
              <ModeOption
                key={m.id}
                label={m.name}
                hint="Custom"
                active={m.id === activeTaskModeId}
                onClick={() => {
                  setActiveTaskMode(m.id);
                  setOpen(false);
                }}
              />
            ))}
            <div className="my-1 border-t border-[var(--border)]" />
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setError(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[var(--secondary)] hover:bg-[var(--chip)]"
            >
              <Plus className="h-3.5 w-3.5" /> New custom mode
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSection("taskmodes");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]"
            >
              <ListChecks className="h-3.5 w-3.5" /> Manage modes
            </button>
          </div>
        </>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        icon={<Plus className="h-4 w-4" />}
        title="New custom task mode"
        size="md"
        footer={<Button onClick={create}>Create & use</Button>}
      >
        <div className="space-y-4 p-5">
          <Field label="Mode name">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Review"
            />
          </Field>
          <Field label="Prompt appended to your message" hint="appended verbatim">
            <TextArea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="font-mono text-xs"
              placeholder="e.g. Review the following for bugs and list findings by severity…"
            />
          </Field>
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}

function ModeOption({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--chip)]",
        active && "bg-[var(--chip)]",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-[var(--fg)]">{label}</span>
        <span className="block text-[10px] text-[var(--subtle)]">{hint}</span>
      </span>
      {active && <span className="text-[10px] font-semibold text-[var(--secondary)]">Active</span>}
    </button>
  );
}

/**
 * Combo picker: a compact toolbar button that shows the active provider combo and
 * lets the user switch it on/off without opening Settings. Creating and editing
 * combos happens in Settings (the "Manage combos" entry jumps there).
 */
function ComboPicker() {
  const settings = useStore((s) => s.settings);
  const activateCombo = useStore((s) => s.activateCombo);
  const setSection = useStore((s) => s.setSection);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [open, setOpen] = useState(false);

  const comboState = settings.combo ?? { enabled: false, activeComboId: null, combos: [] };
  const usableCombos = comboState.combos.filter(
    (c) => c.entries.filter((e) => e.model.trim().length > 0).length >= 2,
  );
  const activeCombo =
    comboState.enabled && comboState.activeComboId
      ? (comboState.combos.find((c) => c.id === comboState.activeComboId) ?? null)
      : null;
  const activeUsable = activeCombo
    ? activeCombo.entries.filter((e) => e.model.trim().length > 0).length >= 2
    : false;
  const isActive = Boolean(activeCombo && activeUsable);

  const openSettings = () => {
    setOpen(false);
    setSection("chat");
    setSettingsOpen(true);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={isActive ? `Provider combo: ${activeCombo?.name}` : "Provider combos"}
        aria-label="Provider combos"
        className={cn(
          "flex h-11 items-center gap-1 rounded-[var(--radius-md)] px-2 text-xs font-medium transition-colors hover:bg-[var(--chip)]",
          isActive ? "text-[var(--secondary)]" : "text-[var(--muted)] hover:text-[var(--fg)]",
        )}
      >
        <Layers className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
        <span className="max-w-[5.5rem] truncate">
          {isActive ? activeCombo?.name : "Combo"}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute bottom-12 left-0 z-50 w-64 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] py-1 pop-in"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            <div className="flex items-center justify-between px-3 pb-1 pt-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
                Provider combos
              </span>
              {isActive && (
                <button
                  type="button"
                  onClick={() => {
                    activateCombo(null);
                    setOpen(false);
                  }}
                  className="text-[10px] font-medium text-[var(--muted)] hover:text-[var(--fg)]"
                >
                  Turn off
                </button>
              )}
            </div>
            {usableCombos.length === 0 ? (
              <p className="m-0 px-3 py-2 text-xs text-[var(--muted)]">
                No usable combos yet. Create one with at least two providers in Settings.
              </p>
            ) : (
              usableCombos.map((c) => (
                <ComboOption
                  key={c.id}
                  name={c.name}
                  hint={`${c.entries.length} providers`}
                  active={isActive && activeCombo?.id === c.id}
                  onClick={() => {
                    if (isActive && activeCombo?.id === c.id) activateCombo(null);
                    else activateCombo(c.id);
                    setOpen(false);
                  }}
                />
              ))
            )}
            <div className="my-1 border-t border-[var(--border)]" />
            <button
              type="button"
              onClick={openSettings}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]"
            >
              <Layers className="h-3.5 w-3.5" /> Manage combos in Settings
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ComboOption({
  name,
  hint,
  active,
  onClick,
}: {
  name: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--chip)]",
        active && "bg-[var(--chip)]",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-[var(--fg)]">{name}</span>
        <span className="block text-[10px] text-[var(--subtle)]">{hint}</span>
      </span>
      {active && <span className="text-[10px] font-semibold text-[var(--secondary)]">Active</span>}
    </button>
  );
}

/** A removable chip showing one capability attached to the current prompt. */
function AttachmentChip({
  icon,
  label,
  title,
  removeLabel,
  onRemove,
  mono,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  removeLabel: string;
  onRemove: () => void;
  mono?: boolean;
}) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--chip)] px-2.5 py-1 text-xs text-[var(--fg)]"
      title={title}
    >
      {icon}
      <span className={cn("max-w-[10rem] truncate", mono && "font-mono")}>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-[var(--subtle)] hover:text-[var(--danger)]"
        title={removeLabel}
        aria-label={removeLabel}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/** The generic scrollable list of selectable rows used by every "/" list stage. */
function SlashList({ items }: { items: SlashListItem[] }) {
  return (
    <ul className="m-0 max-h-72 list-none overflow-y-auto p-0">
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            onClick={item.onSelect}
            className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-[var(--chip)]"
            role="option"
            aria-selected={Boolean(item.selected)}
          >
            {item.icon}
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-xs font-medium text-[var(--fg)]",
                  item.mono && "font-mono",
                )}
              >
                {item.title}
              </span>
              <span className="block truncate text-[10px] text-[var(--subtle)]">
                {item.subtitle}
              </span>
            </span>
            {item.selected && (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--secondary)]" />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The "/" connectors stage: lists only CONNECTED apps and offers a button to add the Composio API
 * key (when none is configured) plus a button to jump to the full Connectors page.
 */
function ConnectorStage({
  configured,
  loading,
  error,
  items,
  attachedIds,
  onAddKey,
  onOpenPage,
  onToggle,
  matches,
  query,
}: {
  configured: boolean;
  loading: boolean;
  error: string | null;
  items: ConnectorOverviewItem[];
  attachedIds: string[];
  onAddKey: () => void;
  onOpenPage: () => void;
  onToggle: (item: ConnectorOverviewItem) => void;
  matches: (text: string) => boolean;
  query: string;
}) {
  const rowIcon = "mt-0.5 h-4 w-4 shrink-0 text-[var(--subtle)]";

  const openPageButton = (
    <button
      type="button"
      onClick={onOpenPage}
      className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-[var(--secondary)] hover:bg-[var(--chip)]"
    >
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0" /> Open connectors page
    </button>
  );

  if (!configured) {
    return (
      <div className="px-3 py-2">
        <p className="m-0 text-xs text-[var(--muted)]">
          Connectors are powered by Composio. Add your Composio API key to connect apps like GitHub,
          Slack, and Notion.
        </p>
        <button
          type="button"
          onClick={onAddKey}
          className="mt-2 flex w-full items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 text-left text-xs font-medium text-[var(--fg)] hover:border-[var(--secondary)]"
        >
          <KeyRound className="h-3.5 w-3.5 shrink-0" /> Add Composio API key
        </button>
        <div className="mt-1">{openPageButton}</div>
      </div>
    );
  }

  if (loading) {
    return (
      <p className="m-0 flex items-center gap-2 px-3 py-2 text-xs text-[var(--muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading connected apps…
      </p>
    );
  }

  const filtered = items.filter((c) =>
    matches(`${c.name} ${c.description} ${c.id} ${c.account_label ?? ""}`),
  );

  if (items.length === 0) {
    return (
      <div className="px-3 py-2">
        <p className="m-0 text-xs text-[var(--muted)]">No connected apps yet.</p>
        <div className="mt-1">{openPageButton}</div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <p className="m-0 px-3 py-2 text-xs text-[var(--muted)]">
        No connected apps match “{query}”.
      </p>
    );
  }

  const rows: SlashListItem[] = filtered.map((c) => ({
    key: c.id,
    icon: <ConnectorsIcon className={rowIcon} />,
    title: c.name,
    subtitle: c.account_label || c.description || c.id,
    selected: attachedIds.includes(c.id),
    onSelect: () => onToggle(c),
  }));

  return (
    <>
      <SlashList items={rows} />
      <div className="mt-1 border-t border-[var(--border)]">{openPageButton}</div>
      {error && <p className="m-0 px-3 py-1 text-[10px] text-[var(--danger)]">{error}</p>}
    </>
  );
}

/** Inline Composio API-key entry used from the "/" connectors stage. */
function ComposioKeyModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever the modal opens (derived during render, like WorkspaceModal).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setKey(settings.composioApiKey ?? "");
      setError(null);
    }
  }

  const save = async () => {
    const trimmed = key.trim();
    if (!trimmed) {
      setError("Enter your Composio API key.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const valid = await validateComposioKey(trimmed);
      if (!valid) {
        setError("That key could not be validated. Check it and try again.");
        return;
      }
      setSettings({ composioApiKey: trimmed });
      await saveStateKey("settings", {
        ...useStore.getState().settings,
        composioApiKey: trimmed,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<KeyRound className="h-4 w-4" />}
      title="Add Composio API key"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Validating…" : "Save key"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <p className="m-0 text-xs text-[var(--muted)]">
          Connectors are powered by Composio. Add your Composio API key to connect apps like GitHub,
          Slack, and Notion. The key is stored in your profile settings.
        </p>
        <Field label="Composio API key" hint="stored in your profile settings">
          <TextInput
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="cmp_..."
            className="font-mono text-xs"
            autoComplete="off"
          />
        </Field>
        {error && <p className="m-0 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </Modal>
  );
}
