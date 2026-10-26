/**
 * MCP (Model Context Protocol) runtime infrastructure.
 *
 * Once an MCP server is connected, every tool it exposes becomes a native
 * function tool for ALL agent surfaces (main, custom, sub-agents, teams, CEO).
 *
 *   configuration — server shapes (remote/local, auth) + defensive normalization
 *   oauth         — RFC9728 discovery + OAuth 2.1 w/ PKCE + token refresh
 *   streamableHttp— Streamable HTTP JSON-RPC transport (SSE/JSON, sessions)
 *   stdio         — stdio transport (managed child process, multiplexed calls)
 *   client        — high-level MCP client (initialize → tools/list → tools/call)
 *   manager       — persistent CRUD over SQLite app_state + connection pool
 *   runtime       — per-turn bridge: catalog cache + native schemas + execution
 */
export {
  normalizeMcpSelection,
  normalizeMcpServerConfig,
  parseLocalServerJson,
  toPublicServer,
  type McpAuthType,
  type McpLocalConfig,
  type McpOAuthConfig,
  type McpServerConfig,
  type McpServerKind,
  type McpServerPublic,
  type McpServerSelection,
  type McpServerStatus,
  type McpServerWire,
} from "./configuration.js";
export {
  assertPkceS256Supported,
  buildAuthorizeUrl,
  canonicalResourceUri,
  discoverOAuth,
  exchangeCode,
  fetchAuthorizationServerMetadata,
  parseWwwAuthenticateChallenge,
  pkceChallenge,
  protectedResourceMetadataUrls,
  randomOAuthString,
  refreshAccessToken,
  registerClient,
  resourceMetadataFromWwwAuthenticate,
  type AuthorizationServerMetadata,
  type AuthorizeStart,
  type McpOAuthDiscovery,
  type OAuthClientCredentials,
  type ProtectedResourceMetadata,
  type TokenSet,
} from "./oauth.js";
export {
  MCP_PROTOCOL_VERSION,
  McpHttpError,
  StreamableHttpTransport,
  isSessionExpiredError,
  type JsonRpcResponse,
} from "./streamableHttp.js";
export { McpStdioTransport } from "./stdio.js";
export {
  McpClient,
  type McpCallResult,
  type McpClientOptions,
  type McpToolDescription,
} from "./client.js";
export { McpManager } from "./manager.js";
export {
  MCP_CATALOG_TTL_MS,
  MCP_TOOL_PREFIX,
  McpRuntime,
  McpToolCache,
  isMcpToolName,
  mcpServerSlug,
  sharedMcpToolCache,
  type McpRuntimeOptions,
  type McpToolSchema,
} from "./runtime.js";
