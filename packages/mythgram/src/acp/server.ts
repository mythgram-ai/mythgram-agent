import crypto from "node:crypto";
import {
  ACP_AGENT_NAME,
  ACP_AGENT_TITLE,
  ACP_AGENT_VERSION,
  ACP_PROTOCOL_VERSION,
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_METHOD_NOT_FOUND,
  type AcpContentBlock,
  type JsonRpcId,
  type JsonRpcMessage,
} from "./types.js";
import { readMessages, writeMessage } from "./protocol.js";
import type { AcpBackendClient } from "./client.js";

/**
 * The ACP agent side of the bridge. Implements the ACP baseline methods
 * (`initialize`, `session/new`, `session/prompt`, `session/cancel`) over stdio and
 * translates the backend's turn events into ACP `session/update` notifications.
 */

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function createSessionId(): string {
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i += 1) out += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  return out;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Map a Mythgram tool name to an ACP tool kind for client presentation. */
function toolKind(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("read") || n.includes("list") || n.includes("glob")) return "read";
  if (n.includes("write") || n.includes("edit") || n.includes("patch") || n.includes("apply")) return "edit";
  if (n.includes("delete") || n.includes("remove")) return "delete";
  if (n.includes("move") || n.includes("rename")) return "move";
  if (n.includes("shell") || n.includes("bash") || n.includes("run") || n.includes("execute")) return "execute";
  if (n.includes("search") || n.includes("grep") || n.includes("find")) return "search";
  if (n.includes("web") || n.includes("fetch") || n.includes("scrape") || n.includes("crawl")) return "fetch";
  return "other";
}

interface AcpSession {
  id: string;
  cwd: string;
  mainMessageId: string;
  activeController: AbortController | null;
  cancelled: boolean;
  stopReason: string | null;
}

export class AcpAgentServer {
  private readonly sessions = new Map<string, AcpSession>();

  constructor(private readonly client: AcpBackendClient) {}

  /** Start reading JSON-RPC messages from stdin. */
  start(): void {
    readMessages((message) => this.handleMessage(message));
    process.stdin.on("end", () => process.exit(0));
  }

  private handleMessage(message: JsonRpcMessage): void {
    const method = str(message.method);
    if (!method) return;
    switch (method) {
      case "initialize":
        if (message.id !== undefined) this.handleInitialize(message.id);
        return;
      case "session/new":
        if (message.id !== undefined) this.handleNewSession(message.id, asRecord(message.params));
        return;
      case "session/prompt":
        if (message.id !== undefined) void this.handlePrompt(message.id, asRecord(message.params));
        return;
      case "session/cancel":
        this.handleCancel(asRecord(message.params));
        return;
      case "authenticate":
        if (message.id !== undefined) this.respondError(message.id, JSONRPC_METHOD_NOT_FOUND, "Authentication is not required.");
        return;
      default:
        if (message.id !== undefined) this.respondError(message.id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
        return;
    }
  }

  private handleInitialize(id: JsonRpcId): void {
    this.respond(id, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: true, embeddedContext: true },
      },
      agentInfo: { name: ACP_AGENT_NAME, title: ACP_AGENT_TITLE, version: ACP_AGENT_VERSION },
      authMethods: [],
    });
  }

  private handleNewSession(id: JsonRpcId, params: Record<string, unknown>): void {
    const sessionId = createSessionId();
    this.sessions.set(sessionId, {
      id: sessionId,
      cwd: str(params.cwd),
      mainMessageId: `msg_${sessionId}`,
      activeController: null,
      cancelled: false,
      stopReason: null,
    });
    this.respond(id, { sessionId });
  }

  private handleCancel(params: Record<string, unknown>): void {
    const session = this.sessions.get(str(params.sessionId));
    if (!session) return;
    session.cancelled = true;
    void this.client.abort(session.id).catch(() => undefined);
    session.activeController?.abort();
  }

  private async handlePrompt(id: JsonRpcId, params: Record<string, unknown>): Promise<void> {
    const sessionId = str(params.sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.respondError(id, JSONRPC_INVALID_PARAMS, `Unknown session "${sessionId}".`);
      return;
    }
    if (session.activeController) {
      this.respondError(id, JSONRPC_INTERNAL_ERROR, "A prompt is already running in this session.");
      return;
    }
    const text = this.flattenPrompt(params.prompt);
    if (!text.trim()) {
      this.respond(id, { stopReason: "end_turn" });
      return;
    }

    session.cancelled = false;
    session.stopReason = null;
    const controller = new AbortController();
    session.activeController = controller;

    try {
      await this.client.prompt({
        chatId: session.id,
        text,
        signal: controller.signal,
        onEvent: (event, data) => this.handleTurnEvent(session, event, data),
      });
    } catch (error) {
      if (!session.cancelled && !controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        this.emitText(session, `${message}\n`, session.mainMessageId);
      }
    } finally {
      if (session.activeController === controller) session.activeController = null;
    }

    const stopReason = session.cancelled ? "cancelled" : (session.stopReason ?? "end_turn");
    this.respond(id, { stopReason });
  }

  /** Translate one backend turn event into ACP session updates. */
  private handleTurnEvent(session: AcpSession, event: string, data: Record<string, unknown>): void {
    switch (event) {
      case "token":
        this.emitText(session, str(data.value), session.mainMessageId);
        break;
      case "reasoning":
        this.emitThought(session, str(data.value), session.mainMessageId);
        break;
      case "tool_call":
        this.emitToolCall(session, data, "");
        break;
      case "tool_result":
        this.emitToolResult(session, data, "");
        break;
      case "team_agent_token":
        this.emitText(session, str(data.value), `msg_${session.id}:${str(data.agent_id)}`);
        break;
      case "team_agent_reasoning":
        this.emitThought(session, str(data.value), `msg_${session.id}:${str(data.agent_id)}`);
        break;
      case "team_agent_tool_call":
        this.emitToolCall(session, data, str(data.agent_id));
        break;
      case "team_agent_tool_result":
        this.emitToolResult(session, data, str(data.agent_id));
        break;
      case "error": {
        const message = str(data.message) || str(data.code) || "The agent reported an error.";
        this.emitText(session, `\n[mythgram] ${message}\n`, session.mainMessageId);
        break;
      }
      case "done":
        if (data.aborted === true) session.cancelled = true;
        session.stopReason = "end_turn";
        break;
      default:
        break;
    }
  }

  private emitText(session: AcpSession, text: string, messageId: string): void {
    if (!text) return;
    this.update(session.id, {
      sessionUpdate: "agent_message_chunk",
      messageId,
      content: { type: "text", text },
    });
  }

  private emitThought(session: AcpSession, text: string, messageId: string): void {
    if (!text) return;
    this.update(session.id, {
      sessionUpdate: "agent_thought_chunk",
      messageId,
      content: { type: "text", text },
    });
  }

  private emitToolCall(session: AcpSession, data: Record<string, unknown>, agentId: string): void {
    const rawId = str(data.id) || str(data.tool_id) || `call_${crypto.randomBytes(6).toString("hex")}`;
    const toolCallId = agentId ? `${agentId}:${rawId}` : rawId;
    const name = str(data.name) || "tool";
    const label = str(data.label) || name;
    const title = agentId ? `${agentId} · ${label}` : label;
    this.update(session.id, {
      sessionUpdate: "tool_call",
      toolCallId,
      title,
      name,
      kind: toolKind(name),
      status: "in_progress",
      rawInput: data.args ?? null,
    });
  }

  private emitToolResult(session: AcpSession, data: Record<string, unknown>, agentId: string): void {
    const rawId = str(data.id) || str(data.tool_id);
    if (!rawId) return;
    const toolCallId = agentId ? `${agentId}:${rawId}` : rawId;
    this.update(session.id, {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: data.ok ? "completed" : "failed",
      content: [{ type: "content", content: { type: "text", text: safeStringify(data.result) } }],
      rawOutput: data.result ?? null,
    });
  }

  /** Flatten ACP prompt content blocks into one text message for the agent. */
  private flattenPrompt(prompt: unknown): string {
    if (typeof prompt === "string") return prompt;
    if (!Array.isArray(prompt)) return "";
    const parts: string[] = [];
    for (const block of prompt as AcpContentBlock[]) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text") {
        parts.push(str(block.text));
      } else if (block.type === "resource" && block.resource) {
        const uri = str(block.resource.uri);
        const text = str(block.resource.text);
        if (text) parts.push(`<resource uri="${uri}">\n${text}\n</resource>`);
        else if (block.resource.blob) parts.push(`[resource: ${uri} (binary, ${str(block.resource.mimeType)})]`);
      } else if (block.type === "resource_link") {
        parts.push(`[resource: ${str(block.name) || str(block.uri)} (${str(block.uri)})]`);
      } else if (block.type === "image") {
        parts.push(`[image attached: ${str(block.mimeType) || "image"}]`);
      } else if (block.type === "audio") {
        parts.push(`[audio attached: ${str(block.mimeType) || "audio"}]`);
      }
    }
    return parts.join("\n");
  }

  private respond(id: JsonRpcId, result: unknown): void {
    writeMessage({ jsonrpc: "2.0", id, result });
  }

  private respondError(id: JsonRpcId, code: number, message: string): void {
    writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private update(sessionId: string, update: Record<string, unknown>): void {
    writeMessage({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
  }
}
