import type { TeamAgentContext } from "./types.js";

/**
 * Persistent per-chat team session: the conversation context of every team agent (head + members),
 * kept in memory keyed by chatId so that across user turns the whole team retains its full context —
 * no agent ever loses what it already knows, and no tool call ever spawns a fresh session.
 *
 * When the active team changes for a chat (the user selected a different team), the contexts are
 * reset so the new team starts clean.
 */
export interface TeamSession {
  chatId: string;
  teamId: string;
  /** agent id (lowercased) -> that agent's persistent context. */
  contexts: Map<string, TeamAgentContext>;
}

export class MultiAgentSessionStore {
  private readonly sessions = new Map<string, TeamSession>();

  /** Get the chat's team session, resetting it when the active team changed. */
  getOrCreate(chatId: string, teamId: string): TeamSession {
    const existing = this.sessions.get(chatId);
    if (existing && existing.teamId === teamId) return existing;
    const session: TeamSession = { chatId, teamId, contexts: new Map() };
    this.sessions.set(chatId, session);
    return session;
  }

  get(chatId: string): TeamSession | undefined {
    return this.sessions.get(chatId);
  }

  delete(chatId: string): void {
    this.sessions.delete(chatId);
  }
}
