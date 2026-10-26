/**
 * In-memory store that coordinates human-in-the-loop approval of plans submitted by the
 * `submit_plan` tool. When the tool is called it registers a pending request here and awaits
 * its resolution. A separate HTTP endpoint (POST /api/chat/plan/:chatId/:toolCallId) supplies
 * the user's decision (approve / cancel / edited-with-new-plan). If the user never responds the
 * pending request auto-resolves with `decision: "timeout"` after `timeoutMs` so the agent can
 * continue autonomously.
 *
 * The store is a singleton shared by the agent (to register/await) and the chat router (to
 * supply decisions), so a tool call and the user's UI action stay in sync.
 */
export type PlanDecision = "approved" | "canceled" | "edited" | "timeout" | "aborted";

export interface PlanApprovalResult {
  decision: PlanDecision;
  /** Present when the user edited and re-submitted the plan. */
  plan?: string;
  /** Present when the user approved/canceled so callers know the elapsed wait. */
  durationMs?: number;
}

export interface PlanApprovalOptions {
  chatId: string;
  toolCallId: string;
  plan: string;
  timeoutMs: number;
  /** When supplied, an already-resolved abort also resolves the pending request. */
  signal?: AbortSignal;
}

interface PendingPlan {
  resolve: (result: PlanApprovalResult) => void;
  timer: NodeJS.Timeout;
  chatId: string;
  toolCallId: string;
  plan: string;
  createdAt: number;
}

export class PlanApprovalStore {
  private readonly pending = new Map<string, PendingPlan>();

  /** Key a pending request by chatId + toolCallId so decisions can locate it precisely. */
  private key(chatId: string, toolCallId: string): string {
    return `${chatId}::${toolCallId}`;
  }

  /**
   * Register a plan awaiting human review and return a promise that resolves with the outcome.
   * Resolution happens when:
   *  - the user decides via `decide` (approved / canceled / edited), or
   *  - `timeoutMs` elapses (timeout), or
   *  - the provided abort signal fires (aborted).
   * The first of these to occur wins; the rest are ignored safely.
   */
  create(options: PlanApprovalOptions): Promise<PlanApprovalResult> {
    const existing = this.pending.get(this.key(options.chatId, options.toolCallId));
    if (existing) {
      // Reuse the already-pending request to avoid losing a prior decision reference.
      return new Promise<PlanApprovalResult>((resolve) => {
        existing.resolve = resolve;
      });
    }

    return new Promise<PlanApprovalResult>((resolve) => {
      const startedAt = Date.now();
      let settled = false;

      const resolveOnce = (result: PlanApprovalResult): void => {
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
        plan: options.plan,
        createdAt: startedAt,
      });
    });
  }

  /**
   * Supply a user decision for a pending plan. Returns false when no matching pending request
   * exists (already decided, timed out, unknown id, or aborted) — the caller should treat a
   * `false` result as a no-op.
   */
  decide(chatId: string, toolCallId: string, decision: "approved" | "canceled" | "edited", plan?: string): boolean {
    const pending = this.pending.get(this.key(chatId, toolCallId));
    if (!pending) return false;

    if (decision === "edited" && typeof plan !== "string") {
      plan = pending.plan;
    }

    pending.resolve({
      decision,
      plan,
      durationMs: Date.now() - pending.createdAt,
    });
    return true;
  }

  /** Force-resolve any pending request matching the id (unused in normal flow; kept for teardown). */
  cancel(chatId: string, toolCallId: string, reason: PlanDecision = "aborted"): boolean {
    const pending = this.pending.get(this.key(chatId, toolCallId));
    if (!pending) return false;
    pending.resolve({ decision: reason, durationMs: Date.now() - pending.createdAt });
    return true;
  }

  get size(): number {
    return this.pending.size;
  }
}