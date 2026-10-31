import type Database from "better-sqlite3";

export interface ChannelChatRow {
  id: string;
  channelId: string;
  userKey: string;
  userLabel: string;
  /** Custom Agent id, or null for the built-in Default Agent. */
  agentId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface RawChannelChatRow {
  id: string;
  channel_id: string;
  user_key: string;
  user_label: string;
  agent_id: string | null;
  title: string;
  created_at: number;
  updated_at: number;
}

function toRow(row: RawChannelChatRow): ChannelChatRow {
  return {
    id: row.id,
    channelId: row.channel_id,
    userKey: row.user_key,
    userLabel: row.user_label,
    agentId: row.agent_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Channel chats: one persistent agent conversation per external user per channel
 * connection. All lookups are indexed point reads or per-channel range scans.
 */
export class ChannelChatsRepo {
  private readonly selectOne: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByChannel: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly updateAgent: Database.Statement;
  private readonly touch: Database.Statement;
  private readonly removeByChannel: Database.Statement;
  private readonly countByChannel: Database.Statement;

  constructor(db: Database.Database) {
    this.selectOne = db.prepare(
      `SELECT * FROM channel_chats WHERE channel_id = ? AND user_key = ? ORDER BY updated_at DESC LIMIT 1`,
    );
    this.selectById = db.prepare(`SELECT * FROM channel_chats WHERE id = ?`);
    this.selectByChannel = db.prepare(
      `SELECT * FROM channel_chats WHERE channel_id = ? ORDER BY updated_at DESC`,
    );
    this.upsert = db.prepare(
      `INSERT INTO channel_chats (id, channel_id, user_key, user_label, agent_id, title, created_at, updated_at)
       VALUES (@id, @channelId, @userKey, @userLabel, @agentId, @title, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         user_label = excluded.user_label, agent_id = excluded.agent_id,
         title = excluded.title, updated_at = excluded.updated_at`,
    );
    this.updateAgent = db.prepare(
      `UPDATE channel_chats SET agent_id = ?, updated_at = ? WHERE id = ?`,
    );
    this.touch = db.prepare(
      `UPDATE channel_chats SET user_label = ?, title = ?, updated_at = ? WHERE id = ?`,
    );
    this.removeByChannel = db.prepare(`DELETE FROM channel_chats WHERE channel_id = ?`);
    this.countByChannel = db.prepare(
      `SELECT COUNT(*) AS n FROM channel_chats WHERE channel_id = ?`,
    );
  }

  /** The most recent chat of an external user on a channel, if any. */
  latestForUser(channelId: string, userKey: string): ChannelChatRow | undefined {
    const row = this.selectOne.get(channelId, userKey) as RawChannelChatRow | undefined;
    return row ? toRow(row) : undefined;
  }

  get(id: string): ChannelChatRow | undefined {
    const row = this.selectById.get(id) as RawChannelChatRow | undefined;
    return row ? toRow(row) : undefined;
  }

  listByChannel(channelId: string): ChannelChatRow[] {
    return (this.selectByChannel.all(channelId) as RawChannelChatRow[]).map(toRow);
  }

  save(row: ChannelChatRow): void {
    this.upsert.run({
      id: row.id,
      channelId: row.channelId,
      userKey: row.userKey,
      userLabel: row.userLabel,
      agentId: row.agentId,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  /** Switch the agent serving a chat (Custom Agent id, or null for the Default Agent). */
  setAgent(id: string, agentId: string | null): void {
    this.updateAgent.run(agentId, Date.now(), id);
  }

  touchChat(id: string, userLabel: string, title: string): void {
    this.touch.run(userLabel, title, Date.now(), id);
  }

  deleteByChannel(channelId: string): void {
    this.removeByChannel.run(channelId);
  }

  count(channelId: string): number {
    const row = this.countByChannel.get(channelId) as { n: number } | undefined;
    return row?.n ?? 0;
  }
}
