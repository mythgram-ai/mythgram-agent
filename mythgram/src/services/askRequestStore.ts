/**
 * In-memory store that coordinates human-in-the-loop information requests collected by the
 * `ask_for_something` tool. When the tool is called it registers a pending request here and awaits
 * its resolution. A separate HTTP endpoint (POST /api/chat/ask/:chatId/:toolCallId) supplies the
 * user's values (or a rejection). If the user never responds the pending request auto-resolves with
 * `decision: "timeout"` after `timeoutMs` so the agent can continue autonomously.
 *
 * The store is a singleton shared by the agent surfaces (to register/await) and the chat router (to
 * supply values), so a tool call and the user's UI action stay in sync.
 *
 * It mirrors QuestionStore (the ask_question_to_user mechanism) but models free-form information
 * requests — each item is a prompt + placeholder rather than a question with predefined options —
 * and supports per-item rejection as well as reject-all.
 */
export type AskRequestDecision = "submitted" | "rejected" | "timeout" | "aborted";

/** One piece of information the tool asks the user for. */
export interface AskRequestItem {
  /** Explains what information the user needs to provide and why. */
  request: string;
  /** Placeholder displayed inside the item's input field. */
  placeholder: string;
}

/** One user-supplied value, paired with the request it answers. */
export interface AskRequestValue {
  /** The request this value answers (exact text the tool provided). */
  request: string;
  /** The value the user typed (empty when the item was rejected). */
  value: string;
  /** True when the user rejected this individual item. */
  rejected: boolean;
}

export interface AskRequestResult {
  decision: AskRequestDecision;
  /** Present when the user submitted (decision "submitted"); includes rejected items. */
  values?: AskRequestValue[];
  durationMs?: number;
}

export interface AskRequestOptions {
  chatId: string;
  toolCallId: string;
  items: AskRequestItem[];
  timeoutMs: number;
  /** When supplied, an already-resolved abort also resolves the pending request. */
  signal?: AbortSignal;
}

interface PendingAskRequest {
  resolve: (result: AskRequestResult) => void;
  timer: NodeJS.Timeout;
  chatId: string;
  toolCallId: string;
  items: AskRequestItem[];
  createdAt: number;
}

export class AskRequestStore {
  private readonly pending = new Map<string, PendingAskRequest>();

  /** Key a pending request by chatId + toolCallId so values can locate it precisely. */
  private key(chatId: string, toolCallId: string): string {
    return `${chatId}::${toolCallId}`;
  }

  /**
   * Register a set of information requests awaiting human input and return a promise that resolves
   * with the outcome. Resolution happens when:
   *  - the user submits values via `submit` (submitted), or
   *  - the user rejects everything via `reject` (rejected), or
   *  - `timeoutMs` elapses (timeout), or
   *  - the provided abort signal fires (aborted).
   * The first of these to occur wins; the rest are ignored safely.
   */
  create(options: AskRequestOptions): Promise<AskRequestResult> {
    const existing = this.pending.get(this.key(options.chatId, options.toolCallId));
    if (existing) {
      // Reuse the already-pending request to avoid losing a prior reference.
      return new Promise<AskRequestResult>((resolve) => {
        existing.resolve = resolve;
      });
    }

    return new Promise<AskRequestResult>((resolve) => {
      const startedAt = Date.now();
      let settled = false;

      const resolveOnce = (result: AskRequestResult): void => {
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
        items: options.items,
        createdAt: startedAt,
      });
    });
  }

  /**
   * Supply the user's values for a pending request. Returns false when no matching pending request
   * exists (already submitted, timed out, unknown id, or aborted) — the caller should treat a
   * `false` result as a no-op.
   */
  submit(chatId: string, toolCallId: string, values: AskRequestValue[]): boolean {
    const pendingReq = this.pending.get(this.key(chatId, toolCallId));
    if (!pendingReq) return false;

    pendingReq.resolve({
      decision: "submitted",
      values,
      durationMs: Date.now() - pendingReq.createdAt,
    });
    return true;
  }

  /**
   * Reject the whole request (the "Reject all" action) without supplying any values. Returns false
   * when no matching pending request exists.
   */
  reject(chatId: string, toolCallId: string): boolean {
    const pendingReq = this.pending.get(this.key(chatId, toolCallId));
    if (!pendingReq) return false;

    pendingReq.resolve({
      decision: "rejected",
      values: [],
      durationMs: Date.now() - pendingReq.createdAt,
    });
    return true;
  }

  /** Force-resolve any pending request matching the id (unused in normal flow; kept for teardown). */
  cancel(chatId: string, toolCallId: string, reason: AskRequestDecision = "aborted"): boolean {
    const pendingReq = this.pending.get(this.key(chatId, toolCallId));
    if (!pendingReq) return false;
    pendingReq.resolve({ decision: reason, durationMs: Date.now() - pendingReq.createdAt });
    return true;
  }

  get size(): number {
    return this.pending.size;
  }
}
