import { useRef, useState } from "react";
import { Check, FolderUp, ListChecks, Upload, X } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import {
  indexUploadedFiles,
  parseTaskModesImport,
  partitionAgainstExisting,
  type ImportedTaskModeDraft,
  type TaskModeImportError,
} from "@/lib/importTaskModes";
import { cn } from "@/utils/cn";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ImportTaskModesModal({ open, onClose }: Props) {
  const taskModes = useStore((s) => s.taskModes);
  const addTaskMode = useStore((s) => s.addTaskMode);
  const setActiveTaskMode = useStore((s) => s.setActiveTaskMode);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ImportedTaskModeDraft[]>([]);
  const [errors, setErrors] = useState<TaskModeImportError[]>([]);
  const [done, setDone] = useState<{ imported: number; skipped: number; activated: string | null } | null>(null);

  const reset = () => {
    setBusy(false);
    setDragOver(false);
    setGlobalError(null);
    setConfigPath(null);
    setActiveName(null);
    setDrafts([]);
    setErrors([]);
    setDone(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setGlobalError(null);
    setDone(null);
    try {
      const { filesByKey, configFile, configPath: found } = indexUploadedFiles(list);
      if (!configFile || !found) {
        setConfigPath(null);
        setActiveName(null);
        setDrafts([]);
        setErrors([]);
        setGlobalError(
          `No config.json found in the selection. Select your config.json file directly, or upload the whole folder containing it (e.g. my-modes/config.json).`,
        );
        return;
      }
      const text = await configFile.text();
      const result = await parseTaskModesImport(text, found, filesByKey);
      setConfigPath(result.configPath);
      setActiveName(result.activeName);
      setDrafts(result.drafts);
      setErrors(result.errors);
      if (result.drafts.length === 0 && result.errors.length === 0) {
        setGlobalError("Nothing to import.");
      }
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const { fresh, clashing } = partitionAgainstExisting(drafts, taskModes);

  const doImport = () => {
    if (fresh.length === 0) return;
    const createdIds = new Map<string, string>();
    for (const d of fresh) {
      const created = addTaskMode({ name: d.name, prompt: d.prompt });
      createdIds.set(created.name.trim().toLowerCase(), created.id);
    }
    // Activate the mode config.json asks for when possible: prefer the freshly
    // imported copy, otherwise the pre-existing mode with the same name. This
    // loads the system prompt so it is applied the next time the mode runs.
    let activated: string | null = null;
    if (activeName) {
      const key = activeName.trim().toLowerCase();
      const importedId = createdIds.get(key);
      if (importedId) {
        setActiveTaskMode(importedId);
        activated = activeName.trim();
      } else {
        const existing = taskModes.find((m) => m.name.trim().toLowerCase() === key);
        if (existing) {
          setActiveTaskMode(existing.id);
          activated = existing.name;
        }
      }
    }
    setDone({ imported: fresh.length, skipped: clashing.length, activated });
    setDrafts([]);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      icon={<Upload className="h-4 w-4" />}
      title="Import task modes"
      size="lg"
      footer={
        drafts.length > 0 ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={doImport} disabled={fresh.length === 0}>
              <Check className="h-4 w-4" /> Import {fresh.length > 0 ? `${fresh.length} ` : ""}mode
              {fresh.length === 1 ? "" : "s"}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-4 p-5">
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          Import task modes you created locally. Select your{" "}
          <span className="font-mono">config.json</span> file directly, or upload the whole folder
          (recommended — prompt files resolve against the folder).
        </p>

        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] p-3 font-mono text-[11px] leading-relaxed text-[var(--muted)]">
          <div>my-modes/</div>
          <div>├── config.json</div>
          <div>└── task_modes/</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;├── research_mode/</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;└── system_prompt.md</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;└── coding_mode/</div>
          <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── system_prompt.md</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Upload className="h-4 w-4" /> Choose config.json
          </Button>
          <Button variant="outline" onClick={() => folderInput.current?.click()} disabled={busy}>
            <FolderUp className="h-4 w-4" /> Choose folder
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            hidden
            // @ts-expect-error non-standard directory attributes
            webkitdirectory=""
            directory=""
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "rounded-[var(--radius-md)] border border-dashed px-4 py-6 text-center text-sm transition-colors",
            dragOver ? "border-[var(--secondary)] text-[var(--fg)]" : "border-[var(--border)] text-[var(--subtle)]",
          )}
        >
          {busy ? "Reading files…" : "Or drag & drop config.json (or the whole folder) here"}
        </div>

        {globalError && (
          <div
            className="rounded-[var(--radius-md)] border px-3 py-2 text-xs"
            style={{
              borderColor: "color-mix(in oklab, var(--danger) 35%, transparent)",
              background: "var(--danger-soft)",
              color: "var(--danger)",
            }}
          >
            {globalError}
          </div>
        )}

        {done && (
          <div
            className="rounded-[var(--radius-md)] border px-3 py-2 text-xs"
            style={{
              borderColor: "color-mix(in oklab, var(--success, #22c55e) 35%, transparent)",
              background: "color-mix(in oklab, var(--success, #22c55e) 12%, transparent)",
              color: "var(--fg)",
            }}
          >
            Imported {done.imported} mode{done.imported === 1 ? "" : "s"}
            {done.skipped > 0 ? ` (${done.skipped} skipped — name already exists).` : "."}
            {done.activated
              ? ` "${done.activated}" is now active and its prompt will be applied when the mode runs.`
              : " The active mode was left unchanged."}{" "}
            Imported modes now appear in the Task modes panel like any other mode.
          </div>
        )}

        {configPath && (drafts.length > 0 || errors.length > 0) && !done && (
          <div className="space-y-2">
            <p className="text-xs text-[var(--subtle)]">
              From <span className="font-mono">{configPath}</span>: {drafts.length} valid, {errors.length}{" "}
              with problems.
              {activeName && (
                <>
                  {" "}Requested active mode: <span className="font-mono">{activeName}</span>.
                </>
              )}
            </p>
            {drafts.length > 0 && (
              <ul className="max-h-52 space-y-1 overflow-auto">
                {drafts.map((d) => {
                  const clash = clashing.includes(d);
                  return (
                    <li
                      key={d.name}
                      className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1.5 text-xs"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--success, #22c55e)]" />
                      <span className="min-w-0 flex-1">
                        <span className="font-mono font-medium text-[var(--fg)]">{d.name}</span>
                        <span className="block truncate font-mono text-[10px] text-[var(--subtle)]">
                          {d.filePath}
                        </span>
                        {clash && (
                          <span className="block text-[10px] text-[var(--warning, #d97706)]">
                            Name already exists — will be skipped.
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {errors.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-auto">
                {errors.map((e, i) => (
                  <li
                    key={`${e.index}-${e.name}-${i}`}
                    className="flex items-start gap-2 rounded-[var(--radius-sm)] border px-2 py-1.5 text-xs"
                    style={{
                      borderColor: "color-mix(in oklab, var(--danger) 30%, transparent)",
                      color: "var(--danger)",
                    }}
                  >
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      <span className="font-mono font-medium">{e.name || `Entry #${e.index + 1}`}</span>:{" "}
                      {e.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {clashing.length > 0 && (
              <p className="text-[11px] text-[var(--warning, #d97706)]">
                {clashing.length} name{clashing.length === 1 ? "" : "s"} already exist
                {clashing.length === 1 ? "s" : ""} and will be skipped:{" "}
                <span className="font-mono">{clashing.map((c) => c.name).join(", ")}</span>
              </p>
            )}
          </div>
        )}

        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-[var(--subtle)]">
          <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Imported modes work exactly like modes you create in the app — pick one with its toggle
            and its system prompt is appended to your message when the mode runs.
          </span>
        </p>
      </div>
    </Modal>
  );
}
