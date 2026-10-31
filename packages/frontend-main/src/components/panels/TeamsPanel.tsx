import { useMemo, useState } from "react";
import { Users, Plus, Pencil, Trash2, Crown, UserPlus, X, Info } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Modal } from "@/components/ui/Modal";
import {
  Button,
  EmptyState,
  Field,
  PanelHeader,
  Select,
  TextArea,
  TextInput,
  Toggle,
} from "@/components/ui/primitives";
import { blankTeam, LEADER_PROMPT_TEMPLATES } from "@/lib/defaultTeams";
import type { AgentTeam, TeamMember } from "@/types";
import { uid } from "@/utils/id";
import { cn } from "@/utils/cn";

export function TeamsPanel() {
  const teams = useStore((s) => s.agentTeams);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const addTeam = useStore((s) => s.addTeam);
  const updateTeam = useStore((s) => s.updateTeam);
  const deleteTeam = useStore((s) => s.deleteTeam);
  const setActiveTeam = useStore((s) => s.setActiveTeam);

  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<AgentTeam | null>(null);
  const [isNew, setIsNew] = useState(false);

  const teamsEnabled = settings.enableAgentTeams === "yes";

  const openCreate = () => {
    setDraft(blankTeam());
    setIsNew(true);
    setEditorOpen(true);
  };

  const openEdit = (team: AgentTeam) => {
    setDraft({ ...team, members: team.members.map((m) => ({ ...m })) });
    setIsNew(false);
    setEditorOpen(true);
  };

  const save = (team: AgentTeam) => {
    if (isNew) addTeam(team);
    else updateTeam(team.id, team);
    setEditorOpen(false);
    setDraft(null);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div className="flex items-end justify-between gap-3">
        <PanelHeader kicker="Workspace" title="Agent teams" />
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> Create agent team
        </Button>
      </div>

      <p className="text-sm text-[var(--muted)]">
        An agent team is a head/leader plus specialist members who collaborate to complete your
        request — the leader delegates tasks, the members work independently and report back. Turn a
        team on to make it active; only one team runs at a time.
      </p>

      {!teamsEnabled && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--secondary)_35%,var(--border))] bg-[color:color-mix(in_oklab,var(--secondary)_8%,transparent)] p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--secondary)]" />
          <div className="flex-1">
            <p className="text-[var(--fg)]">Multi-agent teams are currently disabled.</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Enable them to route your chats through the active team.
            </p>
          </div>
          <Button variant="outline" onClick={() => setSettings({ enableAgentTeams: "yes" })}>
            Enable
          </Button>
        </div>
      )}

      {teams.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8" />}>
          You have no agent teams yet. Create one to get started.
        </EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {teams.map((team) => (
            <li
              key={team.id}
              className={cn(
                "rounded-[var(--radius-lg)] border p-4",
                team.enabled
                  ? "border-[color:color-mix(in_oklab,var(--secondary)_45%,var(--border))] bg-[color:color-mix(in_oklab,var(--secondary)_8%,transparent)]"
                  : "border-[var(--border)] bg-[var(--card)]",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--fg)]">{team.name || "Untitled team"}</span>
                    {team.enabled && (
                      <span className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--secondary-fg)]">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <Crown className="h-3.5 w-3.5" /> {team.leaderName || "No leader"} · {team.members.length}{" "}
                    member{team.members.length === 1 ? "" : "s"}
                  </p>
                  {team.members.length > 0 && (
                    <p className="mt-1 truncate text-xs text-[var(--subtle)]">
                      {team.members.map((m) => m.name).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Toggle
                    checked={team.enabled}
                    onChange={(next) => setActiveTeam(team.id, next)}
                    label="Activate team"
                  />
                  <button
                    onClick={() => openEdit(team)}
                    title="Edit"
                    className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:bg-[var(--chip)] hover:text-[var(--fg)]"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => deleteTeam(team.id)}
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
        <TeamEditorModal
          open={editorOpen}
          isNew={isNew}
          initial={draft}
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

function TeamEditorModal({
  open,
  isNew,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  isNew: boolean;
  initial: AgentTeam;
  onClose: () => void;
  onSave: (team: AgentTeam) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [leaderName, setLeaderName] = useState(initial.leaderName);
  const [leaderPrompt, setLeaderPrompt] = useState(initial.leaderSystemPrompt);
  const [members, setMembers] = useState<TeamMember[]>(initial.members);

  const canSave = useMemo(
    () => name.trim().length > 0 && leaderName.trim().length > 0,
    [name, leaderName],
  );

  const addMember = () =>
    setMembers((ms) => [...ms, { id: uid("tm"), name: "", description: "", systemPrompt: "" }]);

  const updateMember = (id: string, patch: Partial<TeamMember>) =>
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const removeMember = (id: string) => setMembers((ms) => ms.filter((m) => m.id !== id));

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      ...initial,
      name: name.trim(),
      leaderName: leaderName.trim(),
      leaderSystemPrompt: leaderPrompt,
      members: members
        .filter((m) => m.name.trim().length > 0)
        .map((m) => ({ ...m, name: m.name.trim() })),
      updatedAt: Date.now(),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      align="top"
      icon={<Users className="h-4 w-4" />}
      title={isNew ? "Create agent team" : "Edit agent team"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isNew ? "Create team" : "Save team"}
          </Button>
        </>
      }
    >
      <div className="space-y-5 px-5 py-4">
        <Field label="Team name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. saas build"
          />
        </Field>

        {/* Head / team leader */}
        <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--border)] p-4">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-[var(--secondary)]" />
            <h3 className="text-sm font-semibold text-[var(--fg)]">Head / team leader</h3>
          </div>
          <Field label="Leader name (agent id)">
            <TextInput
              value={leaderName}
              onChange={(e) => setLeaderName(e.target.value)}
              placeholder="e.g. Elio"
            />
          </Field>
          <Field label="Leader system prompt">
            <div className="mb-2">
              <Select
                value=""
                onChange={(e) => {
                  const tpl = LEADER_PROMPT_TEMPLATES.find((t) => t.label === e.target.value);
                  if (tpl) setLeaderPrompt(tpl.prompt);
                }}
              >
                <option value="">Insert a template…</option>
                {LEADER_PROMPT_TEMPLATES.map((t) => (
                  <option key={t.label} value={t.label}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <TextArea
              rows={6}
              value={leaderPrompt}
              onChange={(e) => setLeaderPrompt(e.target.value)}
              placeholder="Describe how the leader should coordinate the team…"
            />
          </Field>
        </section>

        {/* Members */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg)]">Team members</h3>
            <Button variant="outline" onClick={addMember}>
              <UserPlus className="h-4 w-4" /> Add team member
            </Button>
          </div>

          {members.length === 0 && (
            <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--muted)]">
              No members yet. Add specialists (name, short description, and system prompt) for the
              leader to delegate to.
            </p>
          )}

          <div className="space-y-3">
            {members.map((member, idx) => (
              <div
                key={member.id}
                className="space-y-2.5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-3.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--muted)]">Member {idx + 1}</span>
                  <button
                    onClick={() => removeMember(member.id)}
                    title="Remove member"
                    className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] text-[var(--subtle)] hover:text-[var(--danger)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <Field label="Name (agent id)">
                    <TextInput
                      value={member.name}
                      onChange={(e) => updateMember(member.id, { name: e.target.value })}
                      placeholder="e.g. Arlo"
                    />
                  </Field>
                  <Field label="Short description">
                    <TextInput
                      value={member.description}
                      onChange={(e) => updateMember(member.id, { description: e.target.value })}
                      placeholder="e.g. engineer — writes code"
                    />
                  </Field>
                </div>
                <Field label="System prompt">
                  <TextArea
                    rows={4}
                    value={member.systemPrompt}
                    onChange={(e) => updateMember(member.id, { systemPrompt: e.target.value })}
                    placeholder="Describe this member's specialization and how they should work…"
                  />
                </Field>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
