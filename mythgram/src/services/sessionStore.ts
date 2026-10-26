import { SessionEventBuffer } from "./eventBuffer.js";

/** One multimodal content part (e.g. { type: "text" } or { type: "image_url" }). */
export type StoredContentPart = Record<string, unknown>;

/** Message shape kept in provider (OpenAI) format so it can be replayed directly to the model. */
export interface StoredMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | StoredContentPart[] | null;
  reasoning_content?: string;
  tool_calls?: Array<Record<string, unknown>>;
  tool_call_id?: string;
  name?: string;
}

export interface ChatSession {
  chatId: string;
  messages: StoredMessage[];
  eventBuffer: SessionEventBuffer | null;
  abortController: AbortController | null;
  running: boolean;
  createdAt: number;
  updatedAt: number;
}

/** In-memory session store keyed by chatId. */
export class SessionStore {
  private readonly sessions = new Map<string, ChatSession>();

  getOrCreate(chatId: string): ChatSession {
    let session = this.sessions.get(chatId);
    if (!session) {
      session = {
        chatId,
        messages: [],
        eventBuffer: null,
        abortController: null,
        running: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.sessions.set(chatId, session);
    }
    return session;
  }

  get(chatId: string): ChatSession | undefined {
    return this.sessions.get(chatId);
  }

  /** Replace the session history from client-provided messages (used to hydrate on reconnect/new turn). */
  hydrate(chatId: string, messages: StoredMessage[]): ChatSession {
    const session = this.getOrCreate(chatId);
    if (messages && messages.length > 0) {
      session.messages = messages.map((m) => ({ ...m }));
      session.updatedAt = Date.now();
    }
    return session;
  }

  delete(chatId: string): void {
    this.sessions.delete(chatId);
  }
}
