/**
 * User Profile runtime infrastructure.
 *
 * A user profile is an identity (username + logo avatar + short description) that owns a
 * completely isolated workspace state. Switching profiles gives the user a fresh start:
 * no chats, settings, memory, knowledge, sub-agents, skills, teams, or any other data
 * carries over. The isolation itself lives in the frontend store + per-profile snapshots;
 * this module keeps the profile identity logic isolated and organized:
 *
 *   configuration — the persistent UserProfileConfig shape + defensive normalization
 *   manager       — persistent CRUD + active-selection over the existing SQLite app_state repository
 */
export {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  DEFAULT_PROFILE_DESCRIPTION,
  DEFAULT_PROFILE_AVATAR,
  MAX_PROFILE_NAME_CHARS,
  MAX_PROFILE_DESCRIPTION_CHARS,
  MAX_PROFILE_AVATAR_CHARS,
  defaultProfile,
  isDefaultProfileId,
  normalizeAvatar,
  normalizeUserProfile,
  type UserProfileConfig,
  type UserProfileWire,
} from "./configuration.js";
export {
  UserProfileManager,
  type CreateUserProfileInput,
  type UpdateUserProfileInput,
} from "./manager.js";
