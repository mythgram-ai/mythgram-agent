import { defaultProfileAvatar } from "@/lib/profileLogos";
import type {
  AgentMode,
  AgentTeam,
  CeoAgent,
  ConnectorConnection,
  Conversation,
  CustomAgent,
  CustomProvider,
  CustomTaskMode,
  KnowledgeFile,
  KnowledgeSource,
  MainAgentPrompt,
  McpServer,
  MemoryFile,
  PromptLibraryItem,
  Settings,
  Skill,
  SubAgent,
  TodoItem,
  UserProfile,
} from "@/types";

/**
 * User profiles (account identities) — each profile owns a completely isolated
 * workspace state. Switching profiles gives a fresh start: no chats, settings,
 * memory, knowledge, sub-agents, skills, teams, or any other data carries over.
 *
 * Persistence mirrors every other entity: the identity records sync through the
 * shared app-state bridge (`userProfiles` + `activeUserProfileId`), while the
 * per-profile isolated snapshots sync as two opaque documents (`profileStates`
 * for all workspace slices, `profileSessions` for the per-profile chat id lists).
 * The backend stores all four documents in SQLite without interpreting them.
 */

/** Stable id of the built-in default profile (always exists, can never be deleted). */
export const DEFAULT_PROFILE_ID = "default";

/** Display name of the built-in default profile. */
export const DEFAULT_PROFILE_NAME = "Default User";

/** Short description shipped with the built-in default profile. */
export const DEFAULT_PROFILE_DESCRIPTION = "Your default workspace profile.";

/** Maximum username length (mirrors the backend cap). */
export const MAX_PROFILE_NAME_CHARS = 70;

/** Maximum short-description length (mirrors the backend cap). */
export const MAX_PROFILE_DESCRIPTION_CHARS = 300;

/** Maximum avatar payload length in characters (mirrors the backend cap). */
export const MAX_PROFILE_AVATAR_CHARS = 1_500_000;

/** Maximum avatar dimensions (px) for uploaded logos — larger images are downscaled. */
export const AVATAR_MAX_DIMENSION = 256;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** True when the id is the built-in default profile id. */
export function isDefaultProfile(id: string): boolean {
  return id.trim() === DEFAULT_PROFILE_ID;
}

/** True when an avatar string looks usable (data-URL image or http(s) URL). */
export function isUsableAvatar(avatar: string): boolean {
  const value = avatar.trim();
  if (!value) return false;
  return /^data:image\/[a-zA-Z0-9+.-]+;base64,/.test(value) || /^https?:\/\//i.test(value);
}

/** The one-to-two initials rendered when a profile has no logo image. */
export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]!.slice(0, 2) || "?").toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

/**
 * Defensive normalize of one stored/loaded profile into a well-formed value, or
 * null when unusable (no id or no name). Accepts snake_case and camelCase spellings
 * plus a `username` alias for the name.
 */
export function normalizeUserProfile(raw: unknown): UserProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  const name = (str(r.name) || str(r.username)).trim().slice(0, MAX_PROFILE_NAME_CHARS);
  if (!id || !name) return null;
  const avatarRaw =
    str(r.avatar) || str(r.logo) || str(r.avatar_url) || str(r.avatarUrl) || "";
  const avatar = avatarRaw.trim();
  const usable =
    !avatar ||
    /^data:image\/[a-zA-Z0-9+.-]+;base64,/.test(avatar) ||
    (/^https?:\/\//i.test(avatar) && avatar.length <= 2000)
      ? avatar.slice(0, MAX_PROFILE_AVATAR_CHARS)
      : "";
  return {
    id,
    name,
    description: str(r.description).trim().slice(0, MAX_PROFILE_DESCRIPTION_CHARS),
    avatar: usable,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

/** Normalize a persisted array of profiles, dropping malformed entries and duplicate ids. */
export function normalizeUserProfiles(raw: unknown): UserProfile[] {
  if (!Array.isArray(raw)) return [];
  const out: UserProfile[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const profile = normalizeUserProfile(item);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    out.push(profile);
  }
  // Default profile first, then newest-first.
  return out.sort((a, b) => {
    if (isDefaultProfile(a.id) !== isDefaultProfile(b.id)) {
      return isDefaultProfile(a.id) ? -1 : 1;
    }
    return b.createdAt - a.createdAt;
  });
}

/** The built-in default profile value (automatically routed to a curated logo). */
export function defaultUserProfile(now = Date.now()): UserProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    description: DEFAULT_PROFILE_DESCRIPTION,
    avatar: defaultProfileAvatar(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Merge persisted profiles with the built-in default so a default profile is always
 * present (pre-added for every user), unless the user already has one (which wins).
 * A default profile saved before curated logos existed (empty avatar) is
 * automatically routed to the curated default logo.
 */
export function mergeProfilesWithDefaults(userProfiles: UserProfile[]): UserProfile[] {
  const merged = normalizeUserProfiles(userProfiles);
  const existing = merged.find((p) => isDefaultProfile(p.id));
  if (!existing) {
    merged.unshift(defaultUserProfile(0));
  } else if (!existing.avatar) {
    existing.avatar = defaultProfileAvatar();
    existing.updatedAt = Date.now();
  }
  return merged;
}

/** The active profile (by id) from a list, falling back to the default profile. */
export function findActiveProfile(
  profiles: UserProfile[],
  activeId: string | null,
): UserProfile {
  if (activeId) {
    const found = profiles.find((p) => p.id === activeId);
    if (found) return found;
  }
  return profiles.find((p) => isDefaultProfile(p.id)) ?? profiles[0] ?? defaultUserProfile();
}

/** A blank profile scaffold for the create form. */
export function blankProfile(): Omit<UserProfile, "id" | "createdAt" | "updatedAt"> {
  return { name: "", description: "", avatar: "" };
}

/**
 * The isolated per-profile workspace snapshot: every user-owned slice that must start
 * fresh for a new profile. Conversations travel separately via the per-profile session
 * id lists (`profileSessions`) so large chat histories never bloat this document.
 */
export interface ProfileSnapshot {
  settings: Settings;
  subAgents: SubAgent[];
  skills: Skill[];
  todos: TodoItem[];
  memory: MemoryFile[];
  knowledge: KnowledgeFile[];
  knowledgeSources: Record<string, KnowledgeSource>;
  customProviders: CustomProvider[];
  agentTeams: AgentTeam[];
  ceoAgents: CeoAgent[];
  customAgents: CustomAgent[];
  activeCustomAgentId: string | null;
  mainAgentPrompts: MainAgentPrompt[];
  activeMainAgentPromptId: string | null;
  taskModes: CustomTaskMode[];
  activeTaskModeId: string | null;
  planModePrompt: string;
  /** User-saved reusable prompts (prompt library). */
  promptLibrary: PromptLibraryItem[];
  /** Top-level conversation mode: "agent" (default, full tools) or "chat" (memory + knowledge + web only). */
  agentMode: AgentMode;
  connectors: ConnectorConnection[];
  mcpServers: McpServer[];
  /** The profile's currently open chat id (null when it has no chats). */
  currentId: string | null;
}

/** Normalize an opaque per-profile snapshot map from storage (drops malformed entries). */
export function normalizeProfileStates(raw: unknown): Record<string, ProfileSnapshot> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ProfileSnapshot> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !value || typeof value !== "object" || Array.isArray(value)) continue;
    out[key] = value as ProfileSnapshot;
  }
  return out;
}

/** Normalize an opaque per-profile session-id-list map from storage. */
export function normalizeProfileSessions(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !Array.isArray(value)) continue;
    const ids = value.filter((id): id is string => typeof id === "string" && id.length > 0);
    out[key] = [...new Set(ids)];
  }
  return out;
}

/** Session ids of a conversation list (used to maintain the profile's id list). */
export function conversationIds(conversations: Conversation[]): string[] {
  return conversations.map((c) => c.id);
}

/**
 * Downscale an uploaded logo image to a small thumbnail data-URL (max 256px per side,
 * PNG or JPEG preserved when possible). Keeps stored profiles small while looking
 * crisp on cards and the sidebar. Throws when the file is not a readable image.
 */
export async function processAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file for the logo.");
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Could not read that image. Try a PNG or JPEG file.");
  try {
    const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process that image in this browser.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const mime = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
    const url = canvas.toDataURL(mime, 0.9);
    if (url.length > MAX_PROFILE_AVATAR_CHARS) {
      throw new Error("That logo is too large even after resizing. Use a smaller image.");
    }
    return url;
  } finally {
    bitmap.close();
  }
}
