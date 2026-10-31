import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";
import { resilientFetch } from "@/lib/net";
import type { Conversation } from "@/types";

/**
 * Client for the backend's SQLite-backed state APIs. The browser keeps NOTHING in
 * localStorage (or any other browser storage): on boot the app hydrates from
 * `GET /api/state`, and every change is written back to the database through
 * these calls. Chat/session data lives only in runtime memory plus SQLite.
 */

/** One session row from the database's session list. */
export interface BackendSessionMeta {
  id: string;
  title: string;
  running: boolean;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** Payload of GET /api/state — everything needed to boot in one round trip. */
export interface BackendBootPayload {
  sqlite_version?: string;
  state: Record<string, unknown>;
  sessions: BackendSessionMeta[];
}

/** Payload of GET /api/sessions/:id. */
export interface BackendSessionDetail {
  session: { id: string; title: string; running: boolean; createdAt: number; updatedAt: number };
  snapshot: unknown;
  transcript: Array<{ role: string; content?: unknown }>;
  /**
   * Latest main-agent context usage from the persisted stream-event log (null when the
   * session never logged main-agent usage). Served with the `agent: "main"` scope tag so
   * the client's `normalizeContextUsageEvent` validates it exactly like a live event.
   */
  contextUsage?: unknown;
  /**
   * All scopes' latest usages (main/custom/chat + per sub-agent/team/CEO agent) for the
   * context popup. Only runned agents appear. Additive — old payloads omit it.
   */
  contextUsages?: {
    main?: unknown;
    custom?: unknown;
    chat?: unknown;
    sub_agents?: Record<string, unknown>;
    team?: Record<string, unknown>;
    ceo?: Record<string, unknown>;
  };
}

/** Load the entire application state from the backend database (boot hydration). */
export async function fetchBootState(): Promise<BackendBootPayload> {
  const data = await requestJson<Partial<BackendBootPayload>>(routeUrl(API_ROUTES.stateGet));
  return {
    sqlite_version: data.sqlite_version,
    state: data.state && typeof data.state === "object" ? data.state : {},
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
  };
}

/** Persist one application-state document (settings, skills, memory, …). Best-effort. */
export async function saveStateKey(key: string, value: unknown): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.stateSet, { params: { key } }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  }).catch(() => {});
}

/**
 * Load one session's snapshot + transcript.
 * Returns "missing" ONLY for a definitive 404 (the database has no such session).
 * Transient failures (network, backend restarting, 5xx) THROW — callers must not
 * mistake them for "session unknown" or they could overwrite stored history.
 */
export async function fetchSessionDetail(id: string): Promise<BackendSessionDetail | "missing"> {
  const res = await resilientFetch(routeUrl(API_ROUTES.sessionGet, { params: { id } }), {
    cache: "no-store",
  });
  if (res.status === 404) return "missing";
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as BackendSessionDetail;
}

/** Upsert a session's title and UI snapshot into the database. Best-effort. */
export async function saveSessionSnapshot(conversation: Conversation): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.sessionSave, { params: { id: conversation.id } }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: conversation.title, snapshot: conversation }),
  }).catch(() => {});
}

/** Delete a session and all of its stored data. Best-effort. */
export async function deleteSessionData(id: string): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.sessionDelete, { params: { id } }), {
    method: "DELETE",
  }).catch(() => {});
}

/**
 * Fork a session on the backend into a full copy (transcript, events, tool
 * calls, UI snapshot) under `newId`. Returns the forked id, or null when the
 * source has no server row yet (a fresh local-only chat — the caller should
 * still fork locally and let the snapshot sync create the server row).
 */
export async function forkSessionData(
  sourceId: string,
  newId: string,
  title: string,
): Promise<string | null> {
  try {
    const data = await requestJson<{ ok?: boolean; id?: string }>(
      routeUrl(API_ROUTES.sessionFork, { params: { id: sourceId } }),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, new_id: newId }),
      },
    );
    return typeof data.id === "string" && data.id.length > 0 ? data.id : null;
  } catch {
    return null;
  }
}

/** Rename a session title on the backend (title-only, never touches the snapshot). */
export async function renameSessionData(id: string, title: string): Promise<void> {
  await requestJson(routeUrl(API_ROUTES.sessionSave, { params: { id } }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }).catch(() => {});
}

/**
 * Fire a persistence write during page unload. `navigator.sendBeacon` survives the
 * page teardown; falls back to a keepalive fetch where beacons are unavailable.
 */
export function beaconJson(url: string, body: unknown): void {
  try {
    const payload = JSON.stringify(body);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // best effort — the debounced sync will catch up on next boot
  }
}

/** Beacon a session snapshot on page hide. */
export function beaconSessionSnapshot(conversation: Conversation): void {
  beaconJson(routeUrl(API_ROUTES.sessionSave, { params: { id: conversation.id } }), {
    title: conversation.title,
    snapshot: conversation,
  });
}

/** Beacon an application-state document on page hide. */
export function beaconStateKey(key: string, value: unknown): void {
  beaconJson(routeUrl(API_ROUTES.stateSet, { params: { key } }), { value });
}
