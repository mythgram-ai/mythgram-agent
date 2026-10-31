import { useMemo, useState } from "react";
import { Bookmark, Check, ClipboardCopy, Pencil, Play, Plus, Search, Trash2, Upload } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Modal } from "@/components/ui/Modal";
import { ImportPromptLibraryModal } from "@/components/panels/ImportPromptLibraryModal";
import { Button, EmptyState, Field, PanelHeader, TextArea, TextInput } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

interface Draft {
  id: string | null;
  title: string;
  description: string;
  content: string;
}

const emptyDraft = (content = ""): Draft => ({ id: null, title: "", description: "", content });

/**
 * Prompt Library panel.
 *
 * Lets the user save reusable prompts (a title, an optional short
 * description — both unlimited in length — plus the prompt text itself) and
 * quickly copy them to the clipboard or insert them into the composer with
 * "Use". Entries persist in the backend SQLite database via the shared
 * app-state sync (`promptLibrary`), exactly like task modes.
 */
export function PromptLibraryPanel() {
  const items = useStore((s) => s.promptLibrary);
  const addItem = useStore((s) => s.addPromptLibraryItem);
  const updateItem = useStore((s) => s.updatePromptLibraryItem);
  const deleteItem = useStore((s) => s.deletePromptLibraryItem);
  const setComposerPrefill = useStore((s) => s.setComposerPrefill);
  const setSection = useStore((s) => s.setSection);

  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      `${item.title} ${item.description} ${item.content}`.toLowerCase().includes(q),
    );
  }, [items, query]);

  const save = () => {
    if (!draft) return;
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (!title) return setError("A title is required.");
    if (!content) return setError("The prompt text cannot be empty.");
    if (draft.id) {
      updateItem(draft.id, { title, description: draft.description.trim(), content: draft.content });
    } else {
      addItem({ title, description: draft.description.trim(), content: draft.content });
    }
    setDraft(null);
    setError(null);
  };

  const copy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      // Clipboard unavailable — no-op, the user can still select the text.
    }
  };

  const use = (content: string) => {
    setComposerPrefill(content);
    setSection("chat");
  };

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <PanelHeader kicker="Reusable prompts" title="Prompt library" />
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Save prompts you reuse so you can quickly copy them or insert them into the
        composer. Type <code className="rounded bg-[var(--chip)] px-1 font-mono text-xs">/</code> in
        the composer to pick a saved prompt, or save any chat prompt with the bookmark
        button on its message.
      </p>

      <div className="mb-4 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--subtle)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search saved prompts…"
            aria-label="Search saved prompts"
            className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] py-2.5 pl-9 pr-3 text-sm text-[var(--fg)] outline-none placeholder:text-[var(--subtle)] focus:border-[var(--secondary)]"
          />
        </div>
        <Button
          onClick={() => {
            setError(null);
            setDraft(emptyDraft());
          }}
        >
          <Plus className="h-4 w-4" /> Save prompt
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> Import
        </Button>
      </div>

      <ImportPromptLibraryModal open={importOpen} onClose={() => setImportOpen(false)} />

      {items.length === 0 ? (
        <EmptyState icon={<Bookmark className="h-8 w-8" />}>
          No saved prompts yet. Save one here, or bookmark any chat prompt to reuse it later.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search className="h-8 w-8" />}>
          No saved prompts match “{query.trim()}”.
        </EmptyState>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {filtered.map((item) => (
            <li key={item.id}>
              <article
                className="flex h-full flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5 transition-colors hover:bg-[var(--chip)]"
                style={{ boxShadow: "var(--shadow-chip)" }}
              >
                <h3 className="font-serif-display m-0 break-words text-2xl text-[var(--fg)]">
                  {item.title}
                </h3>
                <p className="line-clamp-2 m-0 mt-1 text-sm leading-relaxed text-[var(--muted)]">
                  {item.description || "No description."}
                </p>
                <p className="line-clamp-2 m-0 mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-[var(--subtle)]">
                  {item.content}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-3">
                  <Button variant="ghost" className="px-2" onClick={() => use(item.content)} title="Insert into composer">
                    <Play className="h-3.5 w-3.5" /> Use
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2"
                    onClick={() => void copy(item.id, item.content)}
                    title="Copy prompt text"
                  >
                    {copiedId === item.id ? (
                      <Check className="h-3.5 w-3.5 text-[var(--success)]" />
                    ) : (
                      <ClipboardCopy className="h-3.5 w-3.5" />
                    )}
                    {copiedId === item.id ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2"
                    onClick={() => {
                      setError(null);
                      setDraft({
                        id: item.id,
                        title: item.title,
                        description: item.description,
                        content: item.content,
                      });
                    }}
                    title="Edit saved prompt"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 text-[var(--subtle)] hover:text-[var(--danger)]"
                    onClick={() => deleteItem(item.id)}
                    title="Delete saved prompt"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        icon={<Bookmark className="h-4 w-4" />}
        title={draft?.id ? "Edit saved prompt" : "Save prompt to library"}
        size="lg"
        footer={
          <Button onClick={save}>
            <Check className="h-4 w-4" /> Save
          </Button>
        }
      >
        {draft && (
          <div className="space-y-4 p-5">
            <Field label="Title" hint="no limit">
              <TextInput
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. Weekly status report"
              />
            </Field>
            <Field label="Short description (optional)" hint="no limit">
              <TextArea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What this prompt is for."
              />
            </Field>
            <Field label="Prompt" hint="no limit">
              <TextArea
                rows={8}
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                className="font-mono text-xs"
                placeholder="The reusable prompt text…"
              />
            </Field>
            {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

/**
 * Reusable save-to-library modal used outside the panel (e.g. the bookmark
 * button on a chat prompt). Prefills the prompt text; the user just enters a
 * title and an optional short description.
 */
export function SavePromptModal({
  open,
  initialContent,
  onClose,
}: {
  open: boolean;
  initialContent: string;
  onClose: () => void;
}) {
  const addItem = useStore((s) => s.addPromptLibraryItem);
  const items = useStore((s) => s.promptLibrary);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Reset the form whenever the modal opens.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setTitle("");
      setDescription("");
      setError(null);
      setSaved(false);
    }
  }

  const save = () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) return setError("A title is required.");
    if (!initialContent.trim()) return setError("There is no prompt text to save.");
    const clash = items.some((p) => p.title.trim().toLowerCase() === cleanTitle.toLowerCase());
    if (clash) return setError(`A saved prompt titled "${cleanTitle}" already exists.`);
    addItem({ title: cleanTitle, description: description.trim(), content: initialContent });
    setError(null);
    setSaved(true);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<Bookmark className="h-4 w-4" />}
      title="Save prompt to library"
      size="md"
      footer={
        saved ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <Button onClick={save}>
            <Check className="h-4 w-4" /> Save
          </Button>
        )
      }
    >
      <div className="space-y-4 p-5">
        {saved ? (
          <p className={cn("text-sm text-[var(--success)]")}>
            Saved to your prompt library. Find it under Prompt library in the sidebar, or type{" "}
            <code className="rounded bg-[var(--chip)] px-1 font-mono text-xs">/</code> in the
            composer to reuse it.
          </p>
        ) : (
          <>
            <Field label="Title" hint="no limit">
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Weekly status report"
              />
            </Field>
            <Field label="Short description (optional)" hint="no limit">
              <TextArea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this prompt is for."
              />
            </Field>
            <Field label="Prompt" hint="saved as-is">
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 font-mono text-xs text-[var(--fg)]">
                {initialContent}
              </div>
            </Field>
            {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
