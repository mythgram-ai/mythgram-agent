import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { resilientFetch } from "@/lib/net";

/**
 * Raw-context viewer support — all agent scopes.
 *
 * The backend's `GET /api/sessions/:id/context` returns the exact provider-format
 * inputs an agent's next request is built from: the resolved system prompt
 * plus the untruncated transcript (user / assistant / tool messages, including
 * tool calls/results). This module is the single integration point for that
 * endpoint; channel/schedule chats use their own endpoints below.
 */

/** Agent scopes the raw-context endpoint serves. */
export const SUPPORTED_RAW_CONTEXT_AGENTS = ["main", "custom", "chat", "sub_agent", "team", "ceo"] as const;
export type SupportedRawContextAgent = (typeof SUPPORTED_RAW_CONTEXT_AGENTS)[number];

/** Agent id accepted by the raw-context helpers. Kept as `string` so future agents plug in. */
export type RawContextAgent = string;

/** The Main Agent scope tag used by default. */
export const MAIN_RAW_CONTEXT_AGENT = "main" as const;

/** Where the returned transcript came from. */
export type RawContextSource = "live" | "persisted" | "empty";

/** One provider-format message, passed through untouched (raw). */
export interface RawContextMessage {
  role: string;
  content?: unknown;
  [key: string]: unknown;
}

/** Normalized raw context for one session + agent. */
export interface MainRawContext {
  agent: RawContextAgent;
  sessionId: string;
  systemPrompt: string | null;
  systemPromptSource: "custom" | "builtin";
  messages: RawContextMessage[];
  source: RawContextSource;
  messageCount: number;
  /** Latest main-agent `context_usage` log entry, when the session has one. */
  usage?: Record<string, unknown> | null;
  fetchedAt: number;
}

/**
 * True when `agent` is a supported raw-context scope. Case-insensitive, trims input.
 * Today only `"main"` passes — other agents are valid future scopes, rejected here
 * (and by the backend) so they can never be shown as Main Agent context.
 */
export function isSupportedRawContextAgent(agent: unknown): agent is SupportedRawContextAgent {
  if (typeof agent !== "string") return false;
  return (SUPPORTED_RAW_CONTEXT_AGENTS as readonly string[]).includes(agent.trim().toLowerCase());
}

/** Human label for an agent scope in the raw-context UI. Extensible per agent. */
export function rawContextAgentLabel(agent: RawContextAgent): string {
  const scope = typeof agent === "string" ? agent.trim().toLowerCase() : "";
  if (scope === MAIN_RAW_CONTEXT_AGENT) return "Main agent";
  if (scope === "custom") return "Custom agent";
  if (scope === "chat") return "Chat";
  if (scope === "sub_agent") return "Sub agent";
  if (scope === "team") return "Team agent";
  if (scope === "ceo") return "CEO agent";
  if (scope === "channel") return "Channel chat";
  if (scope === "schedule") return "Schedule";
  const trimmed = typeof agent === "string" ? agent.trim() : "";
  return trimmed.length > 0 ? trimmed : "Agent";
}

function asMessages(raw: unknown): RawContextMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: RawContextMessage[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && typeof (item as { role?: unknown }).role === "string") {
      out.push(item as RawContextMessage);
    }
  }
  return out;
}

/**
 * Fetch one session's raw context for `agent` (default `"main"`).
 *
 * Extra identity for per-agent scopes:
 * - sub_agent: `options.subSessionId` (10-char runned session id)
 * - team: `options.teamAgent` (leader/member name)
 * - ceo: `options.ceoAgent` (CEO/leader/member name)
 * - custom: `options.customAgentId` (stored custom agent id, optional)
 *
 * - Resolves 404 (unknown session / never-runned agent) to an empty context so fresh
 *   local-only threads render "No context yet" instead of an error. Transient failures
 *   (network, backend restarting, 5xx) THROW — callers must not mistake them for empty.
 * - Never throws on malformed payloads: unknown shapes normalize to an empty context.
 */
export async function fetchMainRawContext(
  sessionId: string,
  options?: {
    agent?: RawContextAgent;
    signal?: AbortSignal;
    subSessionId?: string;
    teamAgent?: string;
    ceoAgent?: string;
    customAgentId?: string;
  },
): Promise<MainRawContext> {
  const id = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!id) throw new Error("A session id is required.");
  const agent = (options?.agent ?? MAIN_RAW_CONTEXT_AGENT).trim() || MAIN_RAW_CONTEXT_AGENT;
  if (!isSupportedRawContextAgent(agent)) {
    throw new Error(`Unsupported agent scope "${agent}".`);
  }
  const scope = agent.toLowerCase();

  const query: Record<string, string | number | undefined> = { agent: scope };
  if (scope === "sub_agent" && options?.subSessionId?.trim()) {
    query.sub_session_id = options.subSessionId.trim();
  }
  if (scope === "team" && options?.teamAgent?.trim()) {
    query.team_agent = options.teamAgent.trim();
  }
  if (scope === "ceo" && options?.ceoAgent?.trim()) {
    query.ceo_agent = options.ceoAgent.trim();
  }
  if (scope === "custom" && options?.customAgentId?.trim()) {
    query.custom_agent_id = options.customAgentId.trim();
  }

  const url = routeUrl(API_ROUTES.sessionContext, {
    params: { id },
    query,
  });
  const res = await resilientFetch(url, { cache: "no-store" }, { signal: options?.signal });
  if (res.status === 404) {
    return {
      agent: agent.toLowerCase(),
      sessionId: id,
      systemPrompt: null,
      systemPromptSource: "builtin",
      messages: [],
      source: "empty",
      messageCount: 0,
      usage: null,
      fetchedAt: Date.now(),
    };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  const record = (data ?? {}) as Record<string, unknown>;
  const messages = asMessages(record.messages);
  const source: RawContextSource =
    record.source === "live" || record.source === "persisted" || record.source === "empty"
      ? record.source
      : messages.length > 0
        ? "persisted"
        : "empty";
  const systemPrompt = typeof record.systemPrompt === "string" ? record.systemPrompt : null;
  return {
    agent: typeof record.agent === "string" ? record.agent : agent.toLowerCase(),
    sessionId: typeof record.sessionId === "string" ? record.sessionId : id,
    systemPrompt,
    systemPromptSource: record.systemPromptSource === "custom" ? "custom" : "builtin",
    messages,
    source,
    messageCount:
      typeof record.messageCount === "number" && Number.isFinite(record.messageCount)
        ? Math.max(0, Math.floor(record.messageCount))
        : messages.length,
    usage:
      record.usage && typeof record.usage === "object"
        ? (record.usage as Record<string, unknown>)
        : null,
    fetchedAt:
      typeof record.fetchedAt === "number" && Number.isFinite(record.fetchedAt)
        ? record.fetchedAt
        : Date.now(),
  };
}

/** Normalized raw context for a channel chat (transcript + system prompt + meter usage). */
export interface ChannelRawContext {
  chatId: string;
  channelId: string;
  agentName: string;
  systemPrompt: string | null;
  systemPromptSource: "custom" | "builtin";
  messages: RawContextMessage[];
  source: RawContextSource;
  messageCount: number;
  usage?: Record<string, unknown> | null;
  fetchedAt: number;
}

/**
 * Fetch one channel chat's raw context (transcript + system prompt + latest usage).
 * Resolves 404 to an empty context; transient failures throw. Never throws on
 * malformed payloads.
 */
export async function fetchChannelRawContext(
  channelId: string,
  chatId: string,
  options?: { signal?: AbortSignal },
): Promise<ChannelRawContext> {
  const cid = channelId.trim();
  const id = chatId.trim();
  if (!cid || !id) throw new Error("A channel id and chat id are required.");
  const url = routeUrl(API_ROUTES.channelsChatContext, { params: { id: cid, chatId: id } });
  const res = await resilientFetch(url, { cache: "no-store" }, { signal: options?.signal });
  if (res.status === 404) {
    return {
      chatId: id,
      channelId: cid,
      agentName: "Default Agent",
      systemPrompt: null,
      systemPromptSource: "builtin",
      messages: [],
      source: "empty",
      messageCount: 0,
      usage: null,
      fetchedAt: Date.now(),
    };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  const record = (data ?? {}) as Record<string, unknown>;
  const messages = asMessages(record.messages);
  return {
    chatId: typeof record.chat_id === "string" ? record.chat_id : id,
    channelId: typeof record.channel_id === "string" ? record.channel_id : cid,
    agentName: typeof record.agent_name === "string" ? record.agent_name : "Default Agent",
    systemPrompt: typeof record.systemPrompt === "string" ? record.systemPrompt : null,
    systemPromptSource: record.systemPromptSource === "custom" ? "custom" : "builtin",
    messages,
    source:
      record.source === "live" || record.source === "persisted" || record.source === "empty"
        ? record.source
        : messages.length > 0
          ? "persisted"
          : "empty",
    messageCount:
      typeof record.messageCount === "number" && Number.isFinite(record.messageCount)
        ? Math.max(0, Math.floor(record.messageCount))
        : messages.length,
    usage: record.usage && typeof record.usage === "object" ? (record.usage as Record<string, unknown>) : null,
    fetchedAt:
      typeof record.fetchedAt === "number" && Number.isFinite(record.fetchedAt) ? record.fetchedAt : Date.now(),
  };
}

/** Normalized raw context for a schedule (task prompt + system prompt + meter usage). */
export interface ScheduleRawContext {
  scheduleId: string;
  scheduleName: string;
  systemPrompt: string | null;
  systemPromptSource: "custom" | "builtin";
  messages: RawContextMessage[];
  source: RawContextSource;
  messageCount: number;
  usage?: Record<string, unknown> | null;
  fetchedAt: number;
}

/**
 * Fetch one schedule's raw context (task prompt + system prompt + latest usage).
 * Resolves 404 to an empty context; transient failures throw.
 */
export async function fetchScheduleRawContext(
  scheduleId: string,
  options?: { signal?: AbortSignal },
): Promise<ScheduleRawContext> {
  const id = scheduleId.trim();
  if (!id) throw new Error("A schedule id is required.");
  const url = routeUrl(API_ROUTES.schedulesContext, { params: { id } });
  const res = await resilientFetch(url, { cache: "no-store" }, { signal: options?.signal });
  if (res.status === 404) {
    return {
      scheduleId: id,
      scheduleName: "",
      systemPrompt: null,
      systemPromptSource: "builtin",
      messages: [],
      source: "empty",
      messageCount: 0,
      usage: null,
      fetchedAt: Date.now(),
    };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  const record = (data ?? {}) as Record<string, unknown>;
  const messages = asMessages(record.messages);
  return {
    scheduleId: typeof record.schedule_id === "string" ? record.schedule_id : id,
    scheduleName: typeof record.schedule_name === "string" ? record.schedule_name : "",
    systemPrompt: typeof record.systemPrompt === "string" ? record.systemPrompt : null,
    systemPromptSource: record.systemPromptSource === "custom" ? "custom" : "builtin",
    messages,
    source:
      record.source === "live" || record.source === "persisted" || record.source === "empty"
        ? record.source
        : messages.length > 0
          ? "persisted"
          : "empty",
    messageCount:
      typeof record.messageCount === "number" && Number.isFinite(record.messageCount)
        ? Math.max(0, Math.floor(record.messageCount))
        : messages.length,
    usage: record.usage && typeof record.usage === "object" ? (record.usage as Record<string, unknown>) : null,
    fetchedAt:
      typeof record.fetchedAt === "number" && Number.isFinite(record.fetchedAt) ? record.fetchedAt : Date.now(),
  };
}

/**
 * Serialize a raw context to its display form: pretty-printed JSON of the exact
 * payload (system prompt + messages + metadata), unformatted otherwise — no
 * markdown, no trimming, no redaction — so the original content is preserved
 * as accurately as possible. Never throws.
 */
export function formatRawContextPayload(ctx: MainRawContext): string {
  try {
    return JSON.stringify(
      {
        agent: ctx.agent,
        sessionId: ctx.sessionId,
        source: ctx.source,
        systemPromptSource: ctx.systemPromptSource,
        systemPrompt: ctx.systemPrompt,
        messageCount: ctx.messageCount,
        messages: ctx.messages,
        usage: ctx.usage ?? null,
        fetchedAt: ctx.fetchedAt,
      },
      null,
      2,
    );
  } catch {
    return "{}";
  }
}

/** Approximate display size of the raw payload (chars), for the modal stats row. */
export function rawContextCharCount(ctx: MainRawContext): number {
  try {
    return formatRawContextPayload(ctx).length;
  } catch {
    return 0;
  }
}
