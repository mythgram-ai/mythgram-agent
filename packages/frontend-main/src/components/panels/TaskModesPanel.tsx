import { useState } from "react";
import { Check, ListChecks, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useStore } from "@/store/useStore";
import { DEFAULT_PLAN_MODE_PROMPT } from "@/lib/taskModes";
import { Modal } from "@/components/ui/Modal";
import { ImportTaskModesModal } from "@/components/panels/ImportTaskModesModal";
import { Button, EmptyState, Field, PanelHeader, TextArea, TextInput, Toggle } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

const NAME_MAX = 70;

interface Draft {
  id: string | null;
  name: string;
  prompt: string;
}

const empty = (): Draft => ({ id: null, name: "", prompt: "" });

/**
 * Task Modes page.
 *
 * Manages the prompt-box task modes: the editable plan-mode prompt plus every
 * user-created custom mode (name + appended prompt). Exactly one mode is active
 * at a time; the default mode appends nothing.
 */
export function TaskModesPanel() {
  const taskModes = useStore((s) => s.taskModes);
  const activeTaskModeId = useStore((s) => s.activeTaskModeId);
  const planModePrompt = useStore((s) => s.planModePrompt);
  const addTaskMode = useStore((s) => s.addTaskMode);
  const updateTaskMode = useStore((s) => s.updateTaskMode);
  const deleteTaskMode = useStore((s) => s.deleteTaskMode);
  const setActiveTaskMode = useStore((s) => s.setActiveTaskMode);
  const setPlanModePrompt = useStore((s) => s.setPlanModePrompt);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [planDraft, setPlanDraft] = useState(planModePrompt);
  const [planSaved, setPlanSaved] = useState(false);

  const save = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return setError("A mode name is required.");
    if (name.length > NAME_MAX) return setError(`Name must be ${NAME_MAX} characters or fewer.`);
    if (!draft.prompt.trim()) return setError("The prompt to append cannot be empty.");
    const clash = taskModes.some(
      (m) => m.id !== draft.id && m.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) return setError(`A task mode named "${name}" already exists.`);
    if (name.toLowerCase() === "plan" || name.toLowerCase() === "default") {
      return setError(`"${name}" is reserved for the built-in modes — pick another name.`);
    }

    if (draft.id) updateTaskMode(draft.id, { name, prompt: draft.prompt });
    else {
      const created = addTaskMode({ name, prompt: draft.prompt });
      setActiveTaskMode(created.id);
    }
    setDraft(null);
    setError(null);
  };

  const savePlanPrompt = () => {
    const text = planDraft.trim();
    if (!text) return;
    setPlanModePrompt(planDraft);
    setPlanSaved(true);
    setTimeout(() => setPlanSaved(false), 2000);
  };

  const resetPlanPrompt = () => {
    setPlanDraft(DEFAULT_PLAN_MODE_PROMPT);
    setPlanModePrompt(DEFAULT_PLAN_MODE_PROMPT);
  };

  const activeName =
    !activeTaskModeId || activeTaskModeId === "default"
      ? "Default"
      : activeTaskModeId === "plan"
        ? "Plan"
        : (taskModes.find((m) => m.id === activeTaskModeId)?.name ?? "Default");

  return (
    <div className="mx-auto w-full max-w-2xl panel-in">
      <PanelHeader kicker="How the prompt box behaves" title="Task modes" />
      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Pick how the agent approaches your message. Default works normally, plan makes the model
        plan first, and custom modes append your own instruction. Active mode:{" "}
        <span className="font-medium text-[var(--fg)]">{activeName}</span>.
      </p>

      <article
        className="mb-3 rounded-[var(--radius-xl)] bg-[var(--bg)] p-5"
        style={{ boxShadow: "var(--shadow-chip)" }}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-serif-display m-0 text-2xl text-[var(--fg)]">Plan mode prompt</h3>
          <Toggle
            checked={activeTaskModeId === "plan"}
            onChange={(v) => setActiveTaskMode(v ? "plan" : null)}
            label="Use plan mode"
          />
        </div>
        <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--muted)]">
          Appended to your message in plan mode. Edit it to change how the model plans.
        </p>
        <div className="mt-3 space-y-2">
          <TextArea
            rows={6}
            value={planDraft}
            onChange={(e) => setPlanDraft(e.target.value)}
            className="font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={resetPlanPrompt}>
              Reset to default
            </Button>
            <Button onClick={savePlanPrompt} disabled={!planDraft.trim()}>
              <Check className="h-4 w-4" /> {planSaved ? "Saved" : "Save plan prompt"}
            </Button>
          </div>
        </div>
      </article>

      {taskModes.length === 0 ? (
        <EmptyState icon={<ListChecks className="h-8 w-8" />}>
          No custom task modes yet. Create one to append your own instruction with one click.
        </EmptyState>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {taskModes.map((mode) => {
            const isActive = mode.id === activeTaskModeId;
            return (
              <li key={mode.id}>
                <article
                  className={cn(
                    "flex h-full flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5 hover:bg-[var(--chip)]",
                    isActive && "ring-1 ring-[var(--secondary)]",
                  )}
                  style={{ boxShadow: "var(--shadow-chip)" }}
                >
                  <h3 className="font-serif-display m-0 text-2xl text-[var(--fg)]">{mode.name}</h3>
                  <p className="line-clamp-2 m-0 mt-2 text-sm leading-relaxed text-[var(--muted)]">
                    {mode.prompt}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Toggle
                      checked={isActive}
                      onChange={(v) => setActiveTaskMode(v ? mode.id : null)}
                      label={isActive ? "Active mode" : "Use this mode"}
                    />
                    <span className="text-xs text-[var(--muted)]">{isActive ? "Active" : "Use"}</span>
                  </div>
                  <div className="mt-4 flex items-center gap-1.5 border-t border-[var(--border)] pt-3">
                    <Button
                      variant="ghost"
                      className="px-2"
                      onClick={() => {
                        setError(null);
                        setDraft({ id: mode.id, name: mode.name, prompt: mode.prompt });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 text-[var(--subtle)] hover:text-[var(--danger)]"
                      onClick={() => deleteTaskMode(mode.id)}
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
            setDraft(empty());
          }}
        >
          <Plus className="h-4 w-4" /> New custom mode
        </Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> Import from file
        </Button>
      </div>

      <ImportTaskModesModal open={importOpen} onClose={() => setImportOpen(false)} />

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        icon={<ListChecks className="h-4 w-4" />}
        title={draft?.id ? "Edit task mode" : "New task mode"}
        size="md"
        footer={
          <Button onClick={save}>
            <Check className="h-4 w-4" /> Save
          </Button>
        }
      >
        {draft && (
          <div className="space-y-4 p-5">
            <Field label="Mode name" hint={`${draft.name.length}/${NAME_MAX}`}>
              <TextInput
                value={draft.name}
                maxLength={NAME_MAX}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Review"
              />
            </Field>
            <Field label="Prompt appended to your message" hint="appended verbatim">
              <TextArea
                rows={6}
                value={draft.prompt}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                className="font-mono text-xs"
                placeholder="e.g. Review the following for bugs and list findings by severity…"
              />
            </Field>
            {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
