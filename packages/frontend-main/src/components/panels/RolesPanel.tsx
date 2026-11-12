import { useRef, useState } from "react";
import { Check, FileText, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { RoleIcon } from "@/components/icons/NavIcons";
import { useStore } from "@/store/useStore";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, PanelHeader, TextArea, TextInput, Toggle } from "@/components/ui/primitives";

const NAME_MAX = 120;
const DESC_MAX = 500;

function sizeLabel(content: string): string {
  const bytes = new TextEncoder().encode(content).length;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

interface Draft {
  id: string | null;
  name: string;
  description: string;
  roleFile: string;
  content: string;
  enabled: boolean;
}

const empty = (): Draft => ({
  id: null,
  name: "",
  description: "",
  roleFile: "role.md",
  content: "",
  enabled: true,
});

export function RolesPanel() {
  const roles = useStore((s) => s.roles);
  const addRole = useStore((s) => s.addRole);
  const updateRole = useStore((s) => s.updateRole);
  const deleteRole = useStore((s) => s.deleteRole);
  const toggleRole = useStore((s) => s.toggleRole);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return setError("A role name is required.");
    if (name.length > NAME_MAX) return setError(`Name must be ${NAME_MAX} characters or fewer.`);
    if (!draft.description.trim()) return setError("A description is required.");
    if (draft.description.length > DESC_MAX)
      return setError(`Description must be ${DESC_MAX} characters or fewer.`);
    if (!draft.content.trim()) return setError("The role.md document is required.");
    const clash = roles.some(
      (r) => r.id !== draft.id && r.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) return setError(`A role named "${name}" already exists.`);

    const payload = {
      name,
      description: draft.description.trim(),
      roleFile: draft.roleFile.trim() || "role.md",
      content: draft.content,
      enabled: draft.enabled,
    };
    if (draft.id) updateRole(draft.id, payload);
    else addRole(payload);
    setDraft(null);
    setError(null);
  };

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <PanelHeader kicker="Personas the agent can adopt" title="Roles" />
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Author a role.md describing who the agent should be. Attach one or more roles to a prompt
        with the “/” menu and the agent will act as them.
      </p>

      {roles.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-dashed border-[var(--border)] py-12 text-center">
          <RoleIcon className="h-8 w-8 text-[var(--subtle)]" />
          <p className="text-sm text-[var(--muted)]">No roles yet.</p>
        </div>
      ) : (
        <ul
          className="m-0 list-none overflow-hidden rounded-[var(--radius-xl)] bg-[var(--bg)] p-0"
          style={{ boxShadow: "var(--shadow-chip)" }}
        >
          {roles.map((r) => (
            <li
              key={r.id}
              className="group flex items-start gap-4 border-b border-[var(--border)] px-5 py-4 transition-colors last:border-b-0 hover:bg-[var(--chip)]"
            >
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--chip)] text-[var(--fg)]">
                <RoleIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 flex items-center gap-2 text-sm font-medium">
                  <span className="font-mono text-[var(--fg)]">{r.name}</span>
                  {!r.enabled && (
                    <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--subtle)]">
                      disabled
                    </span>
                  )}
                </p>
                <p className="line-clamp-2 m-0 mt-1 text-sm leading-relaxed text-[var(--muted)]">
                  {r.description}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                    <FileText className="h-2.5 w-2.5" />
                    {r.roleFile || "role.md"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                    {sizeLabel(r.content)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Toggle checked={r.enabled} onChange={() => toggleRole(r.id)} />
                <button
                  onClick={() => {
                    setError(null);
                    setDraft({
                      id: r.id,
                      name: r.name,
                      description: r.description,
                      roleFile: r.roleFile || "role.md",
                      content: r.content,
                      enabled: r.enabled,
                    });
                  }}
                  title="Edit"
                  className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:bg-[var(--chip-hover)] hover:text-[var(--fg)]"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => deleteRole(r.id)}
                  title="Delete"
                  className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:text-[var(--danger)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setError(null);
            setDraft(empty());
          }}
        >
          <Plus className="h-4 w-4" /> New role
        </Button>
      </div>

      <RoleEditor
        draft={draft}
        error={error}
        setDraft={setDraft}
        onClose={() => setDraft(null)}
        onSave={save}
      />
    </div>
  );
}

function RoleEditor({
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
  const fileInput = useRef<HTMLInputElement>(null);
  const patch = (p: Partial<Draft>) => draft && setDraft({ ...draft, ...p });

  const upload = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file || !draft) return;
    patch({ roleFile: file.name, content: await file.text() });
  };

  return (
    <Modal
      open={Boolean(draft)}
      onClose={onClose}
      icon={<RoleIcon className="h-5 w-5" />}
      title={draft?.id ? "Edit role" : "New role"}
      size="lg"
      footer={
        <Button onClick={onSave}>
          <Check className="h-4 w-4" /> Save
        </Button>
      }
    >
      {draft && (
        <div className="space-y-4 p-5">
          <Field
            label="Role name"
            hint={`${draft.name.length}/${NAME_MAX}`}
            hintError={draft.name.length > NAME_MAX}
          >
            <TextInput
              value={draft.name}
              maxLength={NAME_MAX}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. Senior code reviewer"
            />
          </Field>
          <Field
            label="Short description"
            hint={`${draft.description.length}/${DESC_MAX}`}
            hintError={draft.description.length > DESC_MAX}
          >
            <TextArea
              rows={2}
              maxLength={DESC_MAX}
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="What this role is and when the agent should act as it."
            />
          </Field>

          <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Role file</span>
              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                onClick={() => fileInput.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" /> Upload file
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                hidden
                onChange={(e) => {
                  upload(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <TextInput
              value={draft.roleFile}
              onChange={(e) => patch({ roleFile: e.target.value })}
              placeholder="role.md"
              className="mb-2 font-mono"
            />
            <TextArea
              rows={12}
              value={draft.content}
              onChange={(e) => patch({ content: e.target.value })}
              className="font-mono text-xs"
              placeholder={"# Role\n\nYou are a ..."}
            />
          </div>

          <div className="flex items-center gap-2">
            <Toggle checked={draft.enabled} onChange={(v) => patch({ enabled: v })} />
            <span className="text-sm text-[var(--muted)]">Enabled</span>
          </div>
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        </div>
      )}
    </Modal>
  );
}