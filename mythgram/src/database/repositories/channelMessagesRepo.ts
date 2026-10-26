import type Database from "better-sqlite3";
import type { StoredMessage } from "../../services/sessionStore.js";

/**
 * Provider-format transcript per channel chat. Bulk writes replace the whole transcript
 * after each completed turn; reads hydrate the agent conversation. Mirrors MessagesRepo.
 */
export class ChannelMessagesRepo {
  private readonly selectByChat: Database.Statement;
  private readonly countByChat: Database.Statement;
  private readonly deleteByChat: Database.Statement;
  private readonly insertMessage: Database.Statement;
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.selectByChat = db.prepare(
      `SELECT data FROM channel_messages WHERE chat_id = ? ORDER BY seq ASC`,
    );
    this.countByChat = db.prepare(
      `SELECT COUNT(*) AS n FROM channel_messages WHERE chat_id = ?`,
    );
    this.deleteByChat = db.prepare(`DELETE FROM channel_messages WHERE chat_id = ?`);
    this.insertMessage = db.prepare(
      `INSERT INTO channel_messages (chat_id, seq, role, data, created_at) VALUES (?, ?, ?, ?, ?)`,
    );
  }

  list(chatId: string): StoredMessage[] {
    const rows = this.selectByChat.all(chatId) as Array<{ data: string }>;
    const out: StoredMessage[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.data) as StoredMessage;
        if (parsed && typeof parsed === "object" && typeof parsed.role === "string") {
          out.push(parsed);
        }
      } catch {
        // Skip unreadable rows rather than failing the whole transcript.
      }
    }
    return out;
  }

  count(chatId: string): number {
    const row = this.countByChat.get(chatId) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /** Replace the whole transcript (last write wins). */
  replace(chatId: string, messages: StoredMessage[]): void {
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.deleteByChat.run(chatId);
      for (let seq = 0; seq < messages.length; seq += 1) {
        const message = messages[seq] as unknown as Record<string, unknown> | null;
        if (!message || typeof message !== "object") continue;
        let json: string;
        try {
          json = JSON.stringify(message);
        } catch {
          continue;
        }
        this.insertMessage.run(
          chatId,
          seq,
          typeof message.role === "string" ? (message.role as string) : "unknown",
          json,
          now,
        );
      }
    });
    tx();
  }

  deleteByChatId(chatId: string): void {
    this.deleteByChat.run(chatId);
  }
}
