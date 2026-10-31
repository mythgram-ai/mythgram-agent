import { useEffect, useState } from "react";
import { Check, FileText, Pencil, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, Upload } from "lucide-react";
import { useStore } from "@/store/useStore";
import { fetchMainAgentSystemPrompt } from "@/lib/customAgentTools";
import { Modal } from "@/components/ui/Modal";
import { ImportMainAgentPromptsModal } from "@/components/panels/ImportMainAgentPromptsModal";
import { Button, EmptyState, Field, PanelHeader, TextArea, TextInput, Toggle } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

const NAME_MAX = 70;
const DESC_MAX = 300;

interface Draft {
  id: string | null;
  name: string;
  description: string;
  content: string;
}

const empty = (): Draft => ({ id: null, name: "", description: "", content: "" });

/**
 * Custom System Prompts panel.
 *
 * Lets the user manage multiple named system prompts for the EXISTING built-in Main Agent and pick
 * exactly one as active. Activating a prompt changes only the INSTRUCTIONS the Main Agent runs with
 * for future turns — it never creates a new Main Agent, sub-agent, or multi-agent system. When no
 * prompt is active, the Main Agent uses its built-in system prompt.
 *
 * Creating a prompt pre-fills the editor with the built-in Main Agent system prompt as a template
 * (so users start from a known-good base), with a Reload button to re-fetch it anytime.
 */
export function MainAgentPromptsPanel() {
  const prompts = useStore((s) => s.mainAgentPrompts);
  const activeId = useStore((s) => s.activeMainAgentPromptId);
  const addPrompt = useStore((s) => s.addMainAgentPrompt);
  const updatePrompt = useStore((s) => s.updateMainAgentPrompt);
  const deletePrompt = useStore((s) => s.deleteMainAgentPrompt);
  const setActive = useStore((s) => s.setActiveMainAgentPrompt);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Built-in Main Agent prompt template load status (used to pre-fill / reload).
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // When the editor opens for a NEW prompt, pre-fill the content with the built-in Main Agent
  // system prompt so the user has a template to start from (only when nothing is typed yet).
  useEffect(() => {
    if (!draft || draft.id !== null) return;
    const controller = new AbortController();
    setTemplateLoading(true);
    setTemplateError(null);
    fetchMainAgentSystemPrompt(controller.signal)
      .then((prompt) => {
        if (controller.signal.aborted) return;
        setDraft((d) => (d && d.id === null && d.content.trim().length === 0 ? { ...d, content: prompt } : d));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setTemplateError("Couldn't load the Main Agent's default prompt to pre-fill. You can still write your own.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setTemplateLoading(false);
      });
    return () => controller.abort();
    // Only run when the editor opens for a new prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft !== null]);

  /** Re-fetch the built-in Main Agent system prompt and load it into the editor (overwrites content). */
  const reloadDefault = () => {
    setTemplateLoading(true);
    setTemplateError(null);
    fetchMainAgentSystemPrompt()
      .then((prompt) => setDraft((d) => (d ? { ...d, content: prompt } : d)))
      .catch(() => setTemplateError("Couldn't reload the default Main Agent prompt."))
      .finally(() => setTemplateLoading(false));
  };

  const save = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return setError("A prompt name is required.");
    if (name.length > NAME_MAX) return setError(`Name must be ${NAME_MAX} characters or fewer.`);
    if (draft.description.length > DESC_MAX)
      return setError(`Description must be ${DESC_MAX} characters or fewer.`);
    if (!draft.content.trim()) return setError("The system prompt cannot be empty.");
    const clash = prompts.some(
      (p) => p.id !== draft.id && p.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) return setError(`A system prompt named "${name}" already exists.`);

    const payload = { name, description: draft.description.trim(), content: draft.content };
    if (draft.id) {
      updatePrompt(draft.id, payload);
    } else {
      const created = addPrompt(payload);
      // Activate a newly created prompt so it takes effect for the next run right away.
      setActive(created.id);
    }
    setDraft(null);
    setError(null);
  };

  const activePrompt = prompts.find((p) => p.id === activeId) ?? null;
  const builtInActive = !activePrompt;

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <PanelHeader kicker="Instructions for the Main Agent" title="Custom system prompts" />
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Save your own system prompts for the built-in Main Agent and switch between them anytime. The
        active prompt is used for all future runs — this only changes the Main Agent's instructions,
        it does not create a new agent. When none is active, the built-in Main Agent prompt is used.
      </p>

      <div
        className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 text-xs text-[var(--muted)]"
        aria-live="polite"
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--subtle)]" />
        <span>
          Active prompt:{" "}
          <span className="font-medium text-[var(--fg)]">
            {activePrompt ? activePrompt.name : "Built-in Main Agent prompt"}
          </span>{" "}
          — used by the Main Agent for future runs.
        </span>
      </div>

      {/* Built-in Main Agent prompt — always available as the default. */}
      <article
        className={cn(
          "mb-3 flex flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5 transition-colors hover:bg-[var(--chip)]",
          builtInActive && "ring-1 ring-[var(--secondary)]",
        )}
        style={{ boxShadow: "var(--shadow-chip)" }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-5 w-5 shrink-0 text-[var(--secondary)]" />
            <h3 className="font-serif-display m-0 text-2xl text-[var(--fg)]">Built-in prompt</h3>
            <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--subtle)]">
              default
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Toggle checked={builtInActive} onChange={() => setActive(null)} label="Use the built-in prompt" />
            <span className="text-xs text-[var(--muted)]">{builtInActive ? "Active" : "Use"}</span>
          </div>
        </div>
        <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--muted)]">
          The Main Agent's original system prompt with the full tool set and default behavior.
        </p>
      </article>

      {prompts.length === 0 ? (
        <EmptyState icon={<FileText className="h-8 w-8" />}>
          No custom system prompts yet. Create one to customize the Main Agent's instructions.
        </EmptyState>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {prompts.map((prompt) => {
            const isActive = prompt.id === activeId;
            return (
              <li key={prompt.id}>
                <article
                  className={cn(
                    "flex h-full flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5 transition-colors hover:bg-[var(--chip)]",
                    isActive && "ring-1 ring-[var(--secondary)]",
                  )}
                  style={{ boxShadow: "var(--shadow-chip)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-serif-display m-0 text-2xl text-[var(--fg)]">{prompt.name}</h3>
                  </div>
                  <p className="line-clamp-2 m-0 mt-2 text-sm leading-relaxed text-[var(--muted)]">
                    {prompt.description || "No description."}
                  </p>

                  <div className="mt-3 flex items-center gap-2">
                    <Toggle
                      checked={isActive}
                      onChange={(v) => setActive(v ? prompt.id : null)}
                      label={isActive ? "Active prompt" : "Use this prompt"}
                    />
                    <span className="text-xs text-[var(--muted)]">{isActive ? "Active" : "Use"}</span>
                  </div>

                  <div className="mt-4 flex items-center gap-1.5 border-t border-[var(--border)] pt-3">
                    <Button
                      variant="ghost"
                      className="px-2"
                      onClick={() => {
                        setError(null);
                        setTemplateError(null);
                        setDraft({
                          id: prompt.id,
                          name: prompt.name,
                          description: prompt.description,
                          content: prompt.content,
                        });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 text-[var(--subtle)] hover:text-[var(--danger)]"
                      onClick={() => deletePrompt(prompt.id)}
                      title="Delete system prompt"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setError(null);
            setTemplateError(null);
            setDraft(empty());
          }}
        >
          <Plus className="h-4 w-4" /> Create system prompt
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> Import from file
        </Button>
      </div>

      <ImportMainAgentPromptsModal open={importOpen} onClose={() => setImportOpen(false)} />

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        icon={<FileText className="h-4 w-4" />}
        title={draft?.id ? "Edit system prompt" : "New system prompt"}
        size="lg"
        footer={
          <Button onClick={save}>
            <Check className="h-4 w-4" /> Save
          </Button>
        }
      >
        {draft && (
          <div className="space-y-4 p-5">
            <Field
              label="Prompt name"
              hint={`${draft.name.length}/${NAME_MAX}`}
              hintError={draft.name.length > NAME_MAX}
            >
              <TextInput
                value={draft.name}
                maxLength={NAME_MAX}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Concise Reviewer"
              />
            </Field>
            <Field
              label="Short description (optional)"
              hint={`${draft.description.length}/${DESC_MAX}`}
              hintError={draft.description.length > DESC_MAX}
            >
              <TextArea
                rows={2}
                maxLength={DESC_MAX}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="A short summary of what this prompt changes."
              />
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  System prompt
                  {templateLoading && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--subtle)]">
                      <RefreshCw className="h-3 w-3 animate-spin" /> loading default…
                    </span>
                  )}
                </span>
              }
              hint="no limit"
            >
              <div className="mb-1.5 flex items-center justify-end">
                <button
                  type="button"
                  onClick={reloadDefault}
                  disabled={templateLoading}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:border-[var(--secondary)] disabled:opacity-50"
                  title="Reload the built-in Main Agent system prompt into the editor"
                >
                  <RotateCcw className={cn("h-3 w-3", templateLoading && "animate-spin")} />
                  Reload default prompt
                </button>
              </div>
              <TextArea
                rows={14}
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                className="font-mono text-xs"
                placeholder="The Main Agent's full system prompt (pre-filled with the built-in prompt — edit freely)."
              />
              <p className="mt-1 text-[10px] text-[var(--subtle)]">
                Pre-filled with the built-in Main Agent prompt as a template. Edit, add, or remove
                instructions — the active prompt is used verbatim by the Main Agent for future runs.
              </p>
              {templateError && <p className="mt-1 text-[10px] text-[var(--danger)]">{templateError}</p>}
            </Field>

            {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
