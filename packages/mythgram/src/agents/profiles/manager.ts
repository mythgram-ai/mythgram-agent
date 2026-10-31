import type { AppStateRepo } from "../../database/repositories/appStateRepo.js";
import { createUserProfileId } from "../../database/ids.js";
import {
  DEFAULT_PROFILE_AVATAR,
  DEFAULT_PROFILE_ID,
  MAX_PROFILE_AVATAR_CHARS,
  MAX_PROFILE_DESCRIPTION_CHARS,
  MAX_PROFILE_NAME_CHARS,
  defaultProfile,
  isDefaultProfileId,
  normalizeAvatar,
  normalizeUserProfile,
  type UserProfileConfig,
} from "./configuration.js";

/** Fields accepted when creating a user profile (id/timestamps are assigned by the manager). */
export interface CreateUserProfileInput {
  name: string;
  description?: string;
  avatar?: string;
}

/** Fields accepted when updating a user profile (all optional; id/createdAt are immutable). */
export interface UpdateUserProfileInput {
  name?: string;
  description?: string;
  avatar?: string;
}

/**
 * UserProfileManager — the persistent store for user-profile identities plus the
 * active-profile selection.
 *
 * It reuses the application's existing persistence architecture: profiles live in the
 * SQLite-backed `app_state` document keyed `userProfiles` (the same document the
 * frontend syncs to), and the active selection lives under `activeUserProfileId`.
 * Per-profile isolated workspace snapshots (`profileStates`) and per-profile session
 * id lists (`profileSessions`) are opaque documents owned by the frontend's profile
 * switch — this manager never interprets them, it only offers scoped helpers to
 * forget them when a profile is deleted. No new persistence system is introduced.
 *
 * The built-in default profile always exists: when storage is empty it is created
 * (and persisted) on first access, so the UI always has a profile to show.
 */
export class UserProfileManager {
  constructor(private readonly appState: AppStateRepo) {}

  /** All stored profiles, normalized — default profile first, then newest-first. */
  list(): UserProfileConfig[] {
    const raw = this.appState.get("userProfiles");
    if (!Array.isArray(raw)) return [this.ensureDefault()];
    const now = Date.now();
    const out: UserProfileConfig[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const config = normalizeUserProfile(item, { id: createUserProfileId(), now });
      if (!config || seen.has(config.id)) continue;
      seen.add(config.id);
      out.push(config);
    }
    if (out.length === 0) return [this.ensureDefault()];
    return out.sort((a, b) => {
      if (isDefaultProfileId(a.id) !== isDefaultProfileId(b.id)) {
        return isDefaultProfileId(a.id) ? -1 : 1;
      }
      return b.createdAt - a.createdAt;
    });
  }

  /** One profile by id, or null when it does not exist. */
  get(id: string): UserProfileConfig | null {
    if (!id) return null;
    return this.list().find((p) => p.id === id) ?? null;
  }

  /** Ensure the built-in default profile exists in storage; returns it. */
  ensureDefault(): UserProfileConfig {
    const raw = this.appState.get("userProfiles");
    if (Array.isArray(raw)) {
      const now = Date.now();
      const seen = new Set<string>();
      let hasDefault = false;
      for (const item of raw) {
        const config = normalizeUserProfile(item, { id: createUserProfileId(), now });
        if (!config || seen.has(config.id)) continue;
        seen.add(config.id);
        if (isDefaultProfileId(config.id)) {
          hasDefault = true;
          break;
        }
      }
      if (hasDefault) {
        // Heal defaults saved before curated logos existed: route the default
        // profile to its SVG logo automatically and persist the fix.
        const current = this.get(DEFAULT_PROFILE_ID)!;
        if (!current.avatar) {
          const healed = this.update(DEFAULT_PROFILE_ID, { avatar: DEFAULT_PROFILE_AVATAR });
          if (healed) return healed;
        }
        return current;
      }
    }
    const now = Date.now();
    const created = defaultProfile(now);
    const existing = this.listAllowingEmpty();
    this.persist([created, ...existing]);
    if (!this.getActiveId()) this.appState.set("activeUserProfileId", created.id);
    return created;
  }

  /** The id of the currently active profile, or null when none is selected. */
  getActiveId(): string | null {
    const raw = this.appState.get("activeUserProfileId");
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
  }

  /** The currently active profile, falling back to the default profile. */
  getActive(): UserProfileConfig {
    const id = this.getActiveId();
    if (id) {
      const found = this.get(id);
      if (found) return found;
    }
    return this.ensureDefault();
  }

  /** Create and persist a new profile. Throws when the name/logo is missing or avatar too large. */
  create(input: CreateUserProfileInput): UserProfileConfig {
    const name = (input.name ?? "").trim().slice(0, MAX_PROFILE_NAME_CHARS);
    if (!name) throw new Error("A profile name is required.");
    const avatar = normalizeAvatar(input.avatar ?? "");
    if (avatar === null) {
      throw new Error(
        `The logo image is too large (max ${MAX_PROFILE_AVATAR_CHARS} characters). Use a smaller image.`,
      );
    }
    if (!avatar) {
      throw new Error("A profile logo is required. Choose one from the gallery or upload an image.");
    }
    const now = Date.now();
    const config: UserProfileConfig = {
      id: createUserProfileId(),
      name,
      description: (input.description ?? "").trim().slice(0, MAX_PROFILE_DESCRIPTION_CHARS),
      avatar,
      createdAt: now,
      updatedAt: now,
    };
    const all = this.list();
    this.persist([config, ...all]);
    return config;
  }

  /** Update an existing profile. Returns the updated config, or null when missing. */
  update(id: string, patch: UpdateUserProfileInput): UserProfileConfig | null {
    const all = this.list();
    const index = all.findIndex((p) => p.id === id);
    if (index === -1) return null;
    const existing = all[index]!;
    let avatar = existing.avatar;
    if (patch.avatar !== undefined) {
      const normalized = normalizeAvatar(patch.avatar);
      if (normalized === null) {
        throw new Error(
          `The logo image is too large (max ${MAX_PROFILE_AVATAR_CHARS} characters). Use a smaller image.`,
        );
      }
      if (!normalized) {
        throw new Error("A profile logo is required. Choose one from the gallery or upload an image.");
      }
      avatar = normalized;
    }
    const updated: UserProfileConfig = {
      ...existing,
      name:
        patch.name !== undefined
          ? patch.name.trim().slice(0, MAX_PROFILE_NAME_CHARS) || existing.name
          : existing.name,
      description:
        patch.description !== undefined
          ? patch.description.trim().slice(0, MAX_PROFILE_DESCRIPTION_CHARS)
          : existing.description,
      avatar,
      updatedAt: Date.now(),
    };
    const next = all.slice();
    next[index] = updated;
    this.persist(next);
    return updated;
  }

  /**
   * Delete a profile by id. The built-in default profile can never be deleted and the
   * last remaining profile cannot be deleted (returns false for both). Deleting also
   * forgets that profile's isolated snapshot + session list so its data never leaks
   * into another profile. When the deleted profile was active, the default becomes active.
   */
  delete(id: string): boolean {
    if (isDefaultProfileId(id)) return false;
    const all = this.list();
    if (all.length <= 1) return false;
    const next = all.filter((p) => p.id !== id);
    if (next.length === all.length) return false;
    this.persist(next);
    this.forgetProfileData(id);
    if (this.getActiveId() === id) {
      this.appState.set("activeUserProfileId", DEFAULT_PROFILE_ID);
    }
    return true;
  }

  /**
   * Set (or clear) the active profile. Passing null — or an id that does not exist —
   * falls back to the default profile. Only one profile is ever active at a time.
   * Returns the active profile.
   */
  setActive(id: string | null): UserProfileConfig {
    if (id) {
      const found = this.get(id);
      if (found) {
        this.appState.set("activeUserProfileId", found.id);
        return found;
      }
    }
    const fallback = this.ensureDefault();
    this.appState.set("activeUserProfileId", fallback.id);
    return fallback;
  }

  /**
   * Forget a profile's isolated data (its workspace snapshot + session-id list) without
   * touching any other profile. Used on delete so a removed profile's chats/settings
   * can never resurface. Never throws.
   */
  forgetProfileData(id: string): void {
    try {
      const states = this.appState.get("profileStates");
      if (states && typeof states === "object" && !Array.isArray(states)) {
        const record = { ...(states as Record<string, unknown>) };
        if (id in record) {
          delete record[id];
          this.appState.set("profileStates", record);
        }
      }
    } catch {
      // best effort
    }
    try {
      const sessions = this.appState.get("profileSessions");
      if (sessions && typeof sessions === "object" && !Array.isArray(sessions)) {
        const record = { ...(sessions as Record<string, unknown>) };
        if (id in record) {
          delete record[id];
          this.appState.set("profileSessions", record);
        }
      }
    } catch {
      // best effort
    }
  }

  /** Normalized stored profiles WITHOUT auto-creating the default (internal use). */
  private listAllowingEmpty(): UserProfileConfig[] {
    const raw = this.appState.get("userProfiles");
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    const out: UserProfileConfig[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const config = normalizeUserProfile(item, { id: createUserProfileId(), now });
      if (!config || seen.has(config.id)) continue;
      seen.add(config.id);
      out.push(config);
    }
    return out;
  }

  private persist(configs: UserProfileConfig[]): void {
    this.appState.set("userProfiles", configs);
  }
}
