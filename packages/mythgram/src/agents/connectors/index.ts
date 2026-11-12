/**
 * Connectors runtime infrastructure.
 *
 * Third-party app integrations (GitHub, Slack, ...) powered by Composio. Once a
 * connector is authenticated, every tool of its toolkit becomes a native function
 * tool for ALL agent surfaces (main, custom, sub-agents, teams, CEO).
 *
 *   configuration — connection shapes + defensive normalization (no static catalog)
 *   client        — minimal Composio v3.1 REST client (live toolkits, auth, tools, execute)
 *   manager       — persistent connection store over the SQLite app_state repo
 *   runtime       — per-turn bridge: catalog cache + native schemas + execution
 */
export {
  COMPOSIO_API_BASE,
  COMPOSIO_DEFAULT_USER_ID,
  isConnectorToolName,
  isToolkitSlug,
  normalizeConnectorConnection,
  normalizeConnectorWire,
  type ConnectorConnection,
  type ConnectorConnectionWire,
  type ConnectorId,
  type ConnectorStatus,
  type ConnectorWire,
} from "./configuration.js";
export {
  ComposioClient,
  ComposioError,
  type ComposioAuthConfig,
  type ComposioConnectedAccount,
  type ComposioExecuteResult,
  type ComposioFetch,
  type ComposioLinkResult,
  type ComposioToolDefinition,
  type ComposioToolkitInfo,
  type ComposioToolkitSummary,
} from "./client.js";
export { ConnectorManager } from "./manager.js";
export {
  CONNECTOR_CATALOG_TTL_MS,
  ConnectorRuntime,
  ConnectorToolCache,
  sharedConnectorToolCache,
  toOpenAIParameters,
  type ConnectorRuntimeOptions,
  type ConnectorToolSchema,
} from "./runtime.js";
