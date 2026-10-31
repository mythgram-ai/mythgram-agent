import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";
import { parseSSEStream } from "@/lib/sse";
import { useStore } from "@/store/useStore";
import type {
  MemoryAgentRunCounts,
  MemoryAgentRunMeta,
  MemoryAgentRunStatus,
  MemoryFile,
  SSEEventData,
} from "@/types";

/**
 * Watch-only client for the background memory agent. The agent itself runs ENTIRELY in the
 * backend (triggered after every completed main-agent turn, queued FIFO, persisted in
 * SQLite); this module only fetches session metadata and attaches to a run's SSE stream so
 * the UI can render it live — and mirrors the agent's `memory_updated` events into the
 * local memory slice so the browser converges on the backend's memory state.
 */

const EMPTY_COUNTS: MemoryAgentRunCounts = {
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  total: 0,
};

/** Wire shape of one run as served by GET /api/memory-agent/runs. */
interface WireRun {
  id?: string;
  chat_session_id?: string;
  status?: string;
  provider?: string;
  model?: string;
  summary?: string;
  error?: string | null;
  updated_files?: unknown;
  queued_at?: number;
  started_at?: number | null;
  finished_at?: number | null;
}

function toMeta(run: WireRun): MemoryAgentRunMeta | null {
  if (!run || typeof run.id !== "string" || run.id.length === 0) return null;
  const status: MemoryAgentRunStatus =
    run.status === "queued" || run.status === "running" || run.status === "completed"
      ? run.status
      : "failed";
  return {
    id: run.id,
    chatSessionId: typeof run.chat_session_id === "string" ? run.chat_session_id : "",
    status,
    provider: typeof run.provider === "string" ? run.provider : "",
    model: typeof run.model === "string" ? run.model : "",
    summary: typeof run.summary === "string" ? run.summary : "",
    error: typeof run.error === "string" ? run.error : null,
    updatedFiles: Array.isArray(run.updated_files)
      ? run.updated_files.filter((p): p is string => typeof p === "string")
      : [],
    queuedAt: typeof run.queued_at === "number" ? run.queued_at : 0,
    startedAt: typeof run.started_at === "number" ? run.started_at : null,
    finishedAt: typeof run.finished_at === "number" ? run.finished_at : null,
  };
}

/** Refresh the sessions list + counts from the backend into the store. */
export async function refreshMemoryAgentRuns(): Promise<MemoryAgentRunMeta[]> {
  const data = await requestJson<{ runs?: WireRun[]; counts?: Partial<MemoryAgentRunCounts> }>(
    routeUrl(API_ROUTES.memoryAgentRuns, { query: { limit: 50 } }),
  );
  const runs = (data.runs ?? []).map(toMeta).filter((r): r is MemoryAgentRunMeta => r !== null);
  const counts: MemoryAgentRunCounts = { ...EMPTY_COUNTS, ...(data.counts ?? {}) };
  useStore.getState().setMemoryAgentRuns(runs, counts);
  return runs;
}

/** One watcher per run id — attaching twice (SSE event + post-turn fallback) is a no-op. */
const activeWatchers = new Set<string>();
/** Last mid-run error message per run, surfaced when the terminal `done` arrives. */
const lastRunError = new Map<string, string>();

/**
 * Attach to a memory-agent run's SSE stream and mirror it into the store. Works for live
 * runs (streams in real time) AND finished runs (the backend replays the persisted log).
 * Reconnects from the last seen event id if the connection drops mid-run.
 */
export function watchMemoryAgentRun(runId: string): void {
  if (!runId || activeWatchers.has(runId)) return;
  activeWatchers.add(runId);
  void driveRunStream(runId).finally(() => {
    activeWatchers.delete(runId);
    lastRunError.delete(runId);
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 1_000;

async function driveRunStream(runId: string): Promise<void> {
  useStore.getState().startMemoryAgentLive(runId);

  let sinceId = -1;
  let finished = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !finished; attempt += 1) {
    try {
      const res = await fetch(routeUrl(API_ROUTES.memoryAgentRunStream, { params: { id: runId } }), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ since_event_id: sinceId }),
        cache: "no-store",
      });
      if (res.status === 404) break;
      if (!res.ok) throw new Error(`stream failed (${res.status})`);

      await parseSSEStream(
        res,
        ({ event, data }) => {
          if (typeof data._event_id === "number") sinceId = Math.max(sinceId, data._event_id);
          if (applyRunEvent(runId, event, data)) finished = true;
        },
        new AbortController().signal,
      );
    } catch {
      // transient network failure — retry from the cursor below
    }
    if (!finished) await sleep(RETRY_DELAY_MS);
  }

  // Stream over (or gave up) — make the sessions list reflect the final DB state.
  void refreshMemoryAgentRuns().catch(() => {});
}

/** Apply one streamed event to the store. Returns true when the event is terminal. */
function applyRunEvent(runId: string, event: string, data: SSEEventData): boolean {
  const store = useStore.getState();

  switch (event) {
    case "reasoning":
      if (typeof data.value === "string") {
        store.applyMemoryAgentDelta(runId, { reasoningDelta: data.value });
      }
      return false;
    case "token":
      if (typeof data.value === "string") {
        store.applyMemoryAgentDelta(runId, { outputDelta: data.value });
      }
      return false;
    case "tool_call":
      store.upsertMemoryAgentTool(runId, {
        id: String(data.id ?? `${runId}_${data._event_id ?? 0}`),
        name: typeof data.name === "string" ? data.name : "memory",
        label: typeof data.label === "string" ? data.label : "Memory",
        status: "running",
        args: data.args,
      });
      return false;
    case "tool_result":
      store.upsertMemoryAgentTool(runId, {
        id: String(data.id ?? `${runId}_${data._event_id ?? 0}`),
        name: typeof data.name === "string" ? data.name : "memory",
        label: typeof data.label === "string" ? data.label : "Memory",
        status: data.ok === false ? "error" : "ok",
        result: data.result,
      });
      return false;
    case "memory_updated":
      // The agent's writes are authoritative — mirror them into the local memory slice
      // (which the persistence bridge then keeps in sync with the backend database).
      if (Array.isArray(data.memoryFiles)) store.setMemory(data.memoryFiles as MemoryFile[]);
      return false;
    case "error":
      if (typeof data.message === "string") lastRunError.set(runId, data.message);
      return false;
    case "done": {
      const error =
        (typeof data.error === "string" && data.error) || lastRunError.get(runId) || undefined;
      store.finishMemoryAgentLive(runId, {
        status: data.ok === true ? "completed" : "failed",
        error: data.ok === true ? undefined : error,
        updatedFiles: Array.isArray(data.updated_files) ? data.updated_files : undefined,
      });
      return true;
    }
    default:
      return false;
  }
}

/**
 * After a main-agent turn finishes, find the memory-build run it enqueued and attach to its
 * stream. The run row is created before the chat stream closes, but poll briefly anyway to
 * absorb any ordering race. Also used on app boot to re-attach to an in-flight run.
 */
export async function attachLatestMemoryAgentRun(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const runs = await refreshMemoryAgentRuns();
      const pending = runs.find((r) => r.status === "queued" || r.status === "running");
      if (pending) {
        watchMemoryAgentRun(pending.id);
        return;
      }
    } catch {
      // backend briefly unreachable — retry
    }
    await sleep(600);
  }
}
