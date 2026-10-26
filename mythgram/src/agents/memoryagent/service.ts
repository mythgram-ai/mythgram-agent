import type { AppConfig } from "../../config.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { resolveProvider } from "../providers/registry.js";
import type { ToolRegistry } from "../tools/index.js";
import type { MemoryFile } from "../tools/types.js";
import type { MythgramDatabase } from "../../database/index.js";
import { createSubAgentSessionId } from "../../database/ids.js";
import type {
  MemoryAgentRunCounts,
  MemoryAgentRunRow,
  StoredMemoryAgentEvent,
} from "../../database/repositories/memoryAgentRunsRepo.js";
import { SessionEventBuffer } from "../../services/eventBuffer.js";
import { MemoryAgentEventPersister } from "./eventPersister.js";
import { runMemoryAgent } from "./runner.js";
import { MEMORY_AGENT_NAME, type MemoryAgentBuildRequest } from "./types.js";

/** How long a finished run's live buffer stays attachable before the DB replay takes over. */
const LIVE_BUFFER_RETENTION_MS = 60_000;

/** Bound long-term growth: only the newest runs (and their event logs) are retained. */
const MAX_RETAINED_RUNS = 200;

interface QueueItem {
  runId: string;
  request: MemoryAgentBuildRequest;
  /** When the request entered the queue — used to detect state written by later-finishing runs. */
  queuedAt: number;
}

/**
 * The background memory agent ("memoryagent") — a fully backend-side autonomous agent that
 * builds/updates the user's memory files after every completed main-agent turn.
 *
 * - Every trigger starts a BRAND-NEW memory-agent session (sessions are never reused).
 * - Requests are processed through a strict FIFO queue, one run at a time: if the main
 *   agent finishes another task while a memory build is running, the new request waits
 *   until the running build completes.
 * - Runs are unstoppable: there is no abort path and no iteration limit.
 * - Everything is persisted in the local SQLite database (run rows, the full coalesced
 *   event stream, and the resulting memory files via app_state) — nothing lives in the
 *   browser. The frontend only attaches to the SSE stream to WATCH a run.
 */
export class MemoryAgentService {
  private readonly queue: QueueItem[] = [];
  private processing = false;
  private readonly liveBuffers = new Map<string, SessionEventBuffer>();

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly tools: ToolRegistry,
    private readonly config: AppConfig,
    private readonly db: MythgramDatabase,
  ) {}

  /**
   * Enqueue a memory build for a just-finished main-agent turn. Returns the id of the new
   * memory-agent session immediately; the run executes in the background via the queue.
   * Never throws — a failure to enqueue must not break the chat flow.
   */
  enqueue(request: MemoryAgentBuildRequest): string | null {
    try {
      const runId = createSubAgentSessionId();
      this.db.memoryAgentRuns.createQueued(runId, request.chatId, request.provider, request.model);
      this.queue.push({ runId, request, queuedAt: Date.now() });
      void this.processQueue();
      return runId;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[${MEMORY_AGENT_NAME}] failed to enqueue run:`, error);
      return null;
    }
  }

  /** Run metadata for the sessions popup (most recent first). */
  listRuns(limit = 50): MemoryAgentRunRow[] {
    return this.db.memoryAgentRuns.list(limit);
  }

  counts(): MemoryAgentRunCounts {
    return this.db.memoryAgentRuns.counts();
  }

  getRun(id: string): MemoryAgentRunRow | undefined {
    return this.db.memoryAgentRuns.get(id);
  }

  /** The live event buffer of a queued/running (or very recently finished) run. */
  liveBuffer(id: string): SessionEventBuffer | undefined {
    return this.liveBuffers.get(id);
  }

  /** Persisted event log for replaying finished runs after the live buffer is gone. */
  storedEvents(id: string, sinceId: number): StoredMemoryAgentEvent[] {
    return this.db.memoryAgentRuns.listEventsSince(id, sinceId);
  }

  /** Strict FIFO, one run at a time. Re-entrant safe. */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      for (;;) {
        const item = this.queue.shift();
        if (!item) break;
        await this.execute(item);
      }
    } finally {
      this.processing = false;
      // A request may have arrived in the gap between the last shift and the flag reset.
      if (this.queue.length > 0) void this.processQueue();
    }
  }

  /** Execute one run end-to-end. Never throws (all failures are recorded on the run row). */
  private async execute(item: QueueItem): Promise<void> {
    const { runId, request } = item;
    const persister = new MemoryAgentEventPersister(this.db.memoryAgentRuns, runId);
    const buffer = new SessionEventBuffer((id, event, data) => persister.append(id, event, data));
    this.liveBuffers.set(runId, buffer);

    const send = (event: string, data: Record<string, unknown>): number =>
      buffer.append(event, data);

    try {
      this.db.memoryAgentRuns.markRunning(runId);
    } catch {
      // proceed anyway — the run itself matters more than the bookkeeping row
    }

    send("memory_agent_start", {
      run_id: runId,
      agent: MEMORY_AGENT_NAME,
      chat_id: request.chatId,
      provider: request.provider,
      model: request.model,
      queued_remaining: this.queue.length,
    });

    let status: "completed" | "failed" = "failed";
    let summary = "";
    let error: string | undefined;
    let updatedFiles: string[] = [];

    try {
      const provider = resolveProvider(this.providers, request.provider, request.customProvider);
      // Refresh the memory baseline at EXECUTE time: while this request waited in the
      // queue, earlier runs may already have updated some files — their newer state must
      // not be clobbered by this request's older snapshot.
      const effectiveRequest: MemoryAgentBuildRequest = {
        ...request,
        memoryFiles: this.resolveBaselineMemory(request, item.queuedAt),
      };
      const outcome = await runMemoryAgent({
        provider,
        tools: this.tools,
        config: this.config,
        request: effectiveRequest,
        send,
        onMemoryChanged: (files) => this.persistMemory(files),
      });

      // Belt and braces: persist the final memory state even if no mutation event fired last.
      this.persistMemory(outcome.memoryFiles);

      status = outcome.ok ? "completed" : "failed";
      summary = outcome.summary;
      error = outcome.error;
      updatedFiles = outcome.updatedFiles;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      send("error", { code: "memory_agent_crashed", message: error });
    }

    send("done", {
      ok: status === "completed",
      run_id: runId,
      updated_files: updatedFiles,
      ...(error ? { error } : {}),
    });
    buffer.setDone();

    try {
      this.db.memoryAgentRuns.markFinished(runId, {
        status,
        summary,
        error: error ?? null,
        updatedFiles,
        lastEventId: buffer.lastEventId,
      });
    } catch {
      // best effort
    }

    // Final flush AFTER the terminal events so the persisted log always ends with `done`.
    persister.close();

    try {
      this.db.memoryAgentRuns.pruneOldRuns(MAX_RETAINED_RUNS);
    } catch {
      // best effort
    }

    // Keep the live buffer attachable briefly, then let the database replay take over.
    const timer = setTimeout(() => {
      if (this.liveBuffers.get(runId) === buffer) this.liveBuffers.delete(runId);
    }, LIVE_BUFFER_RETENTION_MS);
    timer.unref?.();
  }

  /**
   * Persist the current memory files into the SQLite app_state document — the same document
   * the frontend hydrates from on boot — so the memory agent's work is durable server-side
   * regardless of whether any browser is open or attached.
   */
  private persistMemory(files: MemoryFile[]): void {
    try {
      this.db.appState.set("memory", files);
    } catch {
      // Persistence must never break the run.
    }
  }

  /**
   * The memory files this run should start from. The request snapshot is authoritative for
   * the turn's own state (it includes the main agent's in-turn memory writes), EXCEPT for
   * files that memory-agent runs finishing AFTER this request was enqueued have touched —
   * those runs are strictly newer (the queue is FIFO), so their app_state versions win.
   * Never throws; falls back to the raw snapshot.
   */
  private resolveBaselineMemory(request: MemoryAgentBuildRequest, queuedAt: number): MemoryFile[] {
    try {
      const newerRuns = this.db.memoryAgentRuns
        .list(50)
        .filter(
          (run) =>
            run.status === "completed" &&
            typeof run.finishedAt === "number" &&
            run.finishedAt >= queuedAt &&
            run.updatedFiles.length > 0,
        );
      if (newerRuns.length === 0) return request.memoryFiles;

      const stored = this.db.appState.get("memory");
      const storedByPath = new Map<string, MemoryFile>();
      if (Array.isArray(stored)) {
        for (const item of stored) {
          if (!item || typeof item !== "object") continue;
          const file = item as Record<string, unknown>;
          if (typeof file.path !== "string" || file.path.length === 0) continue;
          storedByPath.set(file.path.toLowerCase(), {
            path: file.path,
            content: typeof file.content === "string" ? file.content : "",
          });
        }
      }

      const merged = new Map<string, MemoryFile>(
        request.memoryFiles.map((f) => [f.path.toLowerCase(), { ...f }]),
      );
      for (const run of newerRuns) {
        for (const path of run.updatedFiles) {
          const key = path.toLowerCase();
          const newer = storedByPath.get(key);
          if (newer) merged.set(key, { ...newer });
          else merged.delete(key); // that run deleted the file
        }
      }
      return [...merged.values()];
    } catch {
      return request.memoryFiles;
    }
  }
}
