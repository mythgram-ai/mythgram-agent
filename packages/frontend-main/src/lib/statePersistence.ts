import { useStore } from "@/store/useStore";
import type { Conversation, SSEEventData } from "@/types";
import {
  normalizeContextUsageEvent,
  normalizeSubAgentUsageEvent,
  normalizeTeamUsageEvent,
} from "@/lib/contextMeter";
import {
  beaconSessionSnapshot,
  beaconStateKey,
  deleteSessionData,
  fetchBootState,
  fetchSessionDetail,
  saveSessionSnapshot,
  saveStateKey,
} from "@/lib/backendState";

/**
 * Backend persistence bridge — replaces the old localStorage persistence entirely.
 *
 * Direction 1 (boot):    `bootstrapFromBackend()` hydrates the store from SQLite.
 * Direction 2 (runtime): `startStatePersistence()` watches the store and writes every
 *                        change back to the database — debounced for settings-like
 *                        documents, throttled for conversation snapshots so streaming
 *                        (60 store updates/second) never floods the network. The raw
 *                        token stream is persisted server-side straight off the SSE
 *                        buffer, so snapshots only need to capture structure.
 */

/** Application-state documents synced key-by-key. */
const SYNC_KEYS = [
  "settings",
  "subAgents",
  "skills",
  "todos",
  "memory",
  "knowledge",
  "knowledgeSources",
  "customProviders",
  "agentTeams",
  "ceoAgents",
  "customAgents",
  "activeCustomAgentId",
  "mainAgentPrompts",
  "activeMainAgentPromptId",
  "taskModes",
  "activeTaskModeId",
  "planModePrompt",
  "agentMode",
  "promptLibrary",
  "connectors",
  "mcpServers",
  "userProfiles",
  "activeUserProfileId",
  "profileStates",
  "profileSessions",
] as const;

type SyncKey = (typeof SYNC_KEYS)[number];

const KEY_DEBOUNCE_MS = 600;
/** Snapshot sync cadence while a stream is running vs. idle. */
const SNAPSHOT_STREAMING_MS = 10_000;
const SNAPSHOT_IDLE_MS = 800;

let started = false;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hydrate the store from the backend database, retrying until the backend answers.
 * The app never runs its sync loop over in-memory defaults: doing so after a failed
 * boot fetch would let a later edit overwrite the real stored documents (API keys,
 * memory, skills…) with defaults.
 */
export async function bootstrapFromBackend() {
  for (;;) {
    try {
      const payload = await fetchBootState();
      useStore.getState().hydrateFromBackend(payload);
      return payload;
    } catch {
      await sleep(1500);
    }
  }
}

/** Load a conversation's snapshot from the database if only a stub is present. */
export async function loadConversationIfNeeded(id: string): Promise<Conversation | null> {
  const existing = useStore.getState().conversations.find((c) => c.id === id);
  if (!existing || existing.loaded !== false) return existing ?? null;

  let detail: Awaited<ReturnType<typeof fetchSessionDetail>>;
  try {
    detail = await fetchSessionDetail(id);
  } catch {
    // Transient failure — keep the stub un-loaded so (a) it is retried on the next
    // open and (b) the sync loop can never overwrite the stored snapshot with it.
    return existing;
  }
  if (detail === "missing") {
    // Definitively unknown to the database — a fresh, empty conversation.
    useStore.getState().replaceConversation({ ...existing, loaded: true });
    return existing;
  }

  const conv = snapshotToConversation(detail.snapshot, existing);

  // Recovery: no snapshot was ever stored (e.g. the browser closed before the first
  // sync) but the server-side transcript exists — rebuild plain messages from it.
  // Consecutive same-role transcript entries (one per agent iteration) are merged
  // into a single bubble so the rebuilt thread mirrors what the UI showed.
  if (conv.messages.length === 0 && (detail.transcript ?? []).length > 0) {
    for (const m of detail.transcript) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      const text = textContent(m.content);
      if (text.trim().length === 0) continue;
      const role = m.role === "user" ? "user" : "assistant";
      const last = conv.messages[conv.messages.length - 1];
      if (last && last.role === role && role === "assistant") {
        last.content += `\n\n${text}`;
      } else {
        conv.messages.push({
          id: `msg_db_${conv.messages.length}_${conv.id}`,
          role,
          content: text,
          createdAt: detail.session.updatedAt,
        });
      }
    }
  }

  useStore.getState().replaceConversation(conv);

  // Restore the meters from the persisted event log: every scope's latest usage for
  // this session (served on the detail payload). Only fills in when this client holds
  // nothing — live stream events arriving later always win, so a fresh turn can never
  // be clobbered by an older logged value. Validated through the same normalizers as
  // live events (wrong scopes and malformed payloads ignored).
  try {
    const store = useStore.getState();
    if (detail.contextUsages && typeof detail.contextUsages === "object") {
      const usages = detail.contextUsages as Record<string, unknown>;
      if (!store.contextUsage[id] && usages.main && typeof usages.main === "object") {
        const usage = normalizeContextUsageEvent(usages.main as SSEEventData, "main");
        if (usage) store.setContextUsage(id, { ...usage, updatedAt: Date.now() });
      }
      if (!store.customContextUsage[id] && usages.custom && typeof usages.custom === "object") {
        const usage = normalizeContextUsageEvent(usages.custom as SSEEventData, "custom");
        if (usage) store.setCustomContextUsage(id, { ...usage, updatedAt: Date.now() });
      }
      if (!store.chatContextUsage[id] && usages.chat && typeof usages.chat === "object") {
        const usage = normalizeContextUsageEvent(usages.chat as SSEEventData, "chat");
        if (usage) store.setChatContextUsage(id, { ...usage, updatedAt: Date.now() });
      }
      if (usages.sub_agents && typeof usages.sub_agents === "object") {
        const existingSub = store.subAgentUsage[id] ?? {};
        for (const raw of Object.values(usages.sub_agents as Record<string, unknown>)) {
          if (!raw || typeof raw !== "object") continue;
          const entry = normalizeSubAgentUsageEvent(raw as SSEEventData);
          if (entry && !existingSub[entry.subSessionId]) {
            store.setSubAgentUsage(id, { ...entry, updatedAt: Date.now() });
          }
        }
      }
      if (usages.team && typeof usages.team === "object") {
        const existingTeam = store.teamUsage[id] ?? {};
        for (const raw of Object.values(usages.team as Record<string, unknown>)) {
          if (!raw || typeof raw !== "object") continue;
          const entry = normalizeTeamUsageEvent(raw as SSEEventData, "team");
          if (entry && !existingTeam[entry.agentId]) {
            store.setTeamUsage(id, { ...entry, updatedAt: Date.now() });
          }
        }
      }
      if (usages.ceo && typeof usages.ceo === "object") {
        const existingCeo = store.ceoUsage[id] ?? {};
        for (const raw of Object.values(usages.ceo as Record<string, unknown>)) {
          if (!raw || typeof raw !== "object") continue;
          const entry = normalizeTeamUsageEvent(raw as SSEEventData, "ceo");
          if (entry && !existingCeo[entry.agentId]) {
            store.setCeoUsage(id, { ...entry, updatedAt: Date.now() });
          }
        }
      }
    } else if (!store.contextUsage[id] && detail.contextUsage && typeof detail.contextUsage === "object") {
      // Back-compat: old payloads carry only the main scope.
      const usage = normalizeContextUsageEvent(detail.contextUsage as SSEEventData, "main");
      if (usage) store.setContextUsage(id, { ...usage, updatedAt: Date.now() });
    }
  } catch {
    // Meter restore must never break conversation loading.
  }
  return conv;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? ((part as { text: string }).text)
          : "",
      )
      .join("");
  }
  return "";
}

/** Defensive parse of a stored snapshot into a Conversation. */
function snapshotToConversation(snapshot: unknown, stub: Conversation): Conversation {
  const s = (snapshot ?? {}) as Partial<Conversation>;
  const messages = Array.isArray(s.messages)
    ? s.messages.filter((m) => m && typeof m === "object" && typeof m.id === "string")
    : [];
  return {
    id: stub.id,
    title: typeof s.title === "string" && s.title.trim().length > 0 ? s.title : stub.title,
    messages: messages.map((m) => ({ ...m, streaming: false })),
    createdAt: typeof s.createdAt === "number" ? s.createdAt : stub.createdAt,
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : stub.updatedAt,
    profileId:
      typeof s.profileId === "string" && s.profileId.length > 0
        ? s.profileId
        : (stub.profileId ?? null),
    parentId:
      typeof s.parentId === "string" && s.parentId.length > 0 ? s.parentId : stub.parentId ?? null,
    loaded: true,
  };
}

/**
 * Start watching the store and syncing changes into the backend database.
 * Call once, after `bootstrapFromBackend()`.
 */
export function startStatePersistence(): void {
  if (started) return;
  started = true;

  const keyTimers = new Map<SyncKey, ReturnType<typeof setTimeout>>();
  const dirtyKeys = new Set<SyncKey>();

  const convTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const convLastSync = new Map<string, number>();
  const dirtyConvs = new Set<string>();
  // Baseline from the already-hydrated store so deletions are detected from the start.
  let knownConvs = new Map<string, Conversation>(
    useStore.getState().conversations.map((c) => [c.id, c]),
  );
  let currentIdTimer: ReturnType<typeof setTimeout> | null = null;
  let currentIdDirty = false;

  const scheduleKey = (key: SyncKey): void => {
    dirtyKeys.add(key);
    if (keyTimers.has(key)) return;
    keyTimers.set(
      key,
      setTimeout(() => {
        keyTimers.delete(key);
        dirtyKeys.delete(key);
        const state = useStore.getState() as unknown as Record<string, unknown>;
        void saveStateKey(key, state[key]);
      }, KEY_DEBOUNCE_MS),
    );
  };

  const syncConversation = (id: string): void => {
    dirtyConvs.delete(id);
    const conv = useStore.getState().conversations.find((c) => c.id === id);
    // Never sync stubs — that would overwrite the stored history with an empty doc.
    if (!conv || conv.loaded === false) return;
    convLastSync.set(id, Date.now());
    void saveSessionSnapshot(conv);
  };

  const scheduleConversation = (id: string): void => {
    dirtyConvs.add(id);
    if (convTimers.has(id)) return;
    const streaming = useStore.getState().streaming;
    const interval = streaming ? SNAPSHOT_STREAMING_MS : SNAPSHOT_IDLE_MS;
    const since = Date.now() - (convLastSync.get(id) ?? 0);
    const delay = Math.max(streaming ? interval - since : SNAPSHOT_IDLE_MS, SNAPSHOT_IDLE_MS);
    convTimers.set(
      id,
      setTimeout(() => {
        convTimers.delete(id);
        syncConversation(id);
      }, delay),
    );
  };

  useStore.subscribe((state, prev) => {
    if (!state.hydrated) return;

    // First hydrated tick: baseline the known conversations without issuing writes.
    if (!prev.hydrated) {
      knownConvs = new Map(state.conversations.map((c) => [c.id, c]));
      return;
    }

    for (const key of SYNC_KEYS) {
      if ((state as unknown as Record<string, unknown>)[key] !== (prev as unknown as Record<string, unknown>)[key]) {
        scheduleKey(key);
      }
    }

    if (state.currentId !== prev.currentId) {
      currentIdDirty = true;
      if (currentIdTimer) clearTimeout(currentIdTimer);
      currentIdTimer = setTimeout(() => {
        currentIdTimer = null;
        currentIdDirty = false;
        void saveStateKey("currentSessionId", useStore.getState().currentId);
      }, KEY_DEBOUNCE_MS);
    }

    if (state.conversations !== prev.conversations) {
      const next = new Map(state.conversations.map((c) => [c.id, c]));
      for (const [id, conv] of next) {
        const before = knownConvs.get(id);
        if (before !== conv) scheduleConversation(id);
      }
      for (const id of knownConvs.keys()) {
        if (!next.has(id)) {
          const timer = convTimers.get(id);
          if (timer) clearTimeout(timer);
          convTimers.delete(id);
          convLastSync.delete(id);
          dirtyConvs.delete(id);
          void deleteSessionData(id);
        }
      }
      knownConvs = next;
    }
  });

  // Durability on page close: beacon anything still pending straight into the database.
  const flushAll = (): void => {
    const state = useStore.getState();
    if (!state.hydrated) return;
    for (const key of dirtyKeys) {
      beaconStateKey(key, (state as unknown as Record<string, unknown>)[key]);
    }
    dirtyKeys.clear();
    if (currentIdDirty) {
      beaconStateKey("currentSessionId", state.currentId);
      currentIdDirty = false;
    }
    for (const id of dirtyConvs) {
      const conv = state.conversations.find((c) => c.id === id);
      if (conv && conv.loaded !== false) beaconSessionSnapshot(conv);
    }
    dirtyConvs.clear();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushAll();
    });
  }
}
