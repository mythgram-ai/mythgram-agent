import { useEffect, useRef, useState } from "react";
import { Paperclip, ArrowUp, Square, FolderOpen, X, Loader2, ChevronDown, ListChecks, Plus, Bookmark } from "lucide-react";
import { useStore } from "@/store/useStore";
import { isCustomProviderId, isLocalProviderId } from "@/lib/providers";
import { isContextLimitRequired, isMainAgentActive } from "@/lib/contextMeter";
import { fetchWorkspace, mkdirWorkspace, setWorkspace } from "@/lib/workspace";
import { buildAttachmentPrompt, uploadFiles, type UploadedFile } from "@/lib/uploads";
import { PLAN_TASK_MODE_ID, DEFAULT_TASK_MODE_ID } from "@/lib/taskModes";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, TextArea, TextInput } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

export function Composer({ onSend, onStop }: { onSend: (text: string) => void; onStop: () => void }) {
  const [value, setValue] = useState("");
  const streaming = useStore((s) => s.streaming);
  const settings = useStore((s) => s.settings);
  const customProviders = useStore((s) => s.customProviders);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setSection = useStore((s) => s.setSection);
  const agentMode = useStore((s) => s.agentMode);
  const workspacePath = useStore((s) => s.workspacePath);
  const setWorkspacePath = useStore((s) => s.setWorkspacePath);
  const promptLibrary = useStore((s) => s.promptLibrary);
  const composerPrefill = useStore((s) => s.composerPrefill);
  const setComposerPrefill = useStore((s) => s.setComposerPrefill);
  const models = useStore((s) => s.models);
  const modelsLoading = useStore((s) => s.modelsLoading);
  const activeCustomAgentId = useStore((s) => s.activeCustomAgentId);
  const customAgents = useStore((s) => s.customAgents);
  const ceoAgents = useStore((s) => s.ceoAgents);
  const agentTeams = useStore((s) => s.agentTeams);
  // "/" shortcut stages: "menu" shows the single "Prompt library" option,
  // "list" shows the saved prompts (title + optional short description).
  const [slashStage, setSlashStage] = useState<"menu" | "list">("menu");
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

  // The "/" shortcut is active while the composer starts with "/".
  const slashActive = !streaming && value.startsWith("/");
  const slashFilter = slashActive ? value.slice(1).trim().toLowerCase() : "";
  const slashMatches =
    slashFilter.length === 0
      ? promptLibrary
      : promptLibrary.filter((item) =>
          `${item.title} ${item.description}`.toLowerCase().includes(slashFilter),
        );

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

  const submit = () => {
    const text = value.trim();
    if (!text || streaming || uploading) return;
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
    const notice = buildAttachmentPrompt(attachments);
    onSend(notice ? `${text}\n\n${notice}` : text);
    setValue("");
    setSlashStage("menu");
    setAttachments([]);
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
      if (slashStage === "list") setSlashStage("menu");
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
              className="absolute bottom-full left-0 z-50 mb-2 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg)] py-1 pop-in"
              style={{ boxShadow: "var(--shadow-pop)" }}
              role="listbox"
              aria-label="Prompt library shortcuts"
            >
              {slashStage === "menu" ? (
                <button
                  type="button"
                  onClick={() => setSlashStage("list")}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--chip)]"
                  role="option"
                  aria-selected="false"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--chip)] text-[var(--muted)]">
                    <Bookmark className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-[var(--fg)]">
                      Prompt library
                    </span>
                    <span className="block truncate text-[10px] text-[var(--subtle)]">
                      {promptLibrary.length === 0
                        ? "No saved prompts yet"
                        : `${promptLibrary.length} saved prompt${promptLibrary.length === 1 ? "" : "s"}`}
                    </span>
                  </span>
                </button>
              ) : (
                <>
                  <div className="flex items-center justify-between px-3 pb-1 pt-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
                      Saved prompts
                    </span>
                    <button
                      type="button"
                      onClick={() => setSlashStage("menu")}
                      className="text-[10px] font-medium text-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      Back
                    </button>
                  </div>
                  {promptLibrary.length === 0 ? (
                    <p className="m-0 px-3 py-2 text-xs text-[var(--muted)]">
                      No saved prompts yet. Save one from the Prompt library page or the
                      bookmark button on any chat prompt.
                    </p>
                  ) : slashMatches.length === 0 ? (
                    <p className="m-0 px-3 py-2 text-xs text-[var(--muted)]">
                      No saved prompts match “{value.slice(1).trim()}”.
                    </p>
                  ) : (
                    <ul className="m-0 max-h-56 list-none overflow-y-auto p-0">
                      {slashMatches.slice(0, 20).map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => insertLibraryPrompt(item.content)}
                            className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-[var(--chip)]"
                            role="option"
                            aria-selected="false"
                            title={item.content.slice(0, 200)}
                          >
                            <Bookmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--subtle)]" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-[var(--fg)]">
                                {item.title}
                              </span>
                              <span className="block truncate text-[10px] text-[var(--subtle)]">
                                {item.description || "No description."}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
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
            placeholder="Ask Haku anything"
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
          {uploadError && (
            <p className="mt-2 text-xs text-[var(--danger)]">{uploadError}</p>
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
            </div>

            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                title="Stop"
                aria-label="Stop"
                className="grid h-11 w-11 place-items-center rounded-full bg-[var(--secondary)] text-[var(--secondary-fg)] transition-transform active:scale-95"
              >
                <Square className="h-4 w-4" fill="currentColor" />
              </button>
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
          Haku can be wrong. Check anything that matters.
        </p>
      </div>

      <WorkspaceModal
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
      />
    </div>
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
