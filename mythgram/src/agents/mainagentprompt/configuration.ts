/**
 * Custom System Prompts for the built-in Main Agent.
 *
 * A "main agent prompt" is a named, user-authored system prompt for the EXISTING built-in Main Agent.
 * It does NOT create a new agent, sub-agent, or multi-agent system — it only changes the instructions
 * the Main Agent runs with. The user can save many prompts and mark exactly one as active; the active
 * prompt is used verbatim as the Main Agent's system prompt for all future runs. When none is active,
 * the Main Agent falls back to its built-in system prompt (see agents/systemprompt.ts).
 *
 * This file owns the persistent CONFIGURATION shape and its defensive normalization.
 */
export interface MainAgentPromptConfig {
  /** Stable unique id (exact 20 digits, `^[0-9]{20}$`). */
  id: string;
  /** Human-readable prompt name (required). */
  name: string;
  /** Optional short description of what this prompt changes. */
  description: string;
  /** The full system-prompt text used verbatim as the Main Agent's system prompt. */
  content: string;
  createdAt: number;
  updatedAt: number;
}

/** The untrusted over-the-wire / stored shape. Accepts snake_case and camelCase spellings. */
export interface MainAgentPromptWire {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  content?: unknown;
  system_prompt?: unknown;
  systemPrompt?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Defensively normalize an untrusted prompt payload (wire or stored) into a well-formed config, or
 * `null` when it is unusable (no name). `id`/timestamps fall back to the supplied defaults so this can
 * be reused for both create (mint an id/now) and load (keep existing) flows.
 */
export function normalizeMainAgentPromptConfig(
  raw: unknown,
  defaults: { id: string; now: number },
): MainAgentPromptConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as MainAgentPromptWire;

  const name = str(r.name).trim();
  if (!name) return null;

  const content = str(r.content) || str(r.system_prompt) || str(r.systemPrompt);
  const id = str(r.id).trim() || defaults.id;
  const createdAt = num(r.created_at ?? r.createdAt, defaults.now);
  const updatedAt = num(r.updated_at ?? r.updatedAt, defaults.now);

  return {
    id,
    name,
    description: str(r.description).trim(),
    content,
    createdAt,
    updatedAt,
  };
}
