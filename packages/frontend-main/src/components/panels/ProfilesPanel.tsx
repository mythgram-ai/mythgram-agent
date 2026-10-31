import { useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Crown,
  ImagePlus,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import type { UserProfile } from "@/types";
import {
  PROFILE_LOGOS,
  PROFILE_LOGO_CATEGORIES,
  profileLogoDataUrl,
} from "@/lib/profileLogos";
import {
  MAX_PROFILE_DESCRIPTION_CHARS,
  MAX_PROFILE_NAME_CHARS,
  findActiveProfile,
  isDefaultProfile,
  isUsableAvatar,
  processAvatarFile,
  profileInitials,
} from "@/lib/userProfiles";
import { Modal } from "@/components/ui/Modal";
import {
  Button,
  EmptyState,
  Field,
  PanelHeader,
  TextArea,
  TextInput,
} from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

interface Draft {
  id: string | null;
  name: string;
  description: string;
  avatar: string;
}

const empty = (): Draft => ({ id: null, name: "", description: "", avatar: "" });

/**
 * User profiles (accounts) page.
 *
 * Lists every profile as a manageable card: the built-in default profile is always
 * present, and the user can create more (username + logo image + short description).
 * Each profile owns a completely isolated workspace — switching profiles stashes the
 * current chats/settings/memory/... and restores the target's (fresh defaults when
 * it has never been opened), so a new profile truly starts from new with nothing
 * carried over. Cards offer Switch, Edit, Duplicate, Reset, and Delete.
 */
export function ProfilesPanel() {
  const userProfiles = useStore((s) => s.userProfiles);
  const activeUserProfileId = useStore((s) => s.activeUserProfileId);
  const conversations = useStore((s) => s.conversations);
  const streaming = useStore((s) => s.streaming);
  const addUserProfile = useStore((s) => s.addUserProfile);
  const updateUserProfile = useStore((s) => s.updateUserProfile);
  const deleteUserProfile = useStore((s) => s.deleteUserProfile);
  const switchUserProfile = useStore((s) => s.switchUserProfile);
  const duplicateUserProfile = useStore((s) => s.duplicateUserProfile);
  const resetUserProfile = useStore((s) => s.resetUserProfile);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "delete" | "reset" } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const active = findActiveProfile(userProfiles, activeUserProfileId);
  const chatCount = (id: string) =>
    conversations.filter((c) => (c.profileId ?? "default") === id).length;

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3500);
  };

  const save = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return setError("A username is required.");
    if (!draft.avatar) return setError("Please choose a logo below — a logo is required.");
    if (name.length > MAX_PROFILE_NAME_CHARS) {
      return setError(`Username must be ${MAX_PROFILE_NAME_CHARS} characters or fewer.`);
    }
    if (draft.description.length > MAX_PROFILE_DESCRIPTION_CHARS) {
      return setError(
        `Description must be ${MAX_PROFILE_DESCRIPTION_CHARS} characters or fewer.`,
      );
    }
    const clash = userProfiles.some(
      (pr) => pr.id !== draft.id && pr.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) return setError(`A profile named "${name}" already exists.`);
    if (draft.id) {
      updateUserProfile(draft.id, {
        name,
        description: draft.description.trim(),
        avatar: draft.avatar,
      });
      flash(`Profile "${name}" updated.`);
    } else {
      const created = addUserProfile({
        name,
        description: draft.description.trim(),
        avatar: draft.avatar,
      });
      const err = switchUserProfile(created.id);
      if (err) {
        flash(`Profile "${name}" created.`);
      } else {
        flash(`Switched to new profile "${name}" — a fresh workspace.`);
      }
    }
    setDraft(null);
    setError(null);
  };

  const doSwitch = (id: string) => {
    const err = switchUserProfile(id);
    if (err) flash(err);
    else {
      const target = userProfiles.find((pr) => pr.id === id);
      flash(target ? `Switched to "${target.name}".` : "Switched profile.");
    }
  };

  const doDuplicate = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const nid = await duplicateUserProfile(id);
      flash(nid ? "Profile duplicated — switched to the copy." : "Could not duplicate that profile.");
    } finally {
      setBusyId(null);
    }
  };

  const doConfirm = () => {
    if (!confirm || busyId) return;
    if (confirm.kind === "delete") {
      const err = deleteUserProfile(confirm.id);
      flash(err ?? "Profile deleted with all of its data.");
    } else {
      const err = resetUserProfile(confirm.id);
      flash(err ?? "Profile reset to a fresh workspace.");
    }
    setConfirm(null);
  };

  const confirmTarget = confirm ? userProfiles.find((pr) => pr.id === confirm.id) : null;

  return (
    <div className="mx-auto w-full max-w-3xl panel-in">
      <div className="flex items-end justify-between gap-3">
        <PanelHeader kicker="Who is working" title="Profiles" />
        <Button
          onClick={() => {
            setError(null);
            setDraft(empty());
          }}
        >
          <Plus className="h-4 w-4" /> New profile
        </Button>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
        Each profile is a separate account with its own chats, settings, memory, knowledge,
        sub-agents, skills, and teams. Creating a profile starts it completely fresh — nothing
        carries over. Currently active:{" "}
        <span className="font-medium text-[var(--fg)]">{active.name}</span>.
      </p>

      {streaming && (
        <p className="mb-4 rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--warning)_35%,transparent)] bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
          The agent is running — stop it before switching, duplicating, resetting, or deleting a
          profile.
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--chip)] px-3 py-2 text-xs text-[var(--fg)] fade-in">
          {notice}
        </p>
      )}

      {userProfiles.length === 0 ? (
        <EmptyState icon={<UserRound className="h-8 w-8" />}>
          No profiles yet — create one to get started.
        </EmptyState>
      ) : (
        <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {userProfiles.map((profile) => {
            const isActive = profile.id === active.id;
            const isDefault = isDefaultProfile(profile.id);
            const deletable = !isDefault && userProfiles.length > 1;
            return (
              <li key={profile.id}>
                <article
                  className={cn(
                    "flex h-full flex-col rounded-[var(--radius-xl)] bg-[var(--bg)] p-5 transition-colors hover:bg-[var(--chip)]",
                    isActive && "ring-1 ring-[var(--secondary)]",
                  )}
                  style={{ boxShadow: "var(--shadow-chip)" }}
                >
                  <div className="flex items-start gap-3">
                    <ProfileAvatar profile={profile} size="lg" />
                    <div className="min-w-0 flex-1">
                      <h3 className="m-0 flex flex-wrap items-center gap-1.5 text-lg font-semibold text-[var(--fg)]">
                        <span className="truncate">{profile.name}</span>
                        {isActive && (
                          <span className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--secondary-fg)]">
                            Active
                          </span>
                        )}
                        {isDefault && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--subtle)]">
                            <Crown className="h-2.5 w-2.5" /> default
                          </span>
                        )}
                      </h3>
                      <p className="m-0 mt-0.5 text-xs text-[var(--subtle)]">
                        {chatCount(profile.id)} chat{chatCount(profile.id) === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>

                  <p className="line-clamp-2 m-0 mt-3 min-h-10 text-sm leading-relaxed text-[var(--muted)]">
                    {profile.description || (
                      <span className="text-[var(--subtle)]">No description.</span>
                    )}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-3">
                    {!isActive && (
                      <Button
                        variant="outline"
                        className="px-2.5 py-1.5 text-xs"
                        disabled={streaming}
                        onClick={() => doSwitch(profile.id)}
                      >
                        <Check className="h-3.5 w-3.5" /> Switch
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="px-2 py-1.5 text-xs"
                      onClick={() => {
                        setError(null);
                        setDraft({
                          id: profile.id,
                          name: profile.name,
                          description: profile.description,
                          avatar: profile.avatar,
                        });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1.5 text-xs"
                      disabled={streaming || busyId === profile.id}
                      onClick={() => void doDuplicate(profile.id)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {busyId === profile.id ? "Duplicating…" : "Duplicate"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1.5 text-xs"
                      disabled={streaming}
                      onClick={() => setConfirm({ id: profile.id, kind: "reset" })}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reset
                    </Button>
                    {deletable && (
                      <Button
                        variant="ghost"
                        className="px-2 py-1.5 text-xs text-[var(--subtle)] hover:text-[var(--danger)]"
                        disabled={streaming}
                        onClick={() => setConfirm({ id: profile.id, kind: "delete" })}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        icon={<UserRound className="h-4 w-4" />}
        title={draft?.id ? "Edit profile" : "New profile"}
        size="md"
        footer={
          <Button onClick={save}>
            <Check className="h-4 w-4" /> {draft?.id ? "Save" : "Create profile"}
          </Button>
        }
      >
        {draft && (
          <ProfileEditor
            draft={draft}
            error={error}
            setDraft={setDraft}
            setError={setError}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === "delete" ? "Delete profile" : "Reset profile"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doConfirm}>
              {confirm?.kind === "delete" ? "Delete everything" : "Reset everything"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 p-5 text-sm leading-relaxed text-[var(--muted)]">
          {confirm?.kind === "delete" ? (
            <p className="m-0">
              Delete profile{" "}
              <span className="font-medium text-[var(--fg)]">“{confirmTarget?.name}”</span> and{" "}
              <span className="font-medium text-[var(--danger)]">
                all of its chats, settings, memory, knowledge, sub-agents, skills, and teams
              </span>
              ? This cannot be undone.
            </p>
          ) : (
            <p className="m-0">
              Reset profile{" "}
              <span className="font-medium text-[var(--fg)]">“{confirmTarget?.name}”</span> to a
              brand-new workspace? All of its chats, settings, memory, knowledge, sub-agents,
              skills, and teams will be cleared. This cannot be undone.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

/** Circular avatar: logo image when present, name initials otherwise. */
export function ProfileAvatar({
  profile,
  size = "md",
}: {
  profile: Pick<UserProfile, "name" | "avatar">;
  size?: "sm" | "md" | "lg";
}) {
  const cls =
    size === "lg"
      ? "h-12 w-12 text-sm"
      : size === "sm"
        ? "h-7 w-7 text-[10px]"
        : "h-9 w-9 text-xs";
  if (isUsableAvatar(profile.avatar)) {
    return (
      <img
        src={profile.avatar}
        alt={profile.name}
        className={cn(cls, "shrink-0 rounded-full border border-[var(--border)] object-cover")}
      />
    );
  }
  return (
    <span
      className={cn(
        cls,
        "grid shrink-0 place-items-center rounded-full bg-[var(--secondary)] font-semibold uppercase tracking-wide text-[var(--secondary-fg)]",
      )}
      aria-hidden
    >
      {profileInitials(profile.name)}
    </span>
  );
}

function ProfileEditor({
  draft,
  error,
  setDraft,
  setError,
}: {
  draft: Draft;
  error: string | null;
  setDraft: (d: Draft) => void;
  setError: (e: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const pickLogo = () => fileRef.current?.click();

  const handleFile = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await processAvatarFile(file);
      setDraft({ ...draft, avatar: url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center gap-4">
        <ProfileAvatar profile={draft} size="lg" />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={pickLogo} disabled={uploading}>
            <ImagePlus className="h-3.5 w-3.5" />
            {uploading ? "Processing…" : "Upload custom"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void handleFile(e.target.files)}
          />
        </div>
      </div>

      <LogoPicker value={draft.avatar} onChange={(avatar) => setDraft({ ...draft, avatar })} />

      <Field label="Username" hint={`${draft.name.length}/${MAX_PROFILE_NAME_CHARS}`}>
        <TextInput
          value={draft.name}
          maxLength={MAX_PROFILE_NAME_CHARS}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Ada"
        />
      </Field>
      <Field
        label="Short description"
        hint={`${draft.description.length}/${MAX_PROFILE_DESCRIPTION_CHARS}`}
      >
        <TextArea
          rows={3}
          maxLength={MAX_PROFILE_DESCRIPTION_CHARS}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="e.g. Research workspace for the thesis project."
        />
      </Field>
      {!draft.id && (
        <p className="m-0 text-xs leading-relaxed text-[var(--subtle)]">
          A new profile starts completely fresh — no chats, settings, memory, or anything else
          carries over — and you switch to it right away.
        </p>
      )}
      {error && <p className="m-0 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}

/**
 * Curated logo gallery: cute, professional SVG logos (animals + faces & bots),
 * grouped by category. Picking one stores its data URL as the profile avatar
 * (high-quality at any size, since it stays vector). A logo is required — the
 * editor cannot be saved without one. Uploading a custom image stays available.
 */
function LogoPicker({ value, onChange }: { value: string; onChange: (avatar: string) => void }) {
  const previews = useMemo(
    () =>
      PROFILE_LOGOS.map((logo) => ({
        logo,
        url: profileLogoDataUrl(logo.svg),
      })),
    [],
  );

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--muted)]">
          Choose a logo{" "}
          <span className="text-[var(--subtle)]">({PROFILE_LOGOS.length} curated)</span>
        </span>
      </div>
      <div className="max-h-64 space-y-3 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] p-3">
        {PROFILE_LOGO_CATEGORIES.map((category) => (
          <div key={category}>
            <p className="m-0 mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--subtle)]">
              {category}
            </p>
            <div className="grid grid-cols-6 gap-1.5 max-[520px]:grid-cols-5">
              {previews
                .filter((p) => p.logo.category === category)
                .map(({ logo, url }) => {
                  const selected = value === url;
                  return (
                    <button
                      key={logo.id}
                      type="button"
                      onClick={() => onChange(url)}
                      title={logo.name}
                      aria-label={`Use the ${logo.name} logo`}
                      aria-pressed={selected}
                      className={cn(
                        "grid aspect-square place-items-center overflow-hidden rounded-[var(--radius-md)] border-2 transition-all active:scale-95",
                        selected
                          ? "border-[var(--secondary)]"
                          : "border-transparent hover:border-[var(--border)]",
                      )}
                    >
                      <img src={url} alt={logo.name} className="h-full w-full object-cover" />
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
