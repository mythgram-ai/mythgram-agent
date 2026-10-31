/**
 * Custom Agent runtime infrastructure.
 *
 * A Custom Agent is a user-created, independently-configured TOP-LEVEL Main Agent (not a sub-agent,
 * child agent, or team member). This module keeps the Custom Agent runtime logic isolated and
 * organized while reusing the shared core agent runtime for execution:
 *
 *   configuration — the persistent CustomAgentConfig shape + defensive normalization
 *   loader        — resolves selected tools against the live registry + resolves the system prompt
 *   manager       — persistent CRUD over the existing SQLite app_state repository
 *   runtime       — the CustomAgentRunner, which parameterizes the shared core runtime per agent
 */
export {
  CUSTOM_AGENT_EXCLUDED_TOOLS,
  isCustomAgentExcludedTool,
  normalizeCustomAgentConfig,
  sanitizeSelectedTools,
  type CustomAgentConfig,
  type CustomAgentWire,
} from "./configuration.js";
export {
  listCustomAgentTools,
  resolveCustomAgentTools,
  resolveCustomAgentSystemPrompt,
  type CustomAgentToolInfo,
  type ResolvedCustomAgentTools,
} from "./loader.js";
export {
  CustomAgentManager,
  type CreateCustomAgentInput,
  type UpdateCustomAgentInput,
} from "./manager.js";
export { CustomAgentRunner, type CoreAgentRuntime } from "./runtime.js";
