import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  FileText,
  Loader2,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { Modal } from "@/components/ui/Modal";
import { Button, EmptyState, Field, PanelHeader, Select, TextArea, TextInput } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";
import {
  ARTIFACT_TYPES,
  deleteArtifact,
  duplicateArtifact,
  fetchArtifact,
  fetchArtifacts,
  pinArtifact,
  updateArtifact,
  type ArtifactMeta,
  type ArtifactType,
} from "@/lib/artifacts";

/**
 * Artifacts panel — browse the files the agent saved as artifacts, preview their raw content,
 * and edit, pin, duplicate, or delete them. Artifacts live as plain files under
 * ".mythgram/artifacts/" so the agent (and the user) can edit them directly.
 */
export function ArtifactsPanel() {
  const artifacts = useStore((s) => s.artifacts);
  const setArtifacts = useStore((s) => s.setArtifacts);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ meta: ArtifactMeta; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editing, setEditing] = useState<ArtifactMeta | null>(null);

  const load = useCallback(async () => {
    try {
      setArtifacts(await fetchArtifacts());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [setArtifacts]);

  useEffect(() => {
    // Initial data fetch; every state update happens after the awaited network I/O.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  const refresh = async () => {
    setLoading(true);
    await load();
  };

  const openPreview = async (meta: ArtifactMeta) => {
    setMenuId(null);
    setPreviewLoading(true);
    setError(null);
    try {
      const full = await fetchArtifact(meta.id);
      setPreview({ meta, content: full.content });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const togglePin = async (meta: ArtifactMeta) => {
    setMenuId(null);
    setBusyId(meta.id);
    setError(null);
    try {
      await pinArtifact(meta.id, !meta.pinned);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (meta: ArtifactMeta) => {
    setMenuId(null);
    setBusyId(meta.id);
    setError(null);
    try {
      await duplicateArtifact(meta.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (meta: ArtifactMeta) => {
    setMenuId(null);
    if (!window.confirm(`Delete the artifact "${meta.title}"? This removes its file too.`)) return;
    setBusyId(meta.id);
    setError(null);
    try {
      await deleteArtifact(meta.id);
      if (preview?.meta.id === meta.id) setPreview(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 panel-in">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PanelHeader kicker="Saved by the agent" title="Artifacts" />
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            Files the agent saved as artifacts. Click a card to preview its raw content, or use the
            menu to edit, pin, duplicate, or delete. Files live under{" "}
            <span className="font-mono">.mythgram/artifacts/</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 text-xs font-medium text-[var(--fg)] transition-colors hover:bg-[var(--chip-hover)] disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <div
              key={key}
              className="h-40 animate-pulse rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)]"
            />
          ))}
        </div>
      ) : artifacts.length === 0 ? (
        <EmptyState icon={<FileText className="h-8 w-8" />}>
          No artifacts yet. Ask the agent to save a deliverable and it will appear here.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {artifacts.map((meta) => (
            <article
              key={meta.id}
              className="group relative flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] p-3 transition-colors hover:border-[var(--secondary)]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--chip)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {meta.pinned && <Pin className="h-3 w-3 text-[var(--secondary)]" />}
                  {typeLabel(meta.type)}
                </span>
                <CardMenu
                  open={menuId === meta.id}
                  busy={busyId === meta.id}
                  pinned={meta.pinned}
                  onToggle={() => setMenuId((id) => (id === meta.id ? null : meta.id))}
                  onEdit={() => {
                    setMenuId(null);
                    setEditing(meta);
                  }}
                  onPin={() => void togglePin(meta)}
                  onDuplicate={() => void duplicate(meta)}
                  onDelete={() => void remove(meta)}
                />
              </div>

              <button
                type="button"
                onClick={() => void openPreview(meta)}
                className="min-w-0 flex-1 text-left"
              >
                <h3 className="truncate text-sm font-semibold text-[var(--fg)]">{meta.title}</h3>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-[var(--muted)]">
                  {meta.description || "No description."}
                </p>
              </button>

              <div className="mt-auto flex items-center justify-between gap-2 text-[10px] text-[var(--subtle)]">
                <span className="min-w-0 truncate font-mono">{meta.file}</span>
                <span className="shrink-0">{formatBytes(meta.sizeBytes)}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <PreviewModal
        preview={preview}
        loading={previewLoading}
        onClose={() => setPreview(null)}
        onEdit={() => {
          if (!preview) return;
          setEditing(preview.meta);
        }}
      />

      <EditArtifactModal
        key={editing?.id ?? "none"}
        artifact={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    </div>
  );
}

/** The 3-dots card menu: edit, pin, duplicate, delete. */
function CardMenu({
  open,
  busy,
  pinned,
  onToggle,
  onEdit,
  onPin,
  onDuplicate,
  onDelete,
}: {
  open: boolean;
  busy: boolean;
  pinned: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onPin: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        title="Artifact options"
        aria-label="Artifact options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors hover:bg-[var(--chip)] hover:text-[var(--fg)] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={onToggle} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] py-1 pop-in"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="Edit" onClick={onEdit} />
            <MenuItem
              icon={pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              label={pinned ? "Unpin" : "Pin"}
              onClick={onPin}
            />
            <MenuItem icon={<Copy className="h-3.5 w-3.5" />} label="Duplicate" onClick={onDuplicate} />
            <MenuItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Delete"
              danger
              onClick={onDelete}
            />
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--chip)]",
        danger ? "text-[var(--danger)]" : "text-[var(--fg)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Read-only raw-content preview, opened by clicking a card. */
function PreviewModal({
  preview,
  loading,
  onClose,
  onEdit,
}: {
  preview: { meta: ArtifactMeta; content: string } | null;
  loading: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard failures
    }
  };

  return (
    <Modal
      open={preview !== null || loading}
      onClose={onClose}
      icon={<FileText className="h-4 w-4" />}
      title={preview?.meta.title ?? "Loading artifact..."}
      size="xl"
      actions={
        preview ? (
          <>
            <button
              type="button"
              onClick={() => void copy()}
              title="Copy content"
              className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--chip)] hover:text-[var(--fg)]"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
            <Button variant="outline" onClick={onEdit} className="px-2.5 py-1.5 text-xs">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </>
        ) : undefined
      }
    >
      {preview ? (
        <div className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-semibold uppercase tracking-wide text-[var(--muted)]">
              {typeLabel(preview.meta.type)}
            </span>
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[var(--muted)]">
              {preview.meta.file}
            </span>
            <span className="text-[var(--subtle)]">{formatBytes(preview.meta.sizeBytes)}</span>
          </div>
          {preview.meta.description.trim().length > 0 && (
            <p className="text-xs leading-relaxed text-[var(--muted)]">{preview.meta.description}</p>
          )}
          <pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 font-mono text-[12px] leading-relaxed text-[var(--fg)]">
            {preview.content.length > 0 ? preview.content : "(empty artifact)"}
          </pre>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading artifact...
        </div>
      )}
    </Modal>
  );
}

/** Metadata + content editor. Mounted per artifact (keyed) so its fields reset naturally. */
function EditArtifactModal({
  artifact,
  onClose,
  onSaved,
}: {
  artifact: ArtifactMeta | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(artifact?.title ?? "");
  const [description, setDescription] = useState(artifact?.description ?? "");
  const [type, setType] = useState<ArtifactType>(artifact?.type ?? "text");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingContent, setLoadingContent] = useState(artifact !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!artifact) return;
    let cancelled = false;
    void fetchArtifact(artifact.id)
      .then((full) => {
        if (!cancelled) setContent(full.content);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact]);

  const save = async () => {
    if (!artifact) return;
    setBusy(true);
    setError(null);
    try {
      await updateArtifact(artifact.id, { title, description, type, content });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={artifact !== null}
      onClose={onClose}
      icon={<Pencil className="h-4 w-4" />}
      title="Edit artifact"
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || loadingContent}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <Field label="Title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Artifact title" />
        </Field>
        <Field label="Description">
          <TextArea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this artifact contains"
          />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as ArtifactType)}>
            {ARTIFACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Content" hint={`${content.length} chars`}>
          <TextArea
            rows={16}
            value={loadingContent ? "Loading..." : content}
            disabled={loadingContent}
            onChange={(e) => setContent(e.target.value)}
            className="font-mono text-xs"
          />
        </Field>
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </Modal>
  );
}

function typeLabel(type: ArtifactType): string {
  return type.replace(/_/g, " ");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
