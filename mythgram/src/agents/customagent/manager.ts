import type { AppStateRepo } from "../../database/repositories/appStateRepo.js";
import { createCustomAgentId } from "../../database/ids.js";
import {
  normalizeCustomAgentConfig,
  sanitizeSelectedTools,
  type CustomAgentConfig,
} from "./configuration.js";

/** Fields accepted when creating a Custom Agent (id/timestamps are assigned by the manager). */
export interface CreateCustomAgentInput {
  name: string;
  description?: string;
  systemPrompt: string;
  selectedTools?: string[];
}

/** Fields accepted when updating a Custom Agent (all optional; id/createdAt are immutable). */
export interface UpdateCustomAgentInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  selectedTools?: string[];
}

/**
 * CustomAgentManager — the persistent store for Custom Agent configurations.
 *
 * It reuses the application's existing persistence architecture: configs live in the SQLite-backed
 * `app_state` document keyed `customAgents` (the very same document the frontend syncs to). No new
 * persistence system is introduced. Each Custom Agent persists independently of the Main Agent, which
 * has no stored config of its own.
 *
 * The manager is deliberately independent of any running Main Agent: a Custom Agent can be created,
 * loaded, and started on its own (spec §5, §9).
 */
export class CustomAgentManager {
  constructor(private readonly appState: AppStateRepo) {}

  /** All stored Custom Agents, normalized and newest-first (by createdAt). */
  list(): CustomAgentConfig[] {
    const raw = this.appState.get("customAgents");
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    const out: CustomAgentConfig[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const config = normalizeCustomAgentConfig(item, { id: createCustomAgentId(), now });
      if (!config || seen.has(config.id)) continue;
      seen.add(config.id);
      out.push(config);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** One Custom Agent by id, or null when it does not exist. */
  get(id: string): CustomAgentConfig | null {
    if (!id) return null;
    return this.list().find((a) => a.id === id) ?? null;
  }

  /** Create and persist a new Custom Agent. Throws when the name is empty. */
  create(input: CreateCustomAgentInput): CustomAgentConfig {
    const name = (input.name ?? "").trim();
    if (!name) throw new Error("A Custom Agent name is required.");
    const now = Date.now();
    const config: CustomAgentConfig = {
      id: createCustomAgentId(),
      name,
      description: (input.description ?? "").trim(),
      systemPrompt: input.systemPrompt ?? "",
      selectedTools: sanitizeSelectedTools(input.selectedTools),
      createdAt: now,
      updatedAt: now,
    };
    const all = this.list();
    this.persist([config, ...all]);
    return config;
  }

  /** Update an existing Custom Agent. Returns the updated config, or null when it does not exist. */
  update(id: string, patch: UpdateCustomAgentInput): CustomAgentConfig | null {
    const all = this.list();
    const index = all.findIndex((a) => a.id === id);
    if (index === -1) return null;
    const existing = all[index]!;
    const updated: CustomAgentConfig = {
      ...existing,
      name: patch.name !== undefined ? patch.name.trim() || existing.name : existing.name,
      description: patch.description !== undefined ? patch.description.trim() : existing.description,
      systemPrompt: patch.systemPrompt !== undefined ? patch.systemPrompt : existing.systemPrompt,
      selectedTools:
        patch.selectedTools !== undefined
          ? sanitizeSelectedTools(patch.selectedTools)
          : existing.selectedTools,
      updatedAt: Date.now(),
    };
    const next = all.slice();
    next[index] = updated;
    this.persist(next);
    return updated;
  }

  /** Delete a Custom Agent by id. Returns true when one was removed. */
  delete(id: string): boolean {
    const all = this.list();
    const next = all.filter((a) => a.id !== id);
    if (next.length === all.length) return false;
    this.persist(next);
    return true;
  }

  private persist(configs: CustomAgentConfig[]): void {
    this.appState.set("customAgents", configs);
  }
}
