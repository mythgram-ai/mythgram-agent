import { ALL_MULTI_AGENT_TOOL_NAMES } from "../tools/teamTools.js";

/**
 * A Custom Agent is a user-created, independently-configured TOP-LEVEL Main Agent — NOT a sub-agent,
 * child agent, delegated helper, or team member. It is executed through the SAME core runtime as the
 * built-in Main Agent (see ../agent.ts); the only differences are configuration-level: its name,
 * description, system prompt, and the subset of tools it is allowed to use.
 *
 * This file owns the persistent CONFIGURATION shape and its defensive normalization. The config only
 * stores tool identifiers (never executable tool implementations); the loader resolves them against
 * the live registry at run time so a Custom Agent always benefits from the latest tool definitions.
 */
export interface CustomAgentConfig {
  /** Stable unique id (16-character alphanumeric). */
  id: string;
  /** Human-readable agent name (required). */
  name: string;
  /** Short description of what the agent does. */
  description: string;
  /**
   * The full, user-editable system prompt. It is pre-filled from the Main Agent's system prompt when
   * the creation UI opens, then freely edited by the user. Used verbatim as the agent's system prompt.
   */
  systemPrompt: string;
  /**
   * Tool identifiers the agent is allowed to use (resolved against the live registry at run time).
   * Multi-agent/team tools are never permitted and are stripped during normalization.
   */
  selectedTools: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * The over-the-wire (snake_case) shape a Custom Agent config takes when sent from the frontend on a
 * chat turn, mirroring how sub-agents / teams travel. Every field is untrusted.
 */
export interface CustomAgentWire {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  system_prompt?: unknown;
  systemPrompt?: unknown;
  selected_tools?: unknown;
  selectedTools?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
}

/**
 * Tools a Custom Agent may NEVER use. Because every Custom Agent is a top-level Main Agent (not a
 * team member), the five multi-agent collaboration tools make no sense for it and are always stripped
 * — matching the Main Agent, which also hides these. Everything else the Main Agent can use (files,
 * shell, web, memory, knowledge, skills, sub-agents, todos, plan/ask, ...) is selectable.
 */
export const CUSTOM_AGENT_EXCLUDED_TOOLS: readonly string[] = [...ALL_MULTI_AGENT_TOOL_NAMES];

const EXCLUDED = new Set<string>(CUSTOM_AGENT_EXCLUDED_TOOLS);

/** True when a tool name may not be granted to a Custom Agent. */
export function isCustomAgentExcludedTool(name: string): boolean {
  return EXCLUDED.has(name);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Coerce an untrusted list of tool identifiers into a clean, de-duplicated, order-preserving array of
 * strings with the excluded (multi-agent) tools removed. Non-string / empty entries are dropped.
 */
export function sanitizeSelectedTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || seen.has(name) || isCustomAgentExcludedTool(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Defensively normalize an untrusted Custom Agent payload (wire or stored) into a well-formed
 * CustomAgentConfig, or `null` when it is unusable (no name). Accepts both snake_case (wire) and
 * camelCase (stored) field spellings. `id`/timestamps fall back to the supplied defaults so this can
 * be reused for both create (mint an id/now) and load (keep existing) flows.
 */
export function normalizeCustomAgentConfig(
  raw: unknown,
  defaults: { id: string; now: number },
): CustomAgentConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as CustomAgentWire;

  const name = str(r.name).trim();
  if (!name) return null;

  const systemPrompt = str(r.system_prompt) || str(r.systemPrompt);
  const selectedTools = sanitizeSelectedTools(
    r.selected_tools !== undefined ? r.selected_tools : r.selectedTools,
  );

  const id = str(r.id).trim() || defaults.id;
  const createdAt = num(r.created_at ?? r.createdAt, defaults.now);
  const updatedAt = num(r.updated_at ?? r.updatedAt, defaults.now);

  return {
    id,
    name,
    description: str(r.description).trim(),
    systemPrompt,
    selectedTools,
    createdAt,
    updatedAt,
  };
}
