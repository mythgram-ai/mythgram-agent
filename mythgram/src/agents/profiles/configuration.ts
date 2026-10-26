/**
 * User Profiles — persistent configuration shapes.
 *
 * A user profile is an identity (name + logo avatar + short description) that owns a
 * completely isolated workspace state: when the user switches to a profile, every slice
 * (conversations, settings, memory, knowledge, sub-agents, skills, teams, ...) starts
 * fresh for that profile and nothing leaks across profiles. The isolation itself lives
 * in the frontend store + per-profile snapshots (see `profileStates` / `profileSessions`
 * app-state documents); this file only owns the profile identity shape + validation.
 *
 * Profiles persist in the SQLite-backed `app_state` document keyed `userProfiles`
 * (the same document the frontend syncs to), and the active selection lives under
 * `activeUserProfileId`. No new persistence system is introduced.
 */

/** Stable id of the built-in default profile (always exists, can never be deleted). */
export const DEFAULT_PROFILE_ID = "default";

/** Display name of the built-in default profile. */
export const DEFAULT_PROFILE_NAME = "Default User";

/** Short description shipped with the built-in default profile. */
export const DEFAULT_PROFILE_DESCRIPTION = "Your default workspace profile.";

/** Maximum username length. */
export const MAX_PROFILE_NAME_CHARS = 70;

/** Maximum short-description length. */
export const MAX_PROFILE_DESCRIPTION_CHARS = 300;

/**
 * Maximum avatar payload length in characters. Avatars are stored as data-URL strings
 * (or a plain https URL); the frontend downscales uploads to a small thumbnail before
 * sending, so this is a generous safety cap, not a target size.
 */
export const MAX_PROFILE_AVATAR_CHARS = 1_500_000;

/**
 * Logo automatically routed to the built-in default profile: "Foxy", the curated
 * fox logo from the frontend gallery (frontend-main/src/lib/profileLogosA.ts),
 * stored as a base64 SVG data URL. Byte-identical to what the frontend assigns,
 * so both sides agree on the default look without any extra fetch.
 */
export const DEFAULT_PROFILE_AVATAR =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJwYTEiIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZGJhNzQiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNmOTczMTYiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0idXJsKCNwYTEpIi8+PHBhdGggZD0iTTE1IDI2IEwxOSAxMSBMMzAgMjEgWiIgZmlsbD0iIzlhMzQxMiIvPjxwYXRoIGQ9Ik00OSAyNiBMNDUgMTEgTDM0IDIxIFoiIGZpbGw9IiM5YTM0MTIiLz48cGF0aCBkPSJNMTggMjMgTDIwIDE1IEwyNiAyMCBaIiBmaWxsPSIjZmVkN2FhIi8+PHBhdGggZD0iTTQ2IDIzIEw0NCAxNSBMMzggMjAgWiIgZmlsbD0iI2ZlZDdhYSIvPjxlbGxpcHNlIGN4PSIzMiIgY3k9IjM4IiByeD0iMTYiIHJ5PSIxMyIgZmlsbD0iI2ZmZjdlZCIvPjxlbGxpcHNlIGN4PSIzMiIgY3k9IjQzIiByeD0iOCIgcnk9IjYiIGZpbGw9IiNmZmVkZDUiLz48Y2lyY2xlIGN4PSIyNSIgY3k9IjM2IiByPSIyLjYiIGZpbGw9IiM0MzE0MDciLz48Y2lyY2xlIGN4PSIzOSIgY3k9IjM2IiByPSIyLjYiIGZpbGw9IiM0MzE0MDciLz48ZWxsaXBzZSBjeD0iMjAuNSIgY3k9IjQwIiByeD0iMi42IiByeT0iMS44IiBmaWxsPSIjZmRhNGFmIiBvcGFjaXR5PSIuOCIvPjxlbGxpcHNlIGN4PSI0My41IiBjeT0iNDAiIHJ4PSIyLjYiIHJ5PSIxLjgiIGZpbGw9IiNmZGE0YWYiIG9wYWNpdHk9Ii44Ii8+PGVsbGlwc2UgY3g9IjMyIiBjeT0iNDEiIHJ4PSIyLjQiIHJ5PSIxLjgiIGZpbGw9IiM0MzE0MDciLz48cGF0aCBkPSJNMjggNDYgUTMyIDQ4LjUgMzYgNDYiIHN0cm9rZT0iIzQzMTQwNyIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48L3N2Zz4=";

export interface UserProfileConfig {
  /** Stable unique id (16-character alphanumeric; `"default"` for the built-in profile). */
  id: string;
  /** Username shown on the profile card and the sidebar (required). */
  name: string;
  /** Short description of the profile. */
  description: string;
  /**
   * Logo image (required): a `data:image/...` URL or an `https?://...` URL — pick one
   * from the curated gallery or upload a custom image. Legacy records without one
   * render the name initial instead.
   */
  avatar: string;
  createdAt: number;
  updatedAt: number;
}

/** The untrusted over-the-wire / stored shape. Accepts snake_case and camelCase spellings. */
export interface UserProfileWire {
  id?: unknown;
  name?: unknown;
  username?: unknown;
  description?: unknown;
  avatar?: unknown;
  logo?: unknown;
  avatar_url?: unknown;
  avatarUrl?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** True when the id is the built-in default profile id. */
export function isDefaultProfileId(id: string): boolean {
  return id.trim() === DEFAULT_PROFILE_ID;
}

/**
 * Defensively coerce an untrusted avatar value into a storable string. Accepts data-URLs
 * (`data:image/...`), http(s) URLs, and empty (no logo). Anything else becomes `""` so a
 * malformed avatar can never block a profile save. Over-long payloads are rejected with
 * `null` so the caller can surface a proper error instead of silently dropping the image.
 */
export function normalizeAvatar(raw: unknown): string | null {
  const value = str(raw).trim();
  if (!value) return "";
  if (value.length > MAX_PROFILE_AVATAR_CHARS) return null;
  if (/^data:image\/[a-zA-Z0-9+.-]+;base64,/.test(value)) return value;
  if (/^https?:\/\//i.test(value) && value.length <= 2000) return value;
  return "";
}

/**
 * Defensively normalize an untrusted profile payload (wire or stored) into a well-formed
 * config, or `null` when it is unusable (no name). `id`/timestamps fall back to the
 * supplied defaults so this can be reused for both create (mint an id/now) and load
 * (keep existing) flows. Over-long names/descriptions are trimmed to their caps;
 * an over-long avatar fails the whole payload (returns `null`) so oversized uploads
 * are reported instead of silently dropped.
 */
export function normalizeUserProfile(
  raw: unknown,
  defaults: { id: string; now: number },
): UserProfileConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as UserProfileWire;

  const name = (str(r.name) || str(r.username)).trim().slice(0, MAX_PROFILE_NAME_CHARS);
  if (!name) return null;

  const avatarRaw = r.avatar ?? r.logo ?? r.avatar_url ?? r.avatarUrl ?? "";
  const avatar = normalizeAvatar(avatarRaw);
  if (avatar === null) return null;

  const id = str(r.id).trim() || defaults.id;
  const createdAt = num(r.created_at ?? r.createdAt, defaults.now);
  const updatedAt = num(r.updated_at ?? r.updatedAt, defaults.now);

  return {
    id,
    name,
    description: str(r.description).trim().slice(0, MAX_PROFILE_DESCRIPTION_CHARS),
    avatar,
    createdAt,
    updatedAt,
  };
}

/** Build the built-in default profile value (used when storage is empty). */
export function defaultProfile(now: number): UserProfileConfig {
  return {
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    description: DEFAULT_PROFILE_DESCRIPTION,
    avatar: DEFAULT_PROFILE_AVATAR,
    createdAt: now,
    updatedAt: now,
  };
}
