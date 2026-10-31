import { useRef, useState } from "react";
import { Check, FilePlus2, FileText, FolderTree, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { ImportSkillsModal } from "@/components/panels/ImportSkillsModal";
import { useStore } from "@/store/useStore";
import type { SkillFile } from "@/types";
import { Modal } from "@/components/ui/Modal";
import { Button, Field, PanelHeader, TextArea, TextInput, Toggle } from "@/components/ui/primitives";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_MAX = 70;
const DESC_MAX = 300;

/** Replace any whitespace the user types in a skill name with a hyphen (skill names allow no spaces). */
function sanitizeSkillName(raw: string): string {
  return raw.replace(/\s/g, "-");
}

/** Built-in default skills have ids prefixed with "default-" and can never be deleted. */
function isDefaultSkill(id: string): boolean {
  return id.startsWith("default-");
}

interface DraftFile extends SkillFile {
  key: string;
}
interface Draft {
  id: string | null;
  name: string;
  description: string;
  skillFile: string;
  skillContent: string;
  files: DraftFile[];
  enabled: boolean;
}

let keySeq = 0;
const nextKey = () => `f${++keySeq}`;
const empty = (): Draft => ({ id: null, name: "", description: "", skillFile: "SKILL.md", skillContent: "", files: [], enabled: true });

export function SkillsPanel() {
  const skills = useStore((s) => s.skills);
  const addSkill = useStore((s) => s.addSkill);
  const updateSkill = useStore((s) => s.updateSkill);
  const deleteSkill = useStore((s) => s.deleteSkill);
  const toggleSkill = useStore((s) => s.toggleSkill);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const save = () => {
    if (!draft) return;
    const skillFile = draft.skillFile.trim() || "SKILL.md";
    const name = draft.name.trim();
    if (!name) return setError("A name is required.");
    if (!NAME_PATTERN.test(name)) return setError("Name must be lowercase letters/numbers with single hyphens, e.g. git-workflow.");
    if (name.length > NAME_MAX) return setError(`Name must be ${NAME_MAX} characters or fewer.`);
    if (!draft.description.trim()) return setError("A description is required.");
    if (draft.description.length > DESC_MAX) return setError(`Description must be ${DESC_MAX} characters or fewer.`);
    const clash = skills.some((s) => s.id !== draft.id && s.name.trim().toLowerCase() === name.toLowerCase());
    if (clash) return setError(`A skill named "${name}" already exists.`);

    const seen = new Set([skillFile.toLowerCase()]);
    const files: SkillFile[] = [];
    for (const f of draft.files) {
      const path = f.path.trim().replace(/^[\\/]+/, "");
      if (!path) return setError("Every added file needs a file name.");
      if (seen.has(path.toLowerCase())) return setError(`Duplicate file path "${path}". File paths must be unique.`);
      seen.add(path.toLowerCase());
      files.push({ path, content: f.content });
    }

    const payload = { name, description: draft.description, skillFile, skillContent: draft.skillContent, files, enabled: draft.enabled };
    if (draft.id) updateSkill(draft.id, payload);
    else addSkill(payload);
    setDraft(null);
    setError(null);
  };

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <PanelHeader kicker="Named ways of working" title="Skills" />
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Reusable, packaged capabilities the agent can load on demand — a folder with an entry
        SKILL.md plus any supporting files.
      </p>

      {skills.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-dashed border-[var(--border)] py-12 text-center">
          <Sparkles className="h-8 w-8 text-[var(--subtle)]" />
          <p className="text-sm text-[var(--muted)]">No skills yet.</p>
        </div>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-[var(--radius-xl)] bg-[var(--bg)] p-0" style={{ boxShadow: "var(--shadow-chip)" }}>
          {skills.map((skill) => (
            <li key={skill.id} className="group flex items-start gap-4 border-b border-[var(--border)] px-5 py-4 transition-colors last:border-b-0 hover:bg-[var(--chip)]">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--chip)] text-[var(--fg)]">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 flex items-center gap-2 text-sm font-medium">
                  <span className="font-mono text-[var(--fg)]">{skill.name}</span>
                  {!skill.enabled && <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--subtle)]">disabled</span>}
                </p>
                <p className="line-clamp-2 m-0 mt-1 text-sm leading-relaxed text-[var(--muted)]">{skill.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                    <FileText className="h-2.5 w-2.5" />
                    {skill.skillFile || "SKILL.md"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
                    <FolderTree className="h-2.5 w-2.5" />
                    {1 + skill.files.length} file(s)
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {isDefaultSkill(skill.id) && <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--subtle)]">default</span>}
                <Toggle checked={skill.enabled} onChange={() => toggleSkill(skill.id)} />
                <button onClick={() => { setError(null); setDraft({ id: skill.id, name: skill.name, description: skill.description, skillFile: skill.skillFile || "SKILL.md", skillContent: skill.skillContent, files: skill.files.map((f) => ({ ...f, key: nextKey() })), enabled: skill.enabled }); }} title="Edit" className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:bg-[var(--chip-hover)] hover:text-[var(--fg)]">
                  <Pencil className="h-4 w-4" />
                </button>
                {/* Only user- or LLM-created skills can be deleted; built-in defaults cannot. */}
                {!isDefaultSkill(skill.id) && (
                  <button onClick={() => deleteSkill(skill.id)} title="Delete" className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:text-[var(--danger)]">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => { setError(null); setDraft(empty()); }}>
          <Plus className="h-4 w-4" /> New skill
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> Import skill
        </Button>
      </div>

      <ImportSkillsModal open={importOpen} onClose={() => setImportOpen(false)} />

      <SkillEditor draft={draft} error={error} setDraft={setDraft} onClose={() => setDraft(null)} onSave={save} />
    </div>
  );
}

function SkillEditor({ draft, error, setDraft, onClose, onSave }: { draft: Draft | null; error: string | null; setDraft: (d: Draft) => void; onClose: () => void; onSave: () => void }) {
  const entryInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<Draft>) => draft && setDraft({ ...draft, ...p });

  const uploadEntry = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file || !draft) return;
    patch({ skillFile: file.name, skillContent: await file.text() });
  };

  const uploadFiles = async (list: FileList | null) => {
    if (!list || !draft) return;
    const added: DraftFile[] = [];
    for (const file of Array.from(list)) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      const path = rel && rel.trim() ? rel : file.name;
      added.push({ key: nextKey(), path, content: await file.text() });
    }
    patch({ files: [...draft.files, ...added] });
  };

  return (
    <Modal open={Boolean(draft)} onClose={onClose} icon={<Sparkles className="h-4 w-4" />} title={draft?.id ? "Edit skill" : "New skill"} size="lg" footer={<Button onClick={onSave}><Check className="h-4 w-4" /> Save</Button>}>
      {draft && (
        <div className="space-y-4 p-5">
          <Field label="Skill name" hint={`${draft.name.length}/${NAME_MAX}`} hintError={draft.name.length > NAME_MAX}>
            <TextInput value={draft.name} maxLength={NAME_MAX} onChange={(e) => patch({ name: sanitizeSkillName(e.target.value) })} placeholder="e.g. git-workflow" className="font-mono" />
          </Field>
          <Field label="Short description" hint={`${draft.description.length}/${DESC_MAX}`} hintError={draft.description.length > DESC_MAX}>
            <TextArea rows={2} maxLength={DESC_MAX} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
          </Field>

          <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Skill file (entry)</span>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => entryInput.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Upload file
              </Button>
              <input ref={entryInput} type="file" accept=".md,.markdown,text/markdown,text/plain" hidden onChange={(e) => { uploadEntry(e.target.files); e.target.value = ""; }} />
            </div>
            <TextInput value={draft.skillFile} onChange={(e) => patch({ skillFile: e.target.value })} placeholder="SKILL.md" className="mb-2 font-mono" />
            <TextArea rows={8} value={draft.skillContent} onChange={(e) => patch({ skillContent: e.target.value })} className="font-mono text-xs" placeholder="---&#10;name: my-skill&#10;description: …&#10;---&#10;&#10;# My Skill" />
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--muted)]">Additional files &amp; folders</span>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => filesInput.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Upload files
              </Button>
              <input ref={filesInput} type="file" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
            </div>
            <div className="space-y-3">
              {draft.files.map((f) => (
                <div key={f.key} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
                  <div className="mb-1.5 flex items-center gap-2">
                    <FilePlus2 className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                    <TextInput value={f.path} onChange={(e) => patch({ files: draft.files.map((x) => (x.key === f.key ? { ...x, path: e.target.value } : x)) })} placeholder="references/guide.md" className="font-mono text-xs" />
                    <button onClick={() => patch({ files: draft.files.filter((x) => x.key !== f.key) })} className="shrink-0 text-[var(--subtle)] hover:text-[var(--danger)]">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <TextArea rows={4} value={f.content} onChange={(e) => patch({ files: draft.files.map((x) => (x.key === f.key ? { ...x, content: e.target.value } : x)) })} className="font-mono text-xs" />
                </div>
              ))}
              <Button variant="outline" onClick={() => patch({ files: [...draft.files, { key: nextKey(), path: "", content: "" }] })}>
                <Plus className="h-3.5 w-3.5" /> Add file or folder
              </Button>
            </div>
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
