import type { MainContextUsage, SSEEventData } from "@/types";
import { findActiveCustomAgent } from "@/lib/customAgents";
import { activeCeo } from "@/lib/defaultCeo";
import { activeTeam } from "@/lib/defaultTeams";
import { MAIN_AGENT_ID } from "@/lib/customAgents";

/** Scope tag carried by `context_usage` log events (see backend agents/agent.ts). */
export const MAIN_AGENT_SCOPE = "main" as const;
/** All meter scopes the popup understands (main/custom/chat + per-agent scopes). */
export const CONTEXT_SCOPES = ["main", "custom", "chat", "sub_agent", "team", "ceo"] as const;
export type ContextScope = (typeof CONTEXT_SCOPES)[number];

/**
 * Minimal store shape needed to decide whether the built-in Main Agent is the agent
 * serving chat turns. Mirrors the turn-routing logic in `hooks/useChatStream.ts`
 * (`buildStartRequest`): chat mode, Custom Agents, CEO mode, and team mode each route
 * away from the Main Agent. Kept as a structural subset so additional agents can be
 * added later without rewriting callers.
 */
interface MainAgentState {
  agentMode: string;
  activeCustomAgentId: string | null;
  customAgents: Array<{ id: string }>;
  settings: { enableCeoAgents?: string; enableAgentTeams?: string };
  ceoAgents: Array<{ id: string; enabled?: boolean; name?: string }>;
  agentTeams: Array<{ id: string; enabled?: boolean }>;
}

/**
 * True when a chat turn would run as the built-in Main Agent: agent mode is on, no
 * Custom Agent is selected, and neither CEO nor team mode would take over. Uses the
 * same resolvers as turn construction (`findActiveCustomAgent` / `activeCeo` /
 * `activeTeam`) rather than brittle UI checks, so the button and the backend's
 * `agent: "main"` log tag agree on what "main" means.
 */
export function isMainAgentActive(s: MainAgentState): boolean {
  if (s.agentMode === "chat") return false;
  if (s.activeCustomAgentId && s.activeCustomAgentId !== MAIN_AGENT_ID) {
    if (findActiveCustomAgent(s.customAgents as never, s.activeCustomAgentId)) return false;
    // Unknown/stale custom-agent id: fall through to the remaining checks so a dangling
    // selection still hides the meter only when another agent actually takes over.
  }
  if (s.settings.enableCeoAgents === "yes" && activeCeo(s.ceoAgents as never)) return false;
  if (s.settings.enableAgentTeams === "yes" && activeTeam(s.agentTeams as never)) return false;
  return true;
}

/** True for a finite, non-negative token count (zero is legitimate; NaN/negative is not). */
function cleanCount(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/**
 * Validate + normalize a raw `context_usage` log-event payload into store-ready usage.
 * Returns null for anything that must not be displayed: wrong scope (unknown agents),
 * missing prompt count with no fallback, or malformed counts. Never throws.
 * Separation point between token-data extraction and popup presentation.
 *
 * Back-compat: with no `scope` argument this only accepts the main scope (existing
 * callers unchanged). Pass a scope to accept exactly that scope instead.
 */
export function normalizeContextUsageEvent(data: SSEEventData, scope: string = MAIN_AGENT_SCOPE): Omit<MainContextUsage, "updatedAt"> | null {
  try {
    const eventScope = typeof data.agent === "string" ? data.agent.trim().toLowerCase() : "";
    // Only the requested scope feeds its meter section. Other scopes are valid log
    // data for their own sections — ignored here, never shown as this scope's usage.
    if (eventScope !== scope.trim().toLowerCase()) return null;
    const promptTokens = cleanCount(data.prompt_tokens);
    // Without a prompt count there is no current-context size to show. Completion-only
    // payloads are not a substitute (they measure output, not context).
    if (promptTokens === undefined) return null;
    const out: Omit<MainContextUsage, "updatedAt"> = { promptTokens };
    const completionTokens = cleanCount(data.completion_tokens);
    if (completionTokens !== undefined) out.completionTokens = completionTokens;
    const totalTokens = cleanCount(data.total_tokens);
    if (totalTokens !== undefined) out.totalTokens = totalTokens;
    if (typeof data.provider === "string" && data.provider.trim().length > 0) {
      out.provider = data.provider.trim().slice(0, 120);
    }
    if (typeof data.model === "string" && data.model.trim().length > 0) {
      out.model = data.model.trim().slice(0, 200);
    }
    const iteration = cleanCount(data.iteration);
    if (iteration !== undefined) out.iteration = iteration;
    return out;
  } catch {
    return null;
  }
}

/**
 * Normalize a sub-agent `context_usage` event into a meter entry with its runned
 * session identity (`sub_session_id` + display name). Null when the payload is not
 * a usable sub-agent usage (wrong scope, missing ids/counts). Never throws.
 */
export function normalizeSubAgentUsageEvent(
  data: SSEEventData,
): (Omit<MainContextUsage, "updatedAt"> & { subSessionId: string; subAgentName?: string }) | null {
  try {
    const base = normalizeContextUsageEvent(data, "sub_agent");
    if (!base) return null;
    const subSessionId = typeof data.sub_session_id === "string" ? data.sub_session_id.trim() : "";
    if (!subSessionId) return null;
    const out = base as Omit<MainContextUsage, "updatedAt"> & { subSessionId: string; subAgentName?: string };
    out.subSessionId = subSessionId;
    if (typeof data.sub_agent === "string" && data.sub_agent.trim().length > 0) {
      out.subAgentName = data.sub_agent.trim().slice(0, 120);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Normalize a team/CEO `context_usage` event into a meter entry with its agent
 * identity (`agent_id` + role). `scope` must be "team" or "ceo". Null when unusable.
 * Never throws.
 */
export function normalizeTeamUsageEvent(
  data: SSEEventData,
  scope: "team" | "ceo",
): (Omit<MainContextUsage, "updatedAt"> & { agentId: string; role?: string }) | null {
  try {
    const base = normalizeContextUsageEvent(data, scope);
    if (!base) return null;
    const agentId = typeof data.agent_id === "string" ? data.agent_id.trim() : "";
    if (!agentId) return null;
    const out = base as Omit<MainContextUsage, "updatedAt"> & { agentId: string; role?: string };
    out.agentId = agentId;
    if (typeof data.role === "string" && data.role.trim().length > 0) {
      out.role = data.role.trim().slice(0, 40);
    }
    return out;
  } catch {
    return null;
  }
}

/** Format a token count with thousands separators, e.g. 12345 → "12,345". */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  try {
    return Math.floor(n).toLocaleString("en-US");
  } catch {
    return String(Math.floor(n));
  }
}

/** Compact token count for tight UI, e.g. 12345 → "12.3K", 2000000 → "2M". */
export function formatTokenCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const v = Math.floor(n);
  if (v < 1000) return String(v);
  if (v < 1_000_000) {
    const k = v / 1000;
    return `${k >= 100 ? Math.round(k).toString() : k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  const m = v / 1_000_000;
  return `${m >= 100 ? Math.round(m).toString() : m.toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * Utilization percentage of `used` relative to the model's context-window `limit`.
 * Returns null when the limit is missing/invalid (callers show the count without a
 * percentage rather than inventing one). Clamped to 0–100 and rounded to 1 decimal.
 */
export function contextPercent(used: number, limit: number | null | undefined): number | null {
  if (!Number.isFinite(used) || used < 0) return null;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return null;
  const pct = (used / limit) * 100;
  return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
}

// ---------------------------------------------------------------------------
// Manual context limits (fallback when a provider publishes no metadata).
// ---------------------------------------------------------------------------

/** Where an effective context limit came from: the provider catalog or manual entry. */
export type ContextLimitSource = "provider" | "manual";

/** Bounds for a manually entered context limit, in tokens. */
export const MANUAL_LIMIT_MIN = 1_000;
export const MANUAL_LIMIT_MAX = 1_000_000_000;
/** Cap on stored manual entries so one document cannot grow without bound. */
export const MANUAL_LIMIT_MAX_ENTRIES = 200;

/** Storage key for one provider+model pair's manual limit. Model ids are case-sensitive. */
export function manualLimitKey(provider: string, model: string): string {
  return `${provider.trim()}::${model.trim()}`;
}

/** Look up a stored manual limit for a provider+model pair. Null when absent/invalid. */
export function getManualContextLimit(
  limits: Record<string, number> | undefined | null,
  provider: string,
  model: string,
): number | null {
  try {
    if (!limits || typeof limits !== "object") return null;
    const raw = (limits as Record<string, unknown>)[manualLimitKey(provider, model)];
    return typeof raw === "number" && Number.isInteger(raw) && raw >= MANUAL_LIMIT_MIN && raw <= MANUAL_LIMIT_MAX
      ? raw
      : null;
  } catch {
    return null;
  }
}

/**
 * Parse user-typed manual limit input: plain digits with optional commas/spaces and
 * an optional `k`/`M` suffix (e.g. `128000`, `128,000`, `128k`, `1.5M`).
 * Returns the token count, or an error message for invalid input. Never throws.
 */
export function parseManualContextLimit(input: unknown): { ok: true; value: number } | { ok: false; error: string } {
  try {
    const cleaned = typeof input === "string" ? input : typeof input === "number" ? String(input) : "";
    const compact = cleaned.replace(/[,\s_]+/g, "").trim();
    if (!compact) return { ok: false, error: "Enter a limit first." };
    const match = /^(\d+(?:\.\d+)?)([kKmM])?$/.exec(compact);
    if (!match) return { ok: false, error: "Use digits, e.g. 128000 or 128k." };
    const multiplier = !match[2] ? 1 : match[2].toLowerCase() === "k" ? 1_000 : 1_000_000;
    const value = Math.floor(Number(match[1]) * multiplier);
    if (!Number.isFinite(value)) return { ok: false, error: "Use digits, e.g. 128000 or 128k." };
    if (value < MANUAL_LIMIT_MIN) {
      return { ok: false, error: `At least ${MANUAL_LIMIT_MIN.toLocaleString("en-US")} tokens.` };
    }
    if (value > MANUAL_LIMIT_MAX) {
      return { ok: false, error: `At most ${MANUAL_LIMIT_MAX.toLocaleString("en-US")} tokens.` };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: "Use digits, e.g. 128000 or 128k." };
  }
}

/**
 * Sanitize a persisted manual-limits document: keep only well-formed provider+model
 * keys with in-range integer values (capped entry count). Never throws.
 */
export function sanitizeManualContextLimits(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (Object.keys(out).length >= MANUAL_LIMIT_MAX_ENTRIES) break;
      if (typeof key !== "string" || key.trim().length === 0 || key.length > 400) continue;
      if (typeof value !== "number" || !Number.isInteger(value)) continue;
      if (value < MANUAL_LIMIT_MIN || value > MANUAL_LIMIT_MAX) continue;
      out[key] = value;
    }
  } catch {
    // fall through with whatever survived
  }
  return out;
}

export interface CatalogModel {
  provider: string;
  id: string;
  context_window?: number | null;
}

/** The provider catalog's published limit for a provider+model pair, if any. */
export function catalogContextLimit(
  models: Array<CatalogModel>,
  provider: string,
  model: string,
): number | null {
  const id = model.trim();
  if (!id) return null;
  const match =
    models.find((m) => m.provider === provider && m.id === id) ??
    models.find((m) => m.id === id);
  const limit = match?.context_window;
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
}

/**
 * Effective context limit for a provider+model pair: the provider catalog wins when
 * it publishes metadata, otherwise a stored manual entry fills the gap. Null when
 * neither knows the limit. Never throws.
 */
export function resolveContextLimit(
  models: Array<CatalogModel>,
  provider: string,
  model: string,
  manualLimits: Record<string, number> | undefined | null,
): { limit: number | null; source: ContextLimitSource | null } {
  try {
    const catalog = catalogContextLimit(models, provider, model);
    if (catalog !== null) return { limit: catalog, source: "provider" };
    if (!model.trim()) return { limit: null, source: null };
    const manual = getManualContextLimit(manualLimits, provider, model);
    if (manual !== null) return { limit: manual, source: "manual" };
    return { limit: null, source: null };
  } catch {
    return { limit: null, source: null };
  }
}

/**
 * True when the Main Agent interface must force manual entry: a model is selected,
 * the catalog is settled (not loading), and neither the catalog nor a manual entry
 * provides a limit. While true the context popup stays open and non-dismissable
 * and new chat turns are blocked until a limit is saved.
 */
export function isContextLimitRequired(args: {
  models: Array<CatalogModel>;
  modelsLoading: boolean;
  provider: string;
  model: string;
  manualLimits: Record<string, number> | undefined | null;
}): boolean {
  try {
    if (args.modelsLoading) return false;
    if (typeof args.model !== "string" || args.model.trim().length === 0) return false;
    return resolveContextLimit(args.models, args.provider, args.model, args.manualLimits).limit === null;
  } catch {
    return false;
  }
}
