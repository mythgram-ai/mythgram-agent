import type { AgentTeam, BackendCeo, CeoAgent } from "@/types";

/**
 * CEO agents — top-level multi-team coordinators.
 *
 * A CEO agent controls the head/leaders of the agent teams the user selects. When a CEO is active,
 * the first user prompt goes to the CEO, which assigns tasks to the teams' leaders; the leaders then
 * coordinate their own members and report completion back to the CEO. Only one CEO is active at a
 * time (mirroring agent teams). Configs persist in the backend SQLite database via the shared
 * app-state sync (`ceoAgents`). This module owns the defensive normalization + wire conversion.
 */

/** Defensive normalize of one stored/loaded CEO agent into a well-formed value. */
export function normalizeCeoAgent(raw: unknown): CeoAgent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!id || !name) return null;
  const teamIds = Array.isArray(r.teamIds)
    ? r.teamIds.filter((t): t is string => typeof t === "string")
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
    teamIds,
    enabled: r.enabled === true,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

/** Normalize a persisted array of CEO agents, dropping malformed entries and duplicate ids, and
 * ensuring at most one is enabled (the first enabled one wins). */
export function normalizeCeoAgents(raw: unknown): CeoAgent[] {
  if (!Array.isArray(raw)) return [];
  const out: CeoAgent[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const ceo = normalizeCeoAgent(item);
    if (!ceo || seen.has(ceo.id)) continue;
    seen.add(ceo.id);
    out.push(ceo);
  }
  return enforceSingleActiveCeo(out);
}

/** Ensure at most one CEO is enabled; the first enabled CEO wins, the rest are disabled. */
export function enforceSingleActiveCeo(ceos: CeoAgent[]): CeoAgent[] {
  let activeSeen = false;
  return ceos.map((c) => {
    if (c.enabled && !activeSeen) {
      activeSeen = true;
      return c;
    }
    return c.enabled ? { ...c, enabled: false } : c;
  });
}

/** The active (enabled) CEO, or null. */
export function activeCeo(ceos: CeoAgent[]): CeoAgent | null {
  return ceos.find((c) => c.enabled) ?? null;
}

/** A blank CEO scaffold for the create form. */
export function blankCeo(): CeoAgent {
  const now = Date.now();
  return {
    id: `ceo-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    description: "",
    systemPrompt: "",
    teamIds: [],
    enabled: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Convert a CEO agent into the backend/wire format sent with a turn. The selected team ids are
 * resolved against the user's current teams into full team definitions (only valid, selected teams
 * are included). Returns null when the CEO has no name or resolves to no valid teams — in which case
 * the caller should NOT run in CEO mode.
 */
export function toBackendCeo(ceo: CeoAgent, teams: AgentTeam[]): BackendCeo | null {
  const name = ceo.name.trim();
  if (!name) return null;

  const byId = new Map(teams.map((t) => [t.id, t]));
  const selected: BackendCeo["teams"] = [];
  const seen = new Set<string>();
  for (const teamId of ceo.teamIds) {
    if (seen.has(teamId)) continue;
    seen.add(teamId);
    const team = byId.get(teamId);
    if (!team || !team.leaderName.trim()) continue;
    selected.push({
      id: team.id,
      name: team.name,
      leader_name: team.leaderName.trim(),
      leader_system_prompt: team.leaderSystemPrompt,
      members: team.members
        .filter((m) => m.name.trim().length > 0)
        .map((m) => ({
          name: m.name.trim(),
          description: m.description,
          system_prompt: m.systemPrompt,
        })),
    });
  }
  if (selected.length === 0) return null;

  return {
    id: ceo.id,
    name,
    description: ceo.description.trim(),
    system_prompt: ceo.systemPrompt,
    teams: selected,
  };
}
