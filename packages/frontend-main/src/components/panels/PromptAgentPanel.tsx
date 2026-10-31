import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bookmark,
  Check,
  ClipboardCopy,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Square,
  WandSparkles,
  X,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { Button, EmptyState, Field, PanelHeader, TextArea, TextInput } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/utils/cn";
import { uid } from "@/utils/id";
import { CUSTOM_PROVIDER_PREFIX } from "@/lib/providers";
import { normalizePromptLibrary } from "@/lib/promptLibrary";
import {
  abortPromptAgent,
  newPromptAgentChatId,
  renderMarkdownToHtml,
  runPromptAgentStream,
  type PromptAgentMessage,
  type PromptAgentMode,
} from "@/lib/promptAgent";
import type { SSEEventData } from "@/types";

/**
 * Prompt creation agent page.
 *
 * Two modes share one UI: 1. create new prompt 2. enhance prompt.
 * Left side is the chat area, right side is an interactive canvas where the
 * generated prompt renders as Markdown. The canvas can be edited inline
 * (edit toggle) or by chatting ("make it shorter", ...). Canvas top offers
 * copy / edit / save — save stores the prompt in the prompt library.
 */
export function PromptAgentPanel() {
  const settings = useStore((s) => s.settings);
  const customProviders = useStore((s) => s.customProviders);
  const storeSkills = useStore((s) => s.skills);
  const addPromptLibraryItem = useStore((s) => s.addPromptLibraryItem);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const [mode, setMode] = useState<PromptAgentMode>("create");
  const [messages, setMessages] = useState<PromptAgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [existingPrompt, setExistingPrompt] = useState("");
  const [canvasContent, setCanvasContent] = useState("");
  const [canvasFile, setCanvasFile] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const chatIdRef = useRef<string>(newPromptAgentChatId());
  const abortRef = useRef<AbortController | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [messages, streaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ready = useMemo(() => {
    const isCustom = settings.provider.startsWith(CUSTOM_PROVIDER_PREFIX);
    const customProvider = customProviders.find((p) => p.id === settings.provider);
    if (isCustom) return Boolean(customProvider && settings.model);
    if (settings.provider === "local") return Boolean(settings.model);
    return Boolean(settings.apiKeys[settings.provider] && settings.model);
  }, [settings, customProviders]);

  const startDraft = (text: string): string => {
    const id = uid("msg");
    setMessages((prev) => [
      ...prev,
      { id: uid("msg"), role: "user", content: text },
      { id, role: "assistant", content: "", streaming: true },
    ]);
    return id;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    if (!ready) {
      setSettingsOpen(true);
      return;
    }
    if (mode === "enhance" && !existingPrompt.trim() && canvasContent.trim()) {
      setExistingPrompt(canvasContent);
    }
    setError(null);
    setInput("");
    const assistantId = startDraft(text);

    const isCustom = settings.provider.startsWith(CUSTOM_PROVIDER_PREFIX);
    const customProvider = customProviders.find((p) => p.id === settings.provider);
    const apiKey = isCustom
      ? (customProvider?.apiKey ?? "")
      : (settings.apiKeys[settings.provider] ?? "");

    const skills = storeSkills.map((sk) => {
      const entryName = sk.skillFile.trim() || "SKILL.md";
      return {
        name: sk.name,
        description: sk.description,
        skill_file: entryName,
        files: [
          { path: entryName, content: sk.skillContent },
          ...sk.files
            .filter((f) => f.path.trim().length > 0)
            .map((f) => ({ path: f.path.trim(), content: f.content })),
        ],
        enabled: sk.enabled,
      };
    });

    const history = messages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);

    const onEvent = (event: string, data: SSEEventData) => {
      const extra = data as unknown as Record<string, unknown>;
      if (event === "token" && typeof data.value === "string") {
        const delta = data.value;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
        );
      } else if (event === "tool_call" && typeof data.name === "string") {
        const label = typeof data.label === "string" && data.label ? data.label : data.name;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: `${m.content}\n\n*${label}…*` } : m,
          ),
        );
      } else if (event === "prompt_canvas_updated") {
        const content = typeof extra.content === "string" ? extra.content : "";
        const filePath = typeof extra.file_path === "string" ? extra.file_path : null;
        if (content) {
          setCanvasContent(content);
          setCanvasFile(filePath);
          setEditing(false);
        }
      } else if (event === "prompt_library_updated") {
        // An agent-driven prompt-library tool (save/delete) mutated the persisted
        // library. Mirror the backend truth into the store so the Prompt Library
        // page shows it instantly instead of on next boot.
        if (Array.isArray(extra.prompts)) {
          useStore.getState().setPromptLibrary(normalizePromptLibrary(extra.prompts));
        }
      } else if (event === "message_complete" && typeof data.content === "string") {
        // The chat summary arrives here; the canvas already holds the file content.
        // If the canvas is still empty, fall back to the final answer text.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content.trim().length > 0 ? m.content : data.content ?? m.content }
              : m,
          ),
        );
        setCanvasContent((prev) => {
          if (prev.trim().length > 0) return prev;
          const fallback = (data.content ?? "").trim();
          return fallback.length > 0 ? fallback : prev;
        });
      } else if (event === "error") {
        const message =
          typeof data.message === "string" && data.message ? data.message : "The prompt agent failed.";
        setError(message);
      }
    };

    await runPromptAgentStream({
      body: {
        chat_id: chatIdRef.current,
        user_message: text,
        mode,
        existing_prompt: mode === "enhance" ? existingPrompt || canvasContent : undefined,
        history,
        provider: settings.provider,
        model: settings.model,
        api_key: apiKey,
        base_url: settings.baseUrl || undefined,
        custom_provider:
          isCustom && customProvider
            ? {
                id: customProvider.id,
                name: customProvider.name,
                model: settings.model,
                baseUrl: customProvider.baseUrl,
                apiKey: customProvider.apiKey,
                headers: Object.fromEntries(
                  customProvider.headers
                    .filter((h) => h.key.trim().length > 0)
                    .map((h) => [h.key.trim(), h.value]),
                ),
              }
            : undefined,
        temperature: typeof settings.temperature === "number" ? settings.temperature : undefined,
        effort: settings.effort?.trim() || undefined,
        tavily_api_key: settings.tavilyApiKey || undefined,
        exa_api_key: settings.exaApiKey || undefined,
        serpapi_api_key: settings.serpapiApiKey || undefined,
        search_provider: settings.searchProvider,
        fetch_provider: settings.fetchProvider,
        firecrawl_api_key: settings.firecrawlApiKey || undefined,
        skills,
      },
      signal: controller.signal,
      onEvent,
    });

    setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
    setStreaming(false);
    abortRef.current = null;
  };

  const stop = async () => {
    abortRef.current?.abort();
    await abortPromptAgent(chatIdRef.current);
    setStreaming(false);
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  };

  const newSession = () => {
    void stop();
    chatIdRef.current = newPromptAgentChatId();
    setMessages([]);
    setCanvasContent("");
    setCanvasFile(null);
    setEditing(false);
    setError(null);
  };

  const copy = async () => {
    if (!canvasContent.trim()) return;
    try {
      await navigator.clipboard.writeText(canvasContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the user can still select the text.
    }
  };

  const openSave = () => {
    if (!canvasContent.trim()) return;
    setSaveTitle("");
    setSaveDescription("");
    setSaveError(null);
    setSaved(false);
    setSaveOpen(true);
  };

  const save = () => {
    const title = saveTitle.trim();
    if (!title) return setSaveError("A title is required.");
    if (!canvasContent.trim()) return setSaveError("There is no prompt text to save.");
    addPromptLibraryItem({ title, description: saveDescription.trim(), content: canvasContent });
    setSaveError(null);
    setSaved(true);
  };

  const canvasHtml = useMemo(() => renderMarkdownToHtml(canvasContent), [canvasContent]);

  return (
    <div className="mx-auto w-full max-w-6xl panel-in">
      <PanelHeader kicker="Prompt studio" title="Prompt agent" />
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Describe the task and the agent drafts a reusable Markdown prompt on the canvas.
        Edit it inline, refine it by chatting, then copy it or save it to your prompt library.
      </p>

      {/* Mode options in the prompt box */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div
          className="flex gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-1"
          role="group"
          aria-label="Prompt mode"
        >
          <button
            type="button"
            onClick={() => setMode("create")}
            aria-pressed={mode === "create"}
            className={cn(
              "flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors",
              mode === "create"
                ? "bg-[var(--secondary)] text-[var(--secondary-fg)]"
                : "text-[var(--muted)] hover:text-[var(--fg)]",
            )}
          >
            <Sparkles className="h-3.5 w-3.5" /> Create new prompt
          </button>
          <button
            type="button"
            onClick={() => setMode("enhance")}
            aria-pressed={mode === "enhance"}
            className={cn(
              "flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors",
              mode === "enhance"
                ? "bg-[var(--secondary)] text-[var(--secondary-fg)]"
                : "text-[var(--muted)] hover:text-[var(--fg)]",
            )}
          >
            <WandSparkles className="h-3.5 w-3.5" /> Enhance prompt
          </button>
        </div>
        <Button variant="ghost" className="px-2" onClick={newSession} title="Start a fresh prompt session">
          <Plus className="h-3.5 w-3.5" /> New session
        </Button>
        {!ready && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-[var(--radius-md)] border px-3 py-1.5 text-xs"
            style={{
              borderColor: "color-mix(in oklab, var(--warning) 32%, transparent)",
              background: "var(--warning-soft)",
              color: "var(--warning)",
            }}
          >
            Add your API key and pick a model in Settings to start.
          </button>
        )}
      </div>

      <div className="grid min-h-[60vh] grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left side: chat area */}
        <section
          className="flex min-h-[50vh] flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-4"
          style={{ boxShadow: "var(--shadow-chip)" }}
          aria-label="Prompt chat"
        >
          <div ref={chatScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <EmptyState icon={<WandSparkles className="h-8 w-8" />}>
                {mode === "create"
                  ? "Tell the agent what the prompt is for — e.g. “a weekly status-report prompt for my team”."
                  : "Paste the prompt to improve below, then describe what better looks like."}
              </EmptyState>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-[var(--radius-md)] px-3 py-2 text-sm leading-relaxed",
                    m.role === "user"
                      ? "ml-8 bg-[var(--chip)] text-[var(--fg)]"
                      : "mr-8 bg-transparent text-[var(--muted)]",
                  )}
                >
                  {m.content || (m.streaming ? "…" : "")}
                </div>
              ))
            )}
            {error && <p className="m-0 text-xs text-[var(--danger)]">{error}</p>}
          </div>

          {mode === "enhance" && (
            <Field label="Existing prompt to enhance" hint="used as the starting point">
              <TextArea
                rows={4}
                value={existingPrompt}
                onChange={(e) => setExistingPrompt(e.target.value)}
                placeholder="Paste the prompt you want to improve…"
                className="font-mono text-xs"
              />
            </Field>
          )}

          <div className="mt-3">
            <label htmlFor="prompt-agent-composer" className="sr-only">
              Message the prompt agent
            </label>
            <TextArea
              id="prompt-agent-composer"
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                mode === "create" ? "Describe the prompt you need…" : "How should the prompt be improved?"
              }
            />
            <div className="mt-2 flex justify-end">
              {streaming ? (
                <Button variant="outline" onClick={() => void stop()}>
                  <Square className="h-4 w-4" fill="currentColor" /> Stop
                </Button>
              ) : (
                <Button onClick={() => void send()} disabled={!input.trim()}>
                  <ArrowUp className="h-4 w-4" /> Send
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* Right side: interactive canvas */}
        <section
          className="flex min-h-[50vh] flex-col rounded-[var(--radius-xl)] bg-[var(--bg)]"
          style={{ boxShadow: "var(--shadow-chip)" }}
          aria-label="Prompt canvas"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
            <div className="min-w-0">
              <p className="m-0 truncate text-xs font-medium text-[var(--muted)]">
                {canvasFile ? `Canvas · ${canvasFile}` : "Canvas · Markdown preview"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" className="px-2" onClick={() => void copy()} title="Copy prompt">
                {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="ghost"
                className="px-2"
                onClick={() => {
                  if (!editing) setEditDraft(canvasContent);
                  setEditing((v) => !v);
                }}
                title={editing ? "Stop editing" : "Edit prompt"}
                disabled={!canvasContent.trim() && !editing}
              >
                {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                {editing ? "Done" : "Edit"}
              </Button>
              <Button variant="ghost" className="px-2" onClick={openSave} title="Save to prompt library" disabled={!canvasContent.trim()}>
                <Save className="h-3.5 w-3.5" /> Save
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {!canvasContent.trim() ? (
              <EmptyState icon={<Bookmark className="h-8 w-8" />}>
                Nothing on the canvas yet. Ask the agent to draft a prompt — every Markdown file
                it writes appears here, rendered as Markdown.
              </EmptyState>
            ) : editing ? (
              <div>
                <TextArea
                  rows={22}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  className="font-mono text-xs"
                  aria-label="Edit prompt markdown"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      setCanvasContent(editDraft);
                      setEditing(false);
                    }}
                  >
                    <Check className="h-4 w-4" /> Apply edit
                  </Button>
                </div>
                <p className="mt-2 text-xs text-[var(--subtle)]">
                  Tip: you can also refine the prompt by chatting — e.g. “make it shorter” or
                  “add an output-format section”.
                </p>
              </div>
            ) : (
              <article
                className="prompt-canvas-markdown break-words text-sm leading-relaxed text-[var(--fg)]"
                // Rendered from the agent's Markdown via a dependency-free renderer.
                dangerouslySetInnerHTML={{ __html: canvasHtml }}
              />
            )}
          </div>
        </section>
      </div>

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        icon={<Bookmark className="h-4 w-4" />}
        title="Save prompt to library"
        size="md"
        footer={
          saved ? (
            <Button onClick={() => setSaveOpen(false)}>Done</Button>
          ) : (
            <Button onClick={save}>
              <Check className="h-4 w-4" /> Save
            </Button>
          )
        }
      >
        <div className="space-y-4 p-5">
          {saved ? (
            <p className="text-sm text-[var(--success)]">
              Saved to your prompt library. Find it under Prompt library in the sidebar, or type{" "}
              <code className="rounded bg-[var(--chip)] px-1 font-mono text-xs">/</code> in the
              composer to reuse it.
            </p>
          ) : (
            <>
              <Field label="Title" hint="no limit">
                <TextInput
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  placeholder="e.g. Weekly status report"
                />
              </Field>
              <Field label="Short description (optional)" hint="no limit">
                <TextArea
                  rows={2}
                  value={saveDescription}
                  onChange={(e) => setSaveDescription(e.target.value)}
                  placeholder="What this prompt is for."
                />
              </Field>
              {saveError && <p className="text-xs text-[var(--danger)]">{saveError}</p>}
            </>
          )}
        </div>
      </Modal>

      <style>{`
        .prompt-canvas-markdown h1, .prompt-canvas-markdown h2,
        .prompt-canvas-markdown h3, .prompt-canvas-markdown h4 {
          margin: 0.9em 0 0.4em; line-height: 1.3;
        }
        .prompt-canvas-markdown h1 { font-size: 1.4rem; }
        .prompt-canvas-markdown h2 { font-size: 1.2rem; }
        .prompt-canvas-markdown h3 { font-size: 1.05rem; }
        .prompt-canvas-markdown p { margin: 0.5em 0; }
        .prompt-canvas-markdown ul { margin: 0.5em 0; padding-left: 1.25rem; }
        .prompt-canvas-markdown li { margin: 0.2em 0; }
        .prompt-canvas-markdown code {
          border-radius: 4px; padding: 0.1em 0.35em;
          background: var(--chip); font-family: monospace; font-size: 0.85em;
        }
        .prompt-canvas-markdown pre {
          border-radius: 8px; padding: 0.75rem;
          background: var(--chip); overflow-x: auto;
        }
        .prompt-canvas-markdown pre code { background: transparent; padding: 0; }
        .prompt-canvas-markdown blockquote {
          margin: 0.5em 0; padding-left: 0.75rem;
          border-left: 2px solid var(--border); color: var(--muted);
        }
        .prompt-canvas-markdown a { color: var(--secondary); }
      `}</style>
    </div>
  );
}
