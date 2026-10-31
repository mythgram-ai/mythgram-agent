import { useStore } from "@/store/useStore";

/**
 * Coalesces high-frequency stream deltas (assistant tokens/reasoning and each sub-agent's
 * output/reasoning) and flushes them to the store at most once per animation frame.
 *
 * This is the core render/state optimization: a fast model can emit thousands of tokens per
 * second, but the UI only needs to repaint ~once per frame. Batching turns N store writes into
 * 1 per frame, keeping long, streaming agent responses smooth. Persistence happens entirely on
 * the backend (SQLite) — the browser holds runtime state only.
 */
export class StreamBatcher {
  private content = "";
  private reasoning = "";
  private cursor: number | null = null;
  private readonly sub = new Map<string, { output: string; reasoning: string }>();
  private readonly team = new Map<string, { output: string; reasoning: string }>();
  private frame: number | null = null;
  private disposed = false;

  constructor(
    private readonly convId: string,
    private readonly msgId: string,
  ) {}

  token(delta: string): void {
    this.content += delta;
    this.schedule();
  }

  appendReasoning(delta: string): void {
    this.reasoning += delta;
    this.schedule();
  }

  cursorTo(eventId: number): void {
    this.cursor = eventId;
    this.schedule();
  }

  subToken(toolId: string, delta: string): void {
    this.bucket(toolId).output += delta;
    this.schedule();
  }

  subReasoning(toolId: string, delta: string): void {
    this.bucket(toolId).reasoning += delta;
    this.schedule();
  }

  /** Coalesce a team agent's streamed answer tokens, keyed by its agent id. */
  teamToken(agentId: string, delta: string): void {
    this.teamBucket(agentId).output += delta;
    this.schedule();
  }

  /** Coalesce a team agent's streamed reasoning, keyed by its agent id. */
  teamReasoning(agentId: string, delta: string): void {
    this.teamBucket(agentId).reasoning += delta;
    this.schedule();
  }

  /** Flush immediately (used before any non-delta event so ordering stays correct). */
  flush(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    this.commit();
  }

  dispose(): void {
    this.disposed = true;
    this.flush();
  }

  private bucket(toolId: string) {
    let b = this.sub.get(toolId);
    if (!b) {
      b = { output: "", reasoning: "" };
      this.sub.set(toolId, b);
    }
    return b;
  }

  private teamBucket(agentId: string) {
    let b = this.team.get(agentId);
    if (!b) {
      b = { output: "", reasoning: "" };
      this.team.set(agentId, b);
    }
    return b;
  }

  private schedule(): void {
    if (this.disposed || this.frame !== null) return;
    this.frame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => {
            this.frame = null;
            this.commit();
          })
        : (setTimeout(() => {
            this.frame = null;
            this.commit();
          }, 16) as unknown as number);
  }

  private commit(): void {
    const store = useStore.getState();

    if (this.content || this.reasoning || this.cursor !== null) {
      store.applyAssistantDelta(this.convId, this.msgId, {
        contentDelta: this.content || undefined,
        reasoningDelta: this.reasoning || undefined,
        lastEventId: this.cursor ?? undefined,
      });
      this.content = "";
      this.reasoning = "";
      this.cursor = null;
    }

    if (this.sub.size > 0) {
      for (const [toolId, b] of this.sub) {
        if (b.output || b.reasoning) {
          store.applySubAgentDelta(this.convId, this.msgId, toolId, {
            outputDelta: b.output || undefined,
            reasoningDelta: b.reasoning || undefined,
          });
        }
      }
      this.sub.clear();
    }

    if (this.team.size > 0) {
      for (const [agentId, b] of this.team) {
        if (b.output || b.reasoning) {
          store.applyTeamAgentDelta(this.convId, this.msgId, agentId, {
            outputDelta: b.output || undefined,
            reasoningDelta: b.reasoning || undefined,
          });
        }
      }
      this.team.clear();
    }
  }
}
