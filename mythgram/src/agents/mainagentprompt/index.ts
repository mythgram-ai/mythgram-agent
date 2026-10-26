/**
 * Custom System Prompts for the built-in Main Agent.
 *
 * This module lets the user save multiple named system prompts for the EXISTING Main Agent and pick
 * one as active. It does NOT create a new Main Agent, sub-agent, or multi-agent system — the active
 * prompt is simply used verbatim as the built-in Main Agent's system prompt for future runs. When no
 * prompt is active, the Main Agent keeps using its built-in system prompt unchanged.
 *
 *   configuration — the persistent MainAgentPromptConfig shape + defensive normalization
 *   manager       — persistent CRUD + active-selection over the existing SQLite app_state repository
 */
export {
  normalizeMainAgentPromptConfig,
  type MainAgentPromptConfig,
  type MainAgentPromptWire,
} from "./configuration.js";
export {
  MainAgentPromptManager,
  type CreateMainAgentPromptInput,
  type UpdateMainAgentPromptInput,
} from "./manager.js";
