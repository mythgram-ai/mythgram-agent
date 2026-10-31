import type { StoredMessage } from "../services/sessionStore.js";
import type { SubAgentDefinition } from "./tools/types.js";

/** Terminal (or in-flight) state a stored sub-agent session can be in. */
export type SubAgentSessionStatus = "running" | "completed" | "failed" | "aborted";

/**
 * A single sub-agent session — one run created by call_sub_agent or call_multiple_sub_agents,
 * keyed by its 10-character session id. Beyond the row the write queue stores in `sub_agent_runs`,
 * this record additionally keeps the FULL provider-format conversation (`messages`) and the exact
 * `systemPrompt` + `definition` used, so a later reuse_same_sub_agent_session call can continue the
 * very same conversation with its preserved context.
 */
export interface SubAgentSessionRecord {
  /** 10-character sub-agent session id (created by createSubAgentSessionId). */
  sessionId: string;
  /** Chat session that owns this sub-agent run. */
  chatId: string;
  /** Name of the sub-agent that ran. */
  agent: string;
  /** The definition (system prompt source + allowed tools) used for the run — needed to continue it. */
  definition: SubAgentDefinition;
  /** The fully-rendered system prompt the sub-agent ran under. */
  systemPrompt: string;
  /** The complete provider-format conversation of the sub-agent (grows on every reuse). */
  messages: StoredMessage[];
  /** Current lifecycle state of the session. */
  status: SubAgentSessionStatus;
  /** The original task the sub-agent was first given. */
  task: string;
  /** Whether the run was launched in the background (wait_for_output=false). */
  background: boolean;
  /** Whether the main agent shared its conversation context with the sub-agent. */
  hasSharedContext: boolean;
  /** Epoch ms of the last update. */
  updatedAt: number;
}

/** Upper bound on retained sessions PER CHAT so a long-lived chat cannot grow memory without bound. */
const MAX_SESSIONS_PER_CHAT = 200;

/**
 * Process-level registry of sub-agent sessions, keyed by chatId then by the 10-character session id.
 *
 * The sub-agent runtime is rebuilt every turn, so cross-turn reuse needs a store that outlives a
 * single turn: this singleton is that store. It complements — rather than replaces — the existing
 * `sub_agent_runs` persistence (the write queue still records every run); it simply also holds the
 * conversation transcript that reuse needs and that the event log does not expose in provider shape.
 */
export class SubAgentSessionStore {
  private readonly byChat = new Map<string, Map<string, SubAgentSessionRecord>>();

  /** Register (or refresh) a session at run start. Idempotent on the session id. */
  register(record: {
    sessionId: string;
    chatId: string;
    agent: string;
    definition: SubAgentDefinition;
    systemPrompt: string;
    messages: StoredMessage[];
    task: string;
    background: boolean;
    hasSharedContext: boolean;
    status?: SubAgentSessionStatus;
  }): void {
    const chatId = record.chatId || "";
    let sessions = this.byChat.get(chatId);
    if (!sessions) {
      sessions = new Map<string, SubAgentSessionRecord>();
      this.byChat.set(chatId, sessions);
    }
    sessions.set(record.sessionId, {
      sessionId: record.sessionId,
      chatId,
      agent: record.agent,
      definition: record.definition,
      systemPrompt: record.systemPrompt,
      messages: record.messages,
      status: record.status ?? "running",
      task: record.task,
      background: record.background,
      hasSharedContext: record.hasSharedContext,
      updatedAt: Date.now(),
    });

    // Evict the oldest sessions once the per-chat cap is exceeded (insertion order preserved by Map).
    while (sessions.size > MAX_SESSIONS_PER_CHAT) {
      const oldest = sessions.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  }

  /** Update a session's transcript and status after a run (or reuse) completes. */
  update(
    chatId: string,
    sessionId: string,
    patch: { messages?: StoredMessage[]; status?: SubAgentSessionStatus },
  ): void {
    const record = this.byChat.get(chatId || "")?.get(sessionId);
    if (!record) return;
    if (patch.messages) record.messages = patch.messages;
    if (patch.status) record.status = patch.status;
    record.updatedAt = Date.now();
  }

  /** Look up a single session by id within a chat. */
  get(chatId: string, sessionId: string): SubAgentSessionRecord | undefined {
    return this.byChat.get(chatId || "")?.get(sessionId);
  }

  /** All sessions for a chat, in creation order (oldest first). */
  list(chatId: string): SubAgentSessionRecord[] {
    const sessions = this.byChat.get(chatId || "");
    return sessions ? Array.from(sessions.values()) : [];
  }

  /** Remove every session for a chat (used by tests to isolate state). */
  clear(chatId: string): void {
    this.byChat.delete(chatId || "");
  }
}

/** The single shared instance used by the sub-agent runtime and the session tools. */
export const subAgentSessionStore = new SubAgentSessionStore();
