import type { SkillDefinition } from "../tools/types.js";

/**
 * Prompt creation agent ("promptagent").
 *
 * A focused, autonomous prompt-writing assistant. The user describes a task
 * (create mode) or pastes an existing prompt (enhance mode) and the agent
 * drafts a high-quality, reusable prompt in Markdown. Every Markdown file the
 * agent writes with `file_write` (or edits with `str_replace` / `apply_patch`)
 * is mirrored onto the turn's event stream as `prompt_canvas_updated`, so the
 * frontend canvas can render it live.
 *
 * The agent runs with the SAME LLM settings the user is currently using in the
 * app (provider / model / apiKey / baseUrl / temperature / effort travel with
 * each turn request, exactly like the main agent and chat mode).
 */

/** What the prompt agent should do this turn. */
export type PromptAgentMode = "create" | "enhance";

/**
 * The exact tool surface available to the prompt agent. Everything else in the
 * registry is hidden (never advertised, never executable).
 */
export const PROMPT_AGENT_TOOLS: readonly string[] = [
  "file_write",
  "file_read",
  "file_list",
  "str_replace",
  "apply_patch",
  "list_skills",
  "skill_initialize",
  "attach_files",
  "save_prompt_in_prompt_library",
  "delete_prompt_from_prompt_library",
  "list_available_prompts_in_prompt_library",
];

const PROMPT_AGENT_TOOL_SET = new Set<string>(PROMPT_AGENT_TOOLS);

/** True when a tool name is part of the prompt-agent surface. */
export function isPromptAgentTool(name: string): boolean {
  return PROMPT_AGENT_TOOL_SET.has((name ?? "").trim());
}

export interface RunPromptAgentRequest {
  chatId: string;
  userMessage: string;
  /** 1. create new prompt 2. enhance existing prompt. Defaults to "create". */
  mode: PromptAgentMode;
  /**
   * The existing prompt text to enhance. Only used in enhance mode (also
   * accepted when the frontend sends it along with the message).
   */
  existingPrompt?: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** Full user-defined provider config, present when a `custom_` provider is selected. */
  customProvider?: unknown;
  temperature?: number;
  /**
   * Reasoning effort chosen in Settings: a preset (`low` | `medium` | `high` | `max`)
   * or a custom string. Forwarded to the provider; ignored by models without reasoning.
   */
  effort?: string;
  /** Per-request web tool keys/provider (from frontend Settings); falls back to env config. */
  tavilyApiKey?: string;
  exaApiKey?: string;
  serpapiApiKey?: string;
  searchProvider?: "duckduckgo" | "tavily" | "exa" | "serpapi";
  fetchProvider?: "builtin" | "firecrawl";
  firecrawlApiKey?: string;
  /** User-defined skills available this turn (defaults resolved underneath). */
  skills?: SkillDefinition[];
}
