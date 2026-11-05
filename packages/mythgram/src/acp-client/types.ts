/**
 * Agent Client Protocol (ACP) — client-side shared types.
 *
 * This module implements the CLIENT side of ACP: it spawns and drives external
 * ACP-compatible agents (Claude Agent, Codex, Gemini CLI, OpenCode, Goose, ...)
 * over newline-delimited JSON-RPC 2.0 on stdio. It is the inverse of
 * `src/acp/`, which lets external clients drive Mythgram.
 *
 * Protocol reference: https://agentclientprotocol.com/protocol/v1/overview
 *
 * The types below intentionally model the stable ACP v1 surface, including all
 * optional client capabilities we implement (filesystem, terminals, permission
 * requests, elicitation, session modes and config options).
 */

/** The ACP major protocol version this client implements. */
export const ACP_PROTOCOL_VERSION = 1;

/** How the app appears to connected agents during `initialize`. */
export const ACP_CLIENT_INFO = {
  name: "mythgram",
  title: "Mythgram ACP Client",
  version: "1.0.0",
} as const;

/** Exact shape of the 20-digit numeric ids this app mints for ACP connections/sessions. */
export const ACP_NUMERIC_ID_PATTERN = /^[0-9]{20}$/;

export type JsonRpcId = number | string | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

export interface AcpTextContent {
  type: "text";
  text: string;
  annotations?: unknown;
}

export interface AcpImageContent {
  type: "image";
  data: string;
  mimeType: string;
  uri?: string;
  annotations?: unknown;
}

export interface AcpAudioContent {
  type: "audio";
  data: string;
  mimeType: string;
  annotations?: unknown;
}

export interface AcpResourceLinkContent {
  type: "resource_link";
  uri: string;
  name: string;
  mimeType?: string;
  title?: string;
  description?: string;
  size?: number;
  annotations?: unknown;
}

export interface AcpEmbeddedResourceContent {
  type: "resource";
  resource:
    | { uri: string; text: string; mimeType?: string; annotations?: unknown }
    | { uri: string; blob: string; mimeType?: string; annotations?: unknown };
  annotations?: unknown;
}

export type AcpContentBlock =
  | AcpTextContent
  | AcpImageContent
  | AcpAudioContent
  | AcpResourceLinkContent
  | AcpEmbeddedResourceContent;

/* ------------------------------------------------------------------ */
/* Tool calls / plan / modes / session config                          */
/* ------------------------------------------------------------------ */

export type AcpToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other"
  | string;

export type AcpToolCallStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | string;

export interface AcpToolCallLocation {
  path: string;
  line?: number | null;
}

export type AcpToolCallContent =
  | { type: "content"; content: AcpContentBlock }
  | { type: "diff"; path: string; oldText?: string | null; newText: string }
  | { type: "terminal"; terminalId: string }
  | { type: string; [key: string]: unknown };

export interface AcpToolCall {
  toolCallId: string;
  title?: string;
  name?: string | null;
  kind?: AcpToolKind;
  status?: AcpToolCallStatus;
  content?: AcpToolCallContent[];
  locations?: AcpToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface AcpPlanEntry {
  content: string;
  priority?: "high" | "medium" | "low" | string;
  status?: "pending" | "in_progress" | "completed" | string;
  _meta?: Record<string, unknown>;
}

export interface AcpSessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface AcpSessionModeState {
  currentModeId: string;
  availableModes: AcpSessionMode[];
}

export interface AcpConfigSelectOption {
  value: string;
  name: string;
  description?: string;
}

export interface AcpConfigSelectGroup {
  group: string;
  name: string;
  options: AcpConfigSelectOption[];
}

export interface AcpSessionConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: "select" | "boolean" | string;
  currentValue: string | boolean;
  options?: Array<AcpConfigSelectOption | AcpConfigSelectGroup>;
}

export interface AcpUsageCost {
  amount: number;
  currency: string;
}

export interface AcpUsage {
  used: number;
  size: number;
  cost?: AcpUsageCost;
}

export interface AcpAvailableCommand {
  name: string;
  description?: string;
  input?: { hint?: string } | null;
}

export interface AcpNotice {
  severity?: "info" | "warning" | "error" | string;
  title?: string;
  description?: string | null;
}

/** A `session/update` payload (`params.update`). */
export interface AcpSessionUpdate {
  sessionUpdate: string;
  content?: AcpContentBlock;
  toolCallId?: string;
  title?: string;
  name?: string | null;
  kind?: AcpToolKind;
  status?: AcpToolCallStatus;
  contentBlocks?: AcpToolCallContent[];
  locations?: AcpToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  entries?: AcpPlanEntry[];
  availableCommands?: AcpAvailableCommand[];
  currentModeId?: string;
  modes?: AcpSessionModeState;
  configOptions?: AcpSessionConfigOption[];
  used?: number;
  size?: number;
  cost?: AcpUsageCost;
  severity?: string;
  description?: string | null;
  messageId?: string;
  title_update?: string;
  titleUpdate?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Permissions / elicitation                                            */
/* ------------------------------------------------------------------ */

export type AcpPermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always"
  | string;

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: AcpPermissionOptionKind;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: AcpToolCall;
  options: AcpPermissionOption[];
}

export type AcpPermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export interface AcpPermissionResponse {
  outcome: AcpPermissionOutcome;
}

export type AcpElicitationMode = "form" | "url" | string;

export interface AcpElicitationRequest {
  sessionId?: string;
  requestId?: string | number;
  toolCallId?: string | null;
  mode: AcpElicitationMode;
  message: string;
  requestedSchema?: Record<string, unknown>;
  elicitationId?: string;
  url?: string;
  [key: string]: unknown;
}

export type AcpElicitationResponse =
  | { action: "accept"; content?: Record<string, unknown> | null }
  | { action: "decline" }
  | { action: "cancel" };

/* ------------------------------------------------------------------ */
/* Initialization / sessions                                            */
/* ------------------------------------------------------------------ */

export interface AcpImplementation {
  name: string;
  title?: string | null;
  version: string;
}

export interface AcpAuthMethod {
  id: string;
  name: string;
  description?: string;
  type?: "agent" | "terminal" | string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AcpAgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
  mcpCapabilities?: { http?: boolean; sse?: boolean };
  auth?: { logout?: unknown };
  sessionCapabilities?: {
    resume?: unknown;
    close?: unknown;
    list?: unknown;
    delete?: unknown;
    additionalDirectories?: unknown;
  };
  [key: string]: unknown;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  agentCapabilities?: AcpAgentCapabilities;
  agentInfo?: AcpImplementation | null;
  authMethods?: AcpAuthMethod[];
}

export interface AcpNewSessionResult {
  sessionId: string;
  modes?: AcpSessionModeState | null;
  configOptions?: AcpSessionConfigOption[] | null;
}

export interface AcpPromptResult {
  stopReason: string;
}

/* ------------------------------------------------------------------ */
/* Persisted / public app models                                        */
/* ------------------------------------------------------------------ */

export interface AcpClientInput {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  enabled: boolean;
}

export interface AcpClientConfig extends AcpClientInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export type AcpClientStatus = "disconnected" | "connecting" | "connected" | "error";

/** Public connection projection sent to the browser (never includes secrets/agent session ids). */
export interface AcpClientPublic extends AcpClientConfig {
  status: AcpClientStatus;
  error: string | null;
  agent: AcpImplementation | null;
  protocolVersion: number | null;
  authMethods: AcpAuthMethod[];
  capabilities: AcpAgentCapabilities | null;
  sessions: number;
  stderr: string[];
}

export interface AcpSessionMeta {
  modes?: AcpSessionModeState | null;
  configOptions?: AcpSessionConfigOption[] | null;
  usage?: AcpUsage | null;
  commands?: AcpAvailableCommand[];
  agent?: AcpImplementation | null;
  protocolVersion?: number;
  [key: string]: unknown;
}

export interface AcpSessionPublic {
  id: string;
  clientId: string;
  title: string;
  status: string;
  running: boolean;
  meta: AcpSessionMeta;
  createdAt: number;
  updatedAt: number;
}

export interface AcpStoredSessionEvent {
  seq: number;
  event: string;
  data: unknown;
  createdAt: number;
}

export interface AcpSessionDetail extends AcpSessionPublic {
  events: AcpStoredSessionEvent[];
}

/** Result of validating a not-yet-saved connection. */
export interface AcpValidateResult {
  ok: boolean;
  agent: AcpImplementation | null;
  protocolVersion: number;
  authMethods: AcpAuthMethod[];
  capabilities: AcpAgentCapabilities | null;
}

/** Event streamed to the panel over SSE. */
export type AcpClientEvent =
  | { event: "ready"; data: { sessionId: string; title?: string } }
  | { event: "update"; data: { sessionId: string; update: AcpSessionUpdate } }
  | {
      event: "permission_request";
      data: {
        sessionId: string;
        requestId: string;
        toolCall: AcpToolCall;
        options: AcpPermissionOption[];
      };
    }
  | { event: "permission_resolved"; data: { sessionId: string; requestId: string } }
  | {
      event: "elicitation_request";
      data: { sessionId: string; requestId: string; request: AcpElicitationRequest };
    }
  | { event: "elicitation_resolved"; data: { sessionId: string; requestId: string } }
  | { event: "notice"; data: { sessionId: string; title: string; description?: string; severity?: string } }
  | { event: "status"; data: { sessionId: string; status: string } }
  | { event: "error"; data: { sessionId: string; message: string } }
  | { event: "done"; data: { sessionId: string; stopReason: string } };

/** JSON-RPC/ACP error codes used by this client. */
export const ACP_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  requestCancelled: -32800,
  authRequired: -32000,
  resourceNotFound: -32002,
} as const;