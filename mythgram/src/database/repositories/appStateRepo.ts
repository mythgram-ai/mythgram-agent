import type Database from "better-sqlite3";

/**
 * Application-state documents: settings (provider, model, API keys), user-created
 * sub-agent definitions, skill files, memory files, knowledge files, todos, custom
 * providers, UI selections. Low-volume, human-edited data — stored as JSON documents
 * keyed by name, with point-lookup reads/writes.
 */

/** The only keys the state API will accept — everything the frontend used to keep in localStorage. */
export const APP_STATE_KEYS = [
  "settings",
  "subAgents",
  "skills",
  "todos",
  "memory",
  "knowledge",
  "knowledgeSources",
  "customProviders",
  "currentSessionId",
  "agentTeams",
  "ceoAgents",
  "customAgents",
  "activeCustomAgentId",
  "mainAgentPrompts",
  "activeMainAgentPromptId",
  "taskModes",
  "activeTaskModeId",
  "planModePrompt",
  "agentMode",
  "promptLibrary",
  "connectors",
  "mcpServers",
  "userProfiles",
  "activeUserProfileId",
  "profileStates",
  "profileSessions",
  "channels",
  "tts",
  "ttsAgent",
] as const;

export type AppStateKey = (typeof APP_STATE_KEYS)[number];

export function isAppStateKey(key: string): key is AppStateKey {
  return (APP_STATE_KEYS as readonly string[]).includes(key);
}

export class AppStateRepo {
  private readonly selectOne: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly remove: Database.Statement;

  constructor(db: Database.Database) {
    this.selectOne = db.prepare(`SELECT value FROM app_state WHERE key = ?`);
    this.selectAll = db.prepare(`SELECT key, value FROM app_state`);
    this.upsert = db.prepare(
      `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    this.remove = db.prepare(`DELETE FROM app_state WHERE key = ?`);
  }

  get(key: AppStateKey): unknown | undefined {
    const row = this.selectOne.get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return undefined;
    }
  }

  /** Every stored document as a key → value map (single bounded read at boot). */
  getAll(): Partial<Record<AppStateKey, unknown>> {
    const rows = this.selectAll.all() as Array<{ key: string; value: string }>;
    const out: Partial<Record<AppStateKey, unknown>> = {};
    for (const row of rows) {
      if (!isAppStateKey(row.key)) continue;
      try {
        out[row.key] = JSON.parse(row.value) as unknown;
      } catch {
        // skip corrupted document
      }
    }
    return out;
  }

  set(key: AppStateKey, value: unknown): void {
    let json: string;
    try {
      json = JSON.stringify(value ?? null);
    } catch {
      return;
    }
    this.upsert.run(key, json, Date.now());
  }

  delete(key: AppStateKey): void {
    this.remove.run(key);
  }
}
