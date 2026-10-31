import { useState } from "react";
import { Brain, Lock, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/store/useStore";
import type { MemoryFile } from "@/types";
import {
  MEMORY_ROOT,
  canonicalMemoryPath,
  isPreaddedMemory,
  memoryCharLimit,
} from "@/lib/defaultMemory";
import { cn } from "@/utils/cn";
import { Modal } from "@/components/ui/Modal";
import { Button, EmptyState, Field, PanelHeader, TextArea, TextInput } from "@/components/ui/primitives";

interface Draft {
  originalPath: string;
  path: string;
  content: string;
  isNew: boolean;
}

export function MemoryPanel() {
  const memory = useStore((s) => s.memory);
  const saveMemoryFile = useStore((s) => s.saveMemoryFile);
  const deleteMemoryFile = useStore((s) => s.deleteMemoryFile);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openNew = () => {
    setError(null);
    setDraft({ originalPath: "", path: "", content: "", isNew: true });
  };
  const openEdit = (f: MemoryFile) => {
    setError(null);
    setDraft({ originalPath: f.path, path: f.path, content: f.content, isNew: false });
  };
  const close = () => {
    setDraft(null);
    setError(null);
  };

  const save = () => {
    if (!draft) return;
    const path = draft.path.trim();
    if (!path) return setError("A file path is required.");
    const limit = memoryCharLimit(path);
    if (limit != null && draft.content.length > limit) {
      return setError(
        `${canonicalMemoryPath(path)} is limited to ${limit} characters (currently ${draft.content.length}).`,
      );
    }
    const err = saveMemoryFile(path, draft.content, draft.isNew ? undefined : draft.originalPath);
    if (err) return setError(err);
    close();
  };

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <PanelHeader kicker="Kept across threads" title="Memory" />
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Durable notes the agent keeps and maintains across every conversation. The four core files
        (MEMORY.md, SOUL.md, USER.md, session-memory.md) load at the start of each chat and cannot be deleted.
      </p>

      {memory.length === 0 ? (
        <EmptyState icon={<Brain className="h-8 w-8" />}>No memory files.</EmptyState>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-[var(--radius-xl)] bg-[var(--bg)] p-0" style={{ boxShadow: "var(--shadow-chip)" }}>
          {memory.map((f) => {
            const core = isPreaddedMemory(f.path);
            const limit = memoryCharLimit(f.path);
            const over = limit != null && f.content.length > limit;
            return (
              <li key={f.path} className="group flex items-start gap-3 border-b border-[var(--border)] px-5 py-4 transition-colors last:border-b-0 hover:bg-[var(--chip)]">
                <button onClick={() => openEdit(f)} className="min-w-0 flex-1 text-left">
                  <p className="m-0 flex items-center gap-1.5 text-sm font-medium text-[var(--fg)]">
                    <span className="font-mono">{MEMORY_ROOT}{f.path}</span>
                    {core && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--secondary)] px-1.5 py-0.5 text-[10px] text-[var(--secondary)]">
                        <Lock className="h-2.5 w-2.5" /> core
                      </span>
                    )}
                  </p>
                  <p className="line-clamp-2 m-0 mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                    {f.content.trim().slice(0, 160) || "(empty)"}
                  </p>
                  <p className={cn("m-0 mt-2 text-xs tabular-nums", over ? "text-[var(--danger)]" : "text-[var(--subtle)]")}>
                    {f.content.length}
                    {limit != null ? ` / ${limit}` : ""} chars
                  </p>
                </button>
                <button
                  onClick={() => !core && deleteMemoryFile(f.path)}
                  disabled={core}
                  title={core ? "Core files cannot be deleted" : "Delete"}
                  className="mt-1 shrink-0 text-[var(--subtle)] transition hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4">
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> New memory file
        </Button>
      </div>

      <MemoryEditor draft={draft} error={error} setDraft={setDraft} onClose={close} onSave={save} />
    </div>
  );
}

function MemoryEditor({
  draft,
  error,
  setDraft,
  onClose,
  onSave,
}: {
  draft: Draft | null;
  error: string | null;
  setDraft: (d: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const core = draft ? isPreaddedMemory(draft.originalPath || draft.path) : false;
  const limit = draft ? memoryCharLimit(draft.path) : undefined;
  const chars = draft?.content.length ?? 0;
  const over = limit != null && chars > limit;

  return (
    <Modal
      open={Boolean(draft)}
      onClose={onClose}
      icon={<Brain className="h-4 w-4" />}
      title={draft?.isNew ? "New memory file" : "Edit memory file"}
      size="lg"
      footer={
        <Button onClick={onSave} disabled={over}>
          Save
        </Button>
      }
    >
      {draft && (
        <div className="space-y-4 p-5">
          <Field
            label="File path"
            hint={core ? "core file — fixed name" : undefined}
          >
            <TextInput
              value={draft.path}
              disabled={core}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
              placeholder="e.g. preferences.md or projects/app.md"
              className="font-mono"
            />
          </Field>
          <Field label="Content" hint={`${chars}${limit != null ? `/${limit}` : ""} chars`} hintError={over}>
            <TextArea rows={16} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} className="font-mono text-xs" />
          </Field>
          {over && <p className="text-xs text-[var(--danger)]">Over the {limit}-character limit by {chars - (limit ?? 0)}. Shorten to save.</p>}
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
