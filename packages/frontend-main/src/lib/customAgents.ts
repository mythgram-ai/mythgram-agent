import { API_ROUTES, routeUrl } from "@/app/api/routes";
import { requestJson } from "@/lib/api";
import type { BackendCustomAgent, CustomAgent } from "@/types";

/**
 * Custom Agents — top-level, user-created Main Agents.
 *
 * A Custom Agent is NOT a sub-agent, child agent, or team member. It is an independently-configured
 * Main Agent: the app has the built-in Main Agent plus any number of Custom Agents, all at the same
 * top level. Selecting a Custom Agent makes chat turns run as that agent (its own system prompt +
 * selected tools) through the same core runtime as the Main Agent.
 *
 * Configs persist in the backend SQLite database via the shared app-state sync (`customAgents`),
 * exactly like agent teams. This module owns the defensive normalization and the
 * wire conversion.
 */

/** Sentinel id for the built-in Main Agent (never a Custom Agent id). */
export const MAIN_AGENT_ID = "main";

/** Defensive normalize of one stored/loaded Custom Agent into a well-formed value. */
export function normalizeCustomAgent(raw: unknown): CustomAgent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!id || !name) return null;
  const selectedTools = Array.isArray(r.selectedTools)
    ? r.selectedTools.filter((t): t is string => typeof t === "string")
    : Array.isArray((r as { selected_tools?: unknown }).selected_tools)
      ? ((r as { selected_tools: unknown[] }).selected_tools.filter(
          (t): t is string => typeof t === "string",
        ))
      : [];
  return {
    id,
    name,
    description: typeof r.description === "string" ? r.description : "",
    systemPrompt:
      typeof r.systemPrompt === "string"
        ? r.systemPrompt
        : typeof (r as { system_prompt?: unknown }).system_prompt === "string"
          ? ((r as { system_prompt: string }).system_prompt)
          : "",
    selectedTools,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

/** Normalize a persisted array of Custom Agents, dropping malformed entries and duplicate ids. */
export function normalizeCustomAgents(raw: unknown): CustomAgent[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomAgent[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const agent = normalizeCustomAgent(item);
    if (!agent || seen.has(agent.id)) continue;
    seen.add(agent.id);
    out.push(agent);
  }
  return out;
}

/** The active Custom Agent (by id) from a list, or null when the id is null / not found. */
export function findActiveCustomAgent(
  agents: CustomAgent[],
  activeId: string | null,
): CustomAgent | null {
  if (!activeId || activeId === MAIN_AGENT_ID) return null;
  return agents.find((a) => a.id === activeId) ?? null;
}

/**
 * Fetch the persisted Custom Agents from the backend (the SQLite source of truth).
 * Used to refresh the Custom Agents panel on open so an agent created by any agent
 * (create_agent tool) appears instantly instead of on next boot. Throws on failure
 * so callers can keep the previous list and surface an error.
 */
export async function fetchCustomAgents(signal?: AbortSignal): Promise<CustomAgent[]> {
  const data = await requestJson<{ agents?: unknown }>(
    routeUrl(API_ROUTES.customAgentsList),
    undefined,
    signal,
  );
  return normalizeCustomAgents(data.agents ?? []);
}

/** Convert a Custom Agent into the backend/wire format sent with a turn. */
export function toBackendCustomAgent(agent: CustomAgent): BackendCustomAgent {
  return {
    id: agent.id,
    name: agent.name.trim(),
    description: agent.description.trim(),
    system_prompt: agent.systemPrompt,
    selected_tools: agent.selectedTools,
  };
}
