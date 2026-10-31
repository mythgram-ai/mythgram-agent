import { useMemo, useState } from "react";
import { Crown, Plus, Pencil, Trash2, Users, Info } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Modal } from "@/components/ui/Modal";
import {
  Button,
  EmptyState,
  Field,
  PanelHeader,
  TextArea,
  TextInput,
  Toggle,
} from "@/components/ui/primitives";
import { blankCeo } from "@/lib/defaultCeo";
import type { AgentTeam, CeoAgent } from "@/types";
import { cn } from "@/utils/cn";

export function CeoPanel() {
  const ceoAgents = useStore((s) => s.ceoAgents);
  const teams = useStore((s) => s.agentTeams);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const addCeo = useStore((s) => s.addCeo);
  const updateCeo = useStore((s) => s.updateCeo);
  const deleteCeo = useStore((s) => s.deleteCeo);
  const setActiveCeo = useStore((s) => s.setActiveCeo);

  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<CeoAgent | null>(null);
  const [isNew, setIsNew] = useState(false);

  const ceoEnabled = settings.enableCeoAgents === "yes";

  const openCreate = () => {
    setDraft(blankCeo());
    setIsNew(true);
    setEditorOpen(true);
  };

  const openEdit = (ceo: CeoAgent) => {
    setDraft({ ...ceo, teamIds: [...ceo.teamIds] });
    setIsNew(false);
    setEditorOpen(true);
  };

  const save = (ceo: CeoAgent) => {
    if (isNew) addCeo(ceo);
    else updateCeo(ceo.id, ceo);
    setEditorOpen(false);
    setDraft(null);
  };

  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "(deleted team)";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div className="flex items-end justify-between gap-3">
        <PanelHeader kicker="Workspace" title="CEO agents" />
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Create CEO agent
        </Button>
      </div>

      <p className="text-sm text-[var(--muted)]">
        A CEO agent sits above your agent teams: it controls the head/leaders of the teams you select,
        assigning them tasks while each leader coordinates their own members and reports completion
        back to the CEO. Turn a CEO on to make it active; only one CEO runs at a time, and the first
        message of your chat goes straight to the CEO.
      </p>

      {!ceoEnabled && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--secondary)_35%,var(--border))] bg-[color:color-mix(in_oklab,var(--secondary)_8%,transparent)] p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--secondary)]" />
          <div className="flex-1">
            <p className="text-[var(--fg)]">The CEO multi-agent system is currently disabled.</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Enable it to route your chats through the active CEO agent.
            </p>
          </div>
          <Button variant="outline" onClick={() => setSettings({ enableCeoAgents: "yes" })}>
            Enable
          </Button>
        </div>
      )}

      {teams.length === 0 && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]" />
          <p className="text-[var(--muted)]">
            You have no agent teams yet. Create one or more teams on the “Agent teams” page first — a
            CEO controls the teams you select here.
          </p>
        </div>
      )}

      {ceoAgents.length === 0 ? (
        <EmptyState icon={<Crown className="h-8 w-8" />}>
          You have no CEO agents yet. Create one to coordinate multiple teams.
        </EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {ceoAgents.map((ceo) => (
            <li
              key={ceo.id}
              className={cn(
                "rounded-[var(--radius-lg)] border p-4",
                ceo.enabled
                  ? "border-[color:color-mix(in_oklab,var(--secondary)_45%,var(--border))] bg-[color:color-mix(in_oklab,var(--secondary)_8%,transparent)]"
                  : "border-[var(--border)] bg-[var(--card)]",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--fg)]">{ceo.name || "Untitled CEO"}</span>
                    {ceo.enabled && (
                      <span className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--secondary-fg)]">
                        Active
                      </span>
                    )}
                  </div>
                  {ceo.description && (
                    <p className="mt-1 truncate text-xs text-[var(--muted)]">{ceo.description}</p>
                  )}
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <Users className="h-3.5 w-3.5" /> {ceo.teamIds.length} team
                    {ceo.teamIds.length === 1 ? "" : "s"}
                    {ceo.teamIds.length > 0 && (
                      <span className="truncate text-[var(--subtle)]">
                        · {ceo.teamIds.map(teamName).join(", ")}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Toggle
                    checked={ceo.enabled}
                    onChange={(next) => setActiveCeo(ceo.id, next)}
                    label="Activate CEO"
                  />
                  <button
                    onClick={() => openEdit(ceo)}
                    title="Edit"
                    className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:bg-[var(--chip)] hover:text-[var(--fg)]"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => deleteCeo(ceo.id)}
                    title="Delete"
                    className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <CeoEditorModal
          open={editorOpen}
          isNew={isNew}
          initial={draft}
          teams={teams}
          onClose={() => {
            setEditorOpen(false);
            setDraft(null);
          }}
          onSave={save}
        />
      )}
    </div>
  );
}

function CeoEditorModal({
  open,
  isNew,
  initial,
  teams,
  onClose,
  onSave,
}: {
  open: boolean;
  isNew: boolean;
  initial: CeoAgent;
  teams: AgentTeam[];
  onClose: () => void;
  onSave: (ceo: CeoAgent) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt);
  const [teamIds, setTeamIds] = useState<string[]>(initial.teamIds);

  const canSave = useMemo(
    () => name.trim().length > 0 && teamIds.length > 0,
    [name, teamIds],
  );

  const toggleTeam = (id: string) =>
    setTeamIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      ...initial,
      name: name.trim(),
      description: description.trim(),
      systemPrompt,
      // Keep only ids that still reference an existing team.
      teamIds: teamIds.filter((id) => teams.some((t) => t.id === id)),
      updatedAt: Date.now(),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      align="top"
      icon={<Crown className="h-4 w-4" />}
      title={isNew ? "Create CEO agent" : "Edit CEO agent"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isNew ? "Create CEO" : "Save CEO"}
          </Button>
        </>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <Field label="CEO name (agent id)">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Vera"
          />
        </Field>

        <Field label="Short description">
          <TextInput
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Chief executive coordinating all teams"
          />
        </Field>

        <Field label="System prompt">
          <TextArea
            rows={6}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Describe how the CEO should coordinate the teams…"
          />
        </Field>

        {/* Team selection */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg)]">Teams under this CEO</h3>
            <span className="text-xs text-[var(--muted)]">
              {teamIds.length} selected
            </span>
          </div>

          {teams.length === 0 ? (
            <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--muted)]">
              No teams available. Create teams on the “Agent teams” page, then select them here.
            </p>
          ) : (
            <div className="space-y-2">
              {teams.map((team) => {
                const selected = teamIds.includes(team.id);
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => toggleTeam(team.id)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-[var(--radius-lg)] border p-3.5 text-left transition-colors",
                      selected
                        ? "border-[color:color-mix(in_oklab,var(--secondary)_45%,var(--border))] bg-[color:color-mix(in_oklab,var(--secondary)_8%,transparent)]"
                        : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--chip)]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border",
                        selected
                          ? "border-[var(--secondary)] bg-[var(--secondary)] text-[var(--secondary-fg)]"
                          : "border-[var(--border)]",
                      )}
                      aria-hidden
                    >
                      {selected && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M5 13l4 4L19 7"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[var(--fg)]">
                        {team.name || "Untitled team"}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                        Leader: {team.leaderName || "—"} · {team.members.length} member
                        {team.members.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
