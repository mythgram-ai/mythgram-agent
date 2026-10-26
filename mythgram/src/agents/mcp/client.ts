import type { McpServerConfig } from "./configuration.js";
import { canonicalResourceUri } from "./oauth.js";
import {
  MCP_PROTOCOL_VERSION,
  StreamableHttpTransport,
  isSessionExpiredError,
  type JsonRpcResponse,
} from "./streamableHttp.js";
import { McpStdioTransport } from "./stdio.js";

/**
 * High-level MCP client: one object per server that owns the connection
 * lifecycle (initialize handshake → tools/list → tools/call → close) over
 * either transport. Mirrors the official SDK `Client` semantics without adding
 * a dependency:
 *
 *   const client = McpClient.forServer(config, opts);
 *   await client.connect();          // initialize + notifications/initialized
 *   const tools = await client.listTools();
 *   const result = await client.callTool(name, args);
 *   await client.close();
 *
 * Tool-call failures surface as `{ isError, text }` (never throw for
 * `isError` results, per the spec's CallToolResult guidance) — transport and
 * protocol failures throw so the caller can mark the server down.
 */

export interface McpToolDescription {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (normalized to an object schema). */
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  isError: boolean;
  /** Human/model-readable rendering of every content block. */
  text: string;
  /** Structured payload when the tool returned `structuredContent`. */
  structured?: unknown;
}

export interface McpClientOptions {
  workspaceRoot: string;
  /** Headers for remote servers (auth + custom). Refreshed per call via `headerProvider`. */
  headers?: Record<string, string>;
  /**
   * Called before every authenticated request; when it returns headers they
   * replace `headers`. Used to inject a fresh OAuth bearer token (refreshing it
   * when expired) without rebuilding the client.
   */
  headerProvider?: () => Promise<Record<string, string>>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface McpErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

function toJsonRpcError(response: JsonRpcResponse): McpErrorShape | null {
  if (response.error && typeof response.error === "object") {
    return {
      code: typeof response.error.code === "number" ? response.error.code : -32000,
      message: typeof response.error.message === "string" ? response.error.message : "Unknown MCP error",
      data: response.error.data,
    };
  }
  return null;
}

export class McpClient {
  private http: StreamableHttpTransport | null = null;
  private stdio: McpStdioTransport | null = null;
  private negotiatedVersion = MCP_PROTOCOL_VERSION;
  private connected = false;

  private constructor(
    private readonly config: McpServerConfig,
    private readonly options: McpClientOptions,
  ) {}

  static forServer(config: McpServerConfig, options: McpClientOptions): McpClient {
    return new McpClient(config, options);
  }

  get kind(): "remote" | "local" {
    return this.config.kind;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private async headers(): Promise<Record<string, string>> {
    if (this.options.headerProvider) {
      try {
        return await this.options.headerProvider();
      } catch {
        // fall through to the static headers
      }
    }
    return this.options.headers ?? {};
  }

  /** Run the MCP initialize handshake (with one session-expiry retry for HTTP). */
  async connect(): Promise<{ serverInfo?: { name: string; version?: string }; protocolVersion: string }> {
    if (this.config.kind === "local") {
      if (!this.config.local) throw new Error("The local MCP server has no launch configuration.");
      this.stdio = new McpStdioTransport(this.config.local, this.options.workspaceRoot);
      const result = (await this.stdio.request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mythgram", version: "1.0.0" },
      }, { signal: this.options.signal, timeoutMs: this.options.timeoutMs })) as Record<string, unknown>;
      this.negotiatedVersion = typeof result?.protocolVersion === "string" ? (result.protocolVersion as string) : MCP_PROTOCOL_VERSION;
      await this.stdio.notify("notifications/initialized");
      this.connected = true;
      const serverInfo = result?.serverInfo as { name?: string; version?: string } | undefined;
      return {
        serverInfo: serverInfo?.name ? { name: serverInfo.name, version: serverInfo.version } : undefined,
        protocolVersion: this.negotiatedVersion,
      };
    }

    this.http = new StreamableHttpTransport({ url: this.config.url, headers: await this.headers(), signal: this.options.signal });
    try {
      return await this.initializeHttp(false);
    } catch (error) {
      if (isSessionExpiredError(error)) {
        // The session died mid-handshake — start clean and try once more.
        this.http = new StreamableHttpTransport({ url: this.config.url, headers: await this.headers(), signal: this.options.signal });
        return await this.initializeHttp(false);
      }
      throw error;
    }
  }

  private async initializeHttp(retried: boolean): Promise<{ serverInfo?: { name: string; version?: string }; protocolVersion: string }> {
    const http = this.http;
    if (!http) throw new Error("The MCP HTTP transport is not ready.");
    const response = await http.post({
      jsonrpc: "2.0",
      id: `mcp-init-${Date.now()}`,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mythgram", version: "1.0.0" },
      },
    });
    if (!response) throw new Error("The MCP server did not answer the initialize request.");
    const rpcError = toJsonRpcError(response);
    if (rpcError) {
      if (!retried && isSessionExpiredError(rpcError)) {
        return this.initializeHttp(true);
      }
      throw new Error(`MCP initialize failed: ${rpcError.message}`);
    }
    const result = (response.result ?? {}) as Record<string, unknown>;
    const negotiated = typeof result.protocolVersion === "string" ? result.protocolVersion : MCP_PROTOCOL_VERSION;
    this.negotiatedVersion = negotiated;
    http.setProtocolVersion(negotiated);
    // notifications/initialized → 202, never throws the handshake.
    try {
      await http.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    } catch {
      // best effort
    }
    this.connected = true;
    const serverInfo = result.serverInfo as { name?: string; version?: string } | undefined;
    return {
      serverInfo: serverInfo?.name ? { name: serverInfo.name, version: serverInfo.version } : undefined,
      protocolVersion: negotiated,
    };
  }

  /** List every tool the server exposes (follows cursor pagination to the end). */
  async listTools(): Promise<McpToolDescription[]> {
    const out: McpToolDescription[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page += 1) {
      const result = (await this.send("tools/list", cursor ? { cursor } : undefined)) as {
        tools?: Array<{ name?: unknown; description?: unknown; inputSchema?: unknown }>;
        nextCursor?: unknown;
      };
      const tools = Array.isArray(result?.tools) ? result.tools : [];
      for (const tool of tools) {
        const name = typeof tool?.name === "string" ? tool.name.trim() : "";
        if (!name) continue;
        out.push({
          name,
          description: typeof tool?.description === "string" ? tool.description : "",
          inputSchema: normalizeInputSchema(tool?.inputSchema),
        });
      }
      const next = typeof result?.nextCursor === "string" ? result.nextCursor : "";
      if (!next) break;
      cursor = next;
    }
    return out;
  }

  /**
   * Call one tool. Transport/protocol failures throw; a tool-level failure
   * resolves `{ isError: true }` so the agent can read the message and adapt.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const result = (await this.send("tools/call", { name, arguments: args ?? {} })) as {
      content?: unknown;
      structuredContent?: unknown;
      isError?: unknown;
      _meta?: unknown;
    };
    const isError = result?.isError === true;
    return {
      isError,
      text: renderContent(result?.content),
      structured: result?.structuredContent,
    };
  }

  /** Canonical resource URI for OAuth audience binding (remote only). */
  resourceUri(): string {
    return canonicalResourceUri(this.config.url);
  }

  private async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.stdio) {
      return this.stdio.request(method, params, { signal: this.options.signal, timeoutMs: this.options.timeoutMs });
    }
    const http = this.http;
    if (!http) throw new Error("The MCP client is not connected.");
    try {
      const response = await http.post({
        jsonrpc: "2.0",
        id: `mcp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        method,
        ...(params !== undefined ? { params } : {}),
      }, { timeoutMs: this.options.timeoutMs });
      if (!response) throw new Error(`The MCP server did not answer "${method}".`);
      const rpcError = toJsonRpcError(response);
      if (rpcError) throw new Error(`MCP error ${rpcError.code}: ${rpcError.message}`);
      return response.result;
    } catch (error) {
      if (isSessionExpiredError(error)) {
        // Re-initialize once, then replay the original request on the new session.
        await this.connect();
        const retry = this.http;
        if (!retry) throw error;
        const response = await retry.post({
          jsonrpc: "2.0",
          id: `mcp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          method,
          ...(params !== undefined ? { params } : {}),
        }, { timeoutMs: this.options.timeoutMs });
        if (!response) throw new Error(`The MCP server did not answer "${method}".`);
        const rpcError = toJsonRpcError(response);
        if (rpcError) throw new Error(`MCP error ${rpcError.code}: ${rpcError.message}`);
        return response.result;
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.connected = false;
    await this.http?.close().catch(() => undefined);
    this.http = null;
    await this.stdio?.close().catch(() => undefined);
    this.stdio = null;
  }
}

/** Coerce an MCP tool inputSchema into a usable object schema for providers. */
function normalizeInputSchema(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { type: "object", properties: {} };
  }
  const r = raw as Record<string, unknown>;
  const properties =
    r.properties && typeof r.properties === "object" && !Array.isArray(r.properties)
      ? (r.properties as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = { type: "object", properties };
  if (Array.isArray(r.required)) {
    const required = (r.required as unknown[]).filter((v): v is string => typeof v === "string");
    if (required.length > 0) out.required = required;
  }
  if (typeof r.description === "string" && r.description.trim()) out.description = r.description;
  return out;
}

/**
 * Render MCP content blocks into model-readable text. Covers text, image
 * (referenced, not inlined — the bytes would bloat the transcript), audio,
 * resource links / embedded resources. Unknown blocks degrade to JSON.
 */
function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    if (content === undefined || content === null) return "";
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    } else if (b.type === "image") {
      const mime = typeof b.mimeType === "string" ? b.mimeType : "image";
      parts.push(`[image (${mime}) — binary content omitted]`);
    } else if (b.type === "audio") {
      const mime = typeof b.mimeType === "string" ? b.mimeType : "audio";
      parts.push(`[audio (${mime}) — binary content omitted]`);
    } else if (b.type === "resource_link" && typeof (b as { uri?: unknown }).uri === "string") {
      const link = b as { uri: string; name?: unknown; title?: unknown };
      parts.push(`[resource: ${String(link.title ?? link.name ?? link.uri)} (${link.uri})]`);
    } else if (b.type === "resource" && b.resource && typeof b.resource === "object") {
      const res = b.resource as Record<string, unknown>;
      const text = typeof res.text === "string" ? res.text : undefined;
      const uri = typeof res.uri === "string" ? res.uri : "resource";
      parts.push(text !== undefined ? `[${uri}]\n${text}` : `[embedded resource: ${uri}]`);
    } else {
      try {
        parts.push(JSON.stringify(b));
      } catch {
        parts.push(String(b));
      }
    }
  }
  return parts.join("\n\n");
}
