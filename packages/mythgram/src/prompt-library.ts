import type { AppStateRepo } from "./database/repositories/appStateRepo.js";
import { createPromptLibraryId } from "./database/ids.js";

/**
 * Prompt Library — user-saved reusable prompts.
 *
 * A prompt-library entry is a small, user-authored record the user can quickly
 * copy or re-use in the composer: a title, an optional short description, and
 * the prompt text itself. There are deliberately NO length limits on the title
 * and short description — the user asked for unlimited titles/descriptions.
 *
 * Persistence reuses the application's existing architecture: entries live in
 * the SQLite-backed `app_state` document keyed `promptLibrary` (the same
 * document the frontend syncs to, exactly like Custom Agents / Main Agent
 * prompts / task modes). No new persistence system is introduced — the SQLite
 * database (`workspace/.mythgram/mythgram.db`) remains the single source of
 * truth.
 *
 * Every saved prompt carries its own stable unique id: a 20-character
 * alphanumeric id (`0-9a-zA-Z`, 62^20 combinations), minted at creation.
 */

export interface PromptLibraryEntry {
  /** Stable unique id (20-character alphanumeric). */
  id: string;
  /** User-visible title (required, no length limit). */
  title: string;
  /** Optional short description (no length limit). */
  description: string;
  /** The reusable prompt text. */
  content: string;
  createdAt: number;
  updatedAt: number;
}

/** Untrusted over-the-wire / stored shape. Accepts snake_case and camelCase spellings. */
export interface PromptLibraryWire {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  description?: unknown;
  short_description?: unknown;
  shortDescription?: unknown;
  content?: unknown;
  prompt?: unknown;
  text?: unknown;
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

/**
 * Defensively normalize an untrusted prompt payload (wire or stored) into a
 * well-formed entry, or `null` when it is unusable (no title and no content).
 * `id`/timestamps fall back to the supplied defaults so this can be reused for
 * both create (mint an id/now) and load (keep existing) flows.
 */
export function normalizePromptLibraryEntry(
  raw: unknown,
  defaults: { id: string; now: number },
): PromptLibraryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as PromptLibraryWire;

  const title = (str(r.title) || str(r.name)).trim();
  const content = (str(r.content) || str(r.prompt) || str(r.text)).trim();
  // An entry needs at least a title or prompt text to be useful.
  if (!title && !content) return null;

  const description = (
    str(r.description) ||
    str(r.short_description) ||
    str(r.shortDescription)
  ).trim();

  const id = str(r.id).trim() || defaults.id;
  const createdAt = num(r.created_at ?? r.createdAt, defaults.now);
  const updatedAt = num(r.updated_at ?? r.updatedAt, defaults.now);

  return {
    id,
    title: title || "(untitled)",
    description,
    content,
    createdAt,
    updatedAt,
  };
}

/** Fields accepted when creating a prompt-library entry (id/timestamps assigned by the manager). */
export interface CreatePromptLibraryInput {
  title: string;
  description?: string;
  content: string;
}

/** Fields accepted when updating an entry (all optional; id/createdAt are immutable). */
export interface UpdatePromptLibraryInput {
  title?: string;
  description?: string;
  content?: string;
}

/**
 * PromptLibraryManager — the persistent store for prompt-library entries.
 *
 * It reuses the application's existing persistence architecture: entries live
 * in the SQLite-backed `app_state` document keyed `promptLibrary` (the very
 * same document the frontend syncs to). No new persistence system is
 * introduced.
 */
export class PromptLibraryManager {
  constructor(private readonly appState: AppStateRepo) {}

  /** All stored entries, normalized and newest-first (by createdAt). */
  list(): PromptLibraryEntry[] {
    const raw = this.appState.get("promptLibrary");
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    const out: PromptLibraryEntry[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const config = normalizePromptLibraryEntry(item, { id: createPromptLibraryId(), now });
      if (!config || seen.has(config.id)) continue;
      seen.add(config.id);
      out.push(config);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** One entry by id, or null when it does not exist. */
  get(id: string): PromptLibraryEntry | null {
    if (!id) return null;
    return this.list().find((p) => p.id === id) ?? null;
  }

  /** Create and persist a new entry. Throws when both title and content are empty. */
  create(input: CreatePromptLibraryInput): PromptLibraryEntry {
    const title = (input.title ?? "").trim();
    const content = (input.content ?? "").trim();
    if (!title && !content) {
      throw new Error("A prompt title or prompt text is required.");
    }
    const now = Date.now();
    const entry: PromptLibraryEntry = {
      id: createPromptLibraryId(),
      title: title || "(untitled)",
      description: (input.description ?? "").trim(),
      content,
      createdAt: now,
      updatedAt: now,
    };
    const all = this.list();
    this.persist([entry, ...all]);
    return entry;
  }

  /** Update an existing entry. Returns the updated entry, or null when it does not exist. */
  update(id: string, patch: UpdatePromptLibraryInput): PromptLibraryEntry | null {
    const all = this.list();
    const index = all.findIndex((p) => p.id === id);
    if (index === -1) return null;
    const existing = all[index]!;
    const updated: PromptLibraryEntry = {
      ...existing,
      title:
        patch.title !== undefined
          ? patch.title.trim() || existing.title
          : existing.title,
      description:
        patch.description !== undefined ? patch.description.trim() : existing.description,
      content:
        patch.content !== undefined && patch.content.trim().length > 0
          ? patch.content
          : existing.content,
      updatedAt: Date.now(),
    };
    const next = all.slice();
    next[index] = updated;
    this.persist(next);
    return updated;
  }

  /** Delete an entry by id. Returns true when one was removed. */
  delete(id: string): boolean {
    const all = this.list();
    const next = all.filter((p) => p.id !== id);
    if (next.length === all.length) return false;
    this.persist(next);
    return true;
  }

  private persist(entries: PromptLibraryEntry[]): void {
    this.appState.set("promptLibrary", entries);
  }
}
