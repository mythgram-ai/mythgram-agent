import type { CeoAgentContext } from "./types.js";

/**
 * Persistent per-chat CEO session: the conversation context of every agent in the CEO system (the
 * CEO + every controlled team's head + members), kept in memory keyed by chatId so that across user
 * turns the whole organization retains its full context — no agent ever loses what it already knows,
 * and no tool call ever spawns a fresh session. This is the CEO counterpart of MultiAgentSessionStore.
 *
 * When the active CEO changes for a chat (the user selected a different CEO), the contexts are reset
 * so the new CEO starts clean.
 */
export interface CeoSession {
  chatId: string;
  ceoId: string;
  /** agent id (lowercased) -> that agent's persistent context. */
  contexts: Map<string, CeoAgentContext>;
}

export class CeoSessionStore {
  private readonly sessions = new Map<string, CeoSession>();

  /** Get the chat's CEO session, resetting it when the active CEO changed. */
  getOrCreate(chatId: string, ceoId: string): CeoSession {
    const existing = this.sessions.get(chatId);
    if (existing && existing.ceoId === ceoId) return existing;
    const session: CeoSession = { chatId, ceoId, contexts: new Map() };
    this.sessions.set(chatId, session);
    return session;
  }

  get(chatId: string): CeoSession | undefined {
    return this.sessions.get(chatId);
  }

  delete(chatId: string): void {
    this.sessions.delete(chatId);
  }
}
