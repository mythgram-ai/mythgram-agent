/**
 * In-memory store that coordinates human-in-the-loop answers collected by the
 * `ask_question_to_user` tool. When the tool is called it registers a pending request
 * here and awaits its resolution. A separate HTTP endpoint (POST /api/chat/question/
 * :chatId/:toolCallId) supplies the user's answers. If the user never responds the
 * pending request auto-resolves with `decision: "timeout"` after `timeoutMs` so the
 * agent can continue autonomously.
 *
 * The store is a singleton shared by the agent (to register/await) and the chat router
 * (to supply answers), so a tool call and the user's UI action stay in sync.
 */
export type QuestionDecision = "answered" | "timeout" | "aborted";

/** A single question the tool surfaces to the user. */
export interface PendingQuestion {
  question: string;
  context: string;
  options: string[];
}

/** One user-provided answer, paired with the question it answers. */
export interface QuestionAnswer {
  question: string;
  answer: string;
}

export interface QuestionResult {
  decision: QuestionDecision;
  /** Present when the user answered all of the questions. */
  answers?: QuestionAnswer[];
  durationMs?: number;
}

export interface QuestionOptions {
  chatId: string;
  toolCallId: string;
  questions: PendingQuestion[];
  timeoutMs: number;
  /** When supplied, an already-resolved abort also resolves the pending request. */
  signal?: AbortSignal;
}

interface PendingQuestionRequest {
  resolve: (result: QuestionResult) => void;
  timer: NodeJS.Timeout;
  chatId: string;
  toolCallId: string;
  questions: PendingQuestion[];
  createdAt: number;
}

export class QuestionStore {
  private readonly pending = new Map<string, PendingQuestionRequest>();

  /** Key a pending request by chatId + toolCallId so answers can locate it precisely. */
  private key(chatId: string, toolCallId: string): string {
    return `${chatId}::${toolCallId}`;
  }

  /**
   * Register a set of questions awaiting human answers and return a promise that resolves
   * with the outcome. Resolution happens when:
   *  - the user answers via `submitAnswers`, or
   *  - `timeoutMs` elapses (timeout), or
   *  - the provided abort signal fires (aborted).
   * The first of these to occur wins; the rest are ignored safely.
   */
  create(options: QuestionOptions): Promise<QuestionResult> {
    const existing = this.pending.get(this.key(options.chatId, options.toolCallId));
    if (existing) {
      // Reuse the already-pending request to avoid losing a prior reference.
      return new Promise<QuestionResult>((resolve) => {
        existing.resolve = resolve;
      });
    }

    return new Promise<QuestionResult>((resolve) => {
      const startedAt = Date.now();
      let settled = false;

      const resolveOnce = (result: QuestionResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        onAbort?.();
        this.pending.delete(this.key(options.chatId, options.toolCallId));
      };

      let timer: NodeJS.Timeout | undefined = setTimeout(() => {
        resolveOnce({ decision: "timeout", durationMs: Date.now() - startedAt });
      }, options.timeoutMs);

      const onAbort = options.signal
        ? () => options.signal?.removeEventListener("abort", handleAbort)
        : undefined;
      const handleAbort = (): void => {
        resolveOnce({ decision: "aborted", durationMs: Date.now() - startedAt });
      };
      if (options.signal?.aborted) {
        handleAbort();
      } else {
        options.signal?.addEventListener("abort", handleAbort, { once: true });
      }

      this.pending.set(this.key(options.chatId, options.toolCallId), {
        resolve: (result) => resolveOnce(result),
        timer: timer as NodeJS.Timeout,
        chatId: options.chatId,
        toolCallId: options.toolCallId,
        questions: options.questions,
        createdAt: startedAt,
      });
    });
  }

  /**
   * Supply the user's answers for a pending question set. Returns false when no matching
   * pending request exists (already answered, timed out, unknown id, or aborted) — the
   * caller should treat a `false` result as a no-op.
   */
  submitAnswers(
    chatId: string,
    toolCallId: string,
    answers: QuestionAnswer[],
  ): boolean {
    const pending = this.pending.get(this.key(chatId, toolCallId));
    if (!pending) return false;

    pending.resolve({
      decision: "answered",
      answers,
      durationMs: Date.now() - pending.createdAt,
    });
    return true;
  }

  /** Force-resolve any pending request matching the id (unused in normal flow; kept for teardown). */
  cancel(chatId: string, toolCallId: string, reason: QuestionDecision = "aborted"): boolean {
    const pending = this.pending.get(this.key(chatId, toolCallId));
    if (!pending) return false;
    pending.resolve({ decision: reason, durationMs: Date.now() - pending.createdAt });
    return true;
  }

  get size(): number {
    return this.pending.size;
  }
}