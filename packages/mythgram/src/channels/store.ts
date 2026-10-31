import { randomId } from "../database/ids.js";
import type { AppStateRepo } from "../database/repositories/appStateRepo.js";
import type { CustomAgentManager } from "../agents/customagent/index.js";
import {
  normalizeChannelConnection,
  toPublicChannel,
  type ChannelConnection,
  type ChannelConnectionPublic,
  type ChannelKind,
} from "./types.js";

/**
 * ChannelStore — the persistent store for messaging-channel connections.
 *
 * It reuses the application's existing persistence architecture: connections live in
 * the SQLite-backed `app_state` document keyed `channels` (the same document the
 * dashboard syncs to). No new persistence system is introduced. Tokens are stored
 * server-side and never served (see toPublicChannel); chat transcripts live in the
 * `channel_chats` / `channel_messages` tables.
 */
export class ChannelStore {
  constructor(private readonly appState: AppStateRepo) {}

  /** All stored connections, normalized (unknown kinds / malformed rows dropped). */
  list(): ChannelConnection[] {
    const raw = this.appState.get("channels");
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    const out: ChannelConnection[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      const connection = normalizeChannelConnection(item, { id: `ch_${randomId(12)}`, now });
      if (!connection || seen.has(connection.id)) continue;
      seen.add(connection.id);
      out.push(connection);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** One connection by id, or null. */
  get(id: string): ChannelConnection | null {
    if (!id) return null;
    return this.list().find((c) => c.id === id) ?? null;
  }

  /** Browser-safe projections with per-channel chat counts. */
  listPublic(chatCounts: Map<string, number>): ChannelConnectionPublic[] {
    return this.list().map((c) => toPublicChannel(c, chatCounts.get(c.id) ?? 0));
  }

  /**
   * Create and persist a new connection. The token must be non-empty (validated
   * against the provider by the caller before this runs). Throws on unusable input.
   */
  create(input: {
    kind: ChannelKind;
    name?: string;
    token: string;
    botName?: string;
    botId?: string;
    activeAgentId?: string | null;
  }): ChannelConnection {
    const token = input.token.trim();
    if (!token) throw new Error("A bot token is required.");
    const now = Date.now();
    const connection: ChannelConnection = {
      id: `ch_${randomId(12)}`,
      kind: input.kind,
      name: input.name?.trim().slice(0, 70) || input.kind,
      token,
      enabled: true,
      status: "connecting",
      botName: input.botName?.trim() ?? "",
      botId: input.botId?.trim() ?? "",
      activeAgentId: input.activeAgentId?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };
    this.persist([connection, ...this.list()]);
    return connection;
  }

  /**
   * Update a connection. Returns the updated connection, or null when missing.
   * The token is write-only: an absent/empty token keeps the stored one.
   */
  update(
    id: string,
    patch: {
      name?: string;
      token?: string;
      enabled?: boolean;
      activeAgentId?: string | null;
    },
  ): ChannelConnection | null {
    const all = this.list();
    const index = all.findIndex((c) => c.id === id);
    if (index === -1) return null;
    const existing = all[index]!;
    const updated: ChannelConnection = {
      ...existing,
      name:
        patch.name !== undefined && patch.name.trim().length > 0
          ? patch.name.trim().slice(0, 70)
          : existing.name,
      token:
        patch.token !== undefined && patch.token.trim().length > 0
          ? patch.token.trim()
          : existing.token,
      enabled: patch.enabled ?? existing.enabled,
      activeAgentId:
        patch.activeAgentId !== undefined ? patch.activeAgentId?.trim() || null : existing.activeAgentId,
      updatedAt: Date.now(),
    };
    const next = all.slice();
    next[index] = updated;
    this.persist(next);
    return updated;
  }

  /** Patch runtime status fields (connect flows, provider errors). */
  markStatus(
    id: string,
    status: ChannelConnection["status"],
    extra?: { lastError?: string; botName?: string; botId?: string },
  ): ChannelConnection | null {
    const all = this.list();
    const index = all.findIndex((c) => c.id === id);
    if (index === -1) return null;
    const existing = all[index]!;
    const updated: ChannelConnection = {
      ...existing,
      status,
      lastError: extra?.lastError,
      botName: extra?.botName ?? existing.botName,
      botId: extra?.botId ?? existing.botId,
      updatedAt: Date.now(),
    };
    const next = all.slice();
    next[index] = updated;
    this.persist(next);
    return updated;
  }

  /** Set the agent serving new chats on a channel (Custom Agent id or null). */
  setActiveAgent(id: string, agentId: string | null): ChannelConnection | null {
    return this.update(id, { activeAgentId: agentId });
  }

  /** Delete a connection. Returns true when one was removed. */
  delete(id: string): boolean {
    const all = this.list();
    const next = all.filter((c) => c.id !== id);
    if (next.length === all.length) return false;
    this.persist(next);
    return true;
  }

  /**
   * Resolve the initial agent for a freshly created connection: the currently
   * active Custom Agent (when one is active in the app), else the Default Agent.
   * Mirrors the requirement that an already-active Custom Agent carries over to
   * a newly connected channel.
   */
  resolveInitialAgent(customAgents: CustomAgentManager, activeCustomAgentId: string | null): string | null {
    if (activeCustomAgentId && customAgents.get(activeCustomAgentId)) return activeCustomAgentId;
    return null;
  }

  private persist(connections: ChannelConnection[]): void {
    this.appState.set("channels", connections);
  }
}
