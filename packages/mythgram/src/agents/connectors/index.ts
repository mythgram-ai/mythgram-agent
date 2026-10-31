/**
 * Connectors runtime infrastructure.
 *
 * Third-party app integrations (GitHub, Slack, ...) powered by Composio. Once a
 * connector is authenticated, every tool of its toolkit becomes a native function
 * tool for ALL agent surfaces (main, custom, sub-agents, teams, CEO).
 *
 *   configuration — static catalog + connection shapes + defensive normalization
 *   client        — minimal Composio v3.1 REST client (auth, tools, execute)
 *   manager       — persistent connection store over the SQLite app_state repo
 *   runtime       — per-turn bridge: catalog cache + native schemas + execution
 */
export {
  AVAILABLE_CONNECTORS,
  COMPOSIO_API_BASE,
  COMPOSIO_DEFAULT_USER_ID,
  CONNECTOR_IDS,
  getConnector,
  getConnectorByToolkit,
  isConnectorToolName,
  normalizeConnectorConnection,
  normalizeConnectorWire,
  type ConnectorConnection,
  type ConnectorConnectionWire,
  type ConnectorDefinition,
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
