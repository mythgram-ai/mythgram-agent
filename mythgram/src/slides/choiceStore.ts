/**
 * In-memory store that coordinates the human-in-the-loop template choice made with
 * ask_user_to_choose_slides_template.
 *
 * The tool registers a pending choice here and awaits its resolution. A separate HTTP
 * endpoint (POST /api/chat/slides-template/:chatId/:toolCallId) supplies the selected
 * template id. If the user never responds, the choice auto-resolves as "timeout" after
 * two minutes so the agent can continue autonomously.
 *
 * It mirrors QuestionStore / AskRequestStore deliberately: same keying, same timeout
 * semantics, same abort handling — only the payload is a single template id.
 */
export type SlidesTemplateChoiceDecision = "selected" | "timeout" | "aborted";

export interface SlidesTemplateChoiceResult {
  decision: SlidesTemplateChoiceDecision;
  /** Present when decision === "selected". */
  templateId?: string;
  durationMs?: number;
}

export interface SlidesTemplateChoiceOptions {
  chatId: string;
  toolCallId: string;
  timeoutMs: number;
  /** When supplied, an already-aborted signal resolves the pending choice as aborted. */
  signal?: AbortSignal;
}

interface PendingChoice {
  resolve: (result: SlidesTemplateChoiceResult) => void;
  timer: NodeJS.Timeout;
  chatId: string;
  toolCallId: string;
  createdAt: number;
}

export class SlidesTemplateChoiceStore {
  private readonly pending = new Map<string, PendingChoice>();

  private key(chatId: string, toolCallId: string): string {
    return `${chatId}::${toolCallId}`;
  }

  /**
   * Register a pending template choice and return a promise resolved by the user's
   * selection, the timeout, or an abort — whichever happens first.
   */
  create(options: SlidesTemplateChoiceOptions): Promise<SlidesTemplateChoiceResult> {
    const existing = this.pending.get(this.key(options.chatId, options.toolCallId));
    if (existing) {
      return new Promise<SlidesTemplateChoiceResult>((resolve) => {
        existing.resolve = resolve;
      });
    }

    return new Promise<SlidesTemplateChoiceResult>((resolve) => {
      const startedAt = Date.now();
      let settled = false;

      const resolveOnce = (result: SlidesTemplateChoiceResult): void => {
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
        createdAt: startedAt,
      });
    });
  }

  /** Supply the user's chosen template id. Returns false when no pending choice exists. */
  select(chatId: string, toolCallId: string, templateId: string): boolean {
    const pending = this.pending.get(this.key(chatId, toolCallId));
    if (!pending) return false;
    pending.resolve({
      decision: "selected",
      templateId,
      durationMs: Date.now() - pending.createdAt,
    });
    return true;
  }

  /** Force-resolve a pending choice (teardown / tests). */
  cancel(
    chatId: string,
    toolCallId: string,
    reason: SlidesTemplateChoiceDecision = "aborted",
  ): boolean {
    const pending = this.pending.get(this.key(chatId, toolCallId));
    if (!pending) return false;
    pending.resolve({ decision: reason, durationMs: Date.now() - pending.createdAt });
    return true;
  }

  get size(): number {
    return this.pending.size;
  }
}