import type {
  AcpContentBlock,
  AcpElicitationRequest,
  AcpPermissionOption,
  AcpPlanEntry,
  AcpSessionUpdate,
  AcpStoredEvent,
  AcpToolCall,
  AcpToolCallContent,
} from "@/lib/acpClient";

/**
 * Pure reducer from the ACP session event log (user prompts + ACP
 * `session/update` notifications) into renderable chat entries. The same
 * reducer is used for live SSE events and for replay after a reload, so the
 * transcript is deterministic either way.
 */

export type AcpChatEntry =
  | { kind: "user"; key: string; text: string; createdAt: number }
  | {
      kind: "assistant" | "thought";
      key: string;
      text: string;
      messageId?: string;
      createdAt: number;
    }
  | { kind: "tool"; key: string; toolCall: AcpToolCall; createdAt: number }
  | { kind: "plan"; key: string; entries: AcpPlanEntry[]; createdAt: number }
  | {
      kind: "notice";
      key: string;
      title: string;
      description?: string;
      severity: string;
      createdAt: number;
    }
  | { kind: "error"; key: string; text: string; createdAt: number }
  | {
      kind: "permission";
      key: string;
      requestId: string;
      toolCall: AcpToolCall;
      options: AcpPermissionOption[];
      resolved: boolean;
      createdAt: number;
    }
  | {
      kind: "elicitation";
      key: string;
      requestId: string;
      request: AcpElicitationRequest;
      resolved: boolean;
      createdAt: number;
    };

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textOfContent(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const block = content as AcpContentBlock;
  if (block.type === "text") return str(block.text);
  if (block.type === "resource") {
    const resource = block.resource;
    if (resource && typeof resource.text === "string") return resource.text;
    return resource?.uri ? `[resource: ${resource.uri}]` : "[resource]";
  }
  if (block.type === "resource_link") return `[${str(block.name) || "resource"}](${str(block.uri)})`;
  if (block.type === "image") return "[image]";
  if (block.type === "audio") return "[audio]";
  return block.type ? `[${block.type}]` : "";
}

function asToolCall(value: unknown): AcpToolCall {
  const raw = rec(value);
  return {
    ...raw,
    toolCallId: str(raw.toolCallId) || `tool_${Math.random().toString(36).slice(2, 8)}`,
  } as AcpToolCall;
}

function mergeToolCall(existing: AcpToolCall, update: Record<string, unknown>): AcpToolCall {
  const next: AcpToolCall = { ...existing };
  if (typeof update.title === "string") next.title = update.title;
  if (typeof update.name === "string") next.name = update.name;
  if (typeof update.kind === "string") next.kind = update.kind;
  if (typeof update.status === "string") next.status = update.status;
  if (Array.isArray(update.locations)) {
    next.locations = update.locations as AcpToolCall["locations"];
  }
  if (Array.isArray(update.content)) {
    next.content = update.content as AcpToolCallContent[];
  }
  if (Object.prototype.hasOwnProperty.call(update, "rawInput")) next.rawInput = update.rawInput;
  if (Object.prototype.hasOwnProperty.call(update, "rawOutput")) next.rawOutput = update.rawOutput;
  return next;
}

function eventTime(event: AcpStoredEvent): number {
  return event.createdAt || Date.now();
}

export function buildAcpChat(events: AcpStoredEvent[]): AcpChatEntry[] {
  const out: AcpChatEntry[] = [];

  const appendChunk = (
    kind: "assistant" | "thought",
    text: string,
    messageId: string | undefined,
    at: number,
  ) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (
      last &&
      (last.kind === "assistant" || last.kind === "thought") &&
      last.kind === kind &&
      (!messageId || !last.messageId || last.messageId === messageId)
    ) {
      last.text += text;
      if (messageId) last.messageId = messageId;
      return;
    }
    out.push({
      kind,
      key: `${kind}:${messageId || out.length}:${at}`,
      text,
      messageId,
      createdAt: at,
    });
  };

  for (const event of events) {
    const data = rec(event.data);
    const at = eventTime(event);
    switch (event.event) {
      case "user": {
        const text = str(data.text);
        if (text) out.push({ kind: "user", key: `user:${event.seq}:${at}`, text, createdAt: at });
        break;
      }
      case "update": {
        const update = rec(data.update) as AcpSessionUpdate;
        const kind = str(update.sessionUpdate);
        const messageId = str(update.messageId) || undefined;
        switch (kind) {
          case "agent_message_chunk":
            appendChunk("assistant", textOfContent(update.content), messageId, at);
            break;
          case "agent_thought_chunk":
            appendChunk("thought", textOfContent(update.content), messageId, at);
            break;
          case "user_message_chunk":
            // The prompt is already rendered from the `user` event; history replay
            // from an agent may also send it. Avoid duplicating it.
            break;
          case "tool_call":
          case "tool_call_update": {
            const toolCallId = str(update.toolCallId);
            if (!toolCallId) break;
            const index = out.findIndex(
              (entry) => entry.kind === "tool" && entry.toolCall.toolCallId === toolCallId,
            );
            if (index === -1) {
              const toolCall = mergeToolCall(
                { toolCallId, title: str(update.title) || "Tool call" },
                update as unknown as Record<string, unknown>,
              );
              out.push({
                kind: "tool",
                key: `tool:${toolCallId}`,
                toolCall,
                createdAt: at,
              });
            } else {
              const entry = out[index];
              if (entry.kind === "tool") {
                entry.toolCall = mergeToolCall(
                  entry.toolCall,
                  update as unknown as Record<string, unknown>,
                );
              }
            }
            break;
          }
          case "plan": {
            const entries = Array.isArray(update.entries) ? update.entries : [];
            const last = out[out.length - 1];
            if (last?.kind === "plan") {
              last.entries = entries;
            } else {
              out.push({ kind: "plan", key: `plan:${out.length}:${at}`, entries, createdAt: at });
            }
            break;
          }
          case "notice": {
            out.push({
              kind: "notice",
              key: `notice:${event.seq}:${at}`,
              title: str(update.title) || "Notice",
              description: str(update.description) || undefined,
              severity: str(update.severity) || "info",
              createdAt: at,
            });
            break;
          }
          case "compaction_update":
          case "compaction_summary_chunk": {
            if (kind === "compaction_update" && str(update.status) === "failed") {
              out.push({
                kind: "notice",
                key: `compaction:${event.seq}:${at}`,
                title: "Context compaction failed",
                description: str(update.error) || undefined,
                severity: "error",
                createdAt: at,
              });
            }
            break;
          }
          default:
            break;
        }
        break;
      }
      case "permission_request": {
        out.push({
          kind: "permission",
          key: `permission:${str(data.requestId)}`,
          requestId: str(data.requestId),
          toolCall: asToolCall(data.toolCall),
          options: Array.isArray(data.options) ? (data.options as AcpPermissionOption[]) : [],
          resolved: false,
          createdAt: at,
        });
        break;
      }
      case "permission_resolved": {
        const requestId = str(data.requestId);
        for (const entry of out) {
          if (entry.kind === "permission" && entry.requestId === requestId) entry.resolved = true;
        }
        break;
      }
      case "elicitation_request": {
        out.push({
          kind: "elicitation",
          key: `elicitation:${str(data.requestId)}`,
          requestId: str(data.requestId),
          request: rec(data.request) as AcpElicitationRequest,
          resolved: false,
          createdAt: at,
        });
        break;
      }
      case "elicitation_resolved": {
        const requestId = str(data.requestId);
        for (const entry of out) {
          if (entry.kind === "elicitation" && entry.requestId === requestId) entry.resolved = true;
        }
        break;
      }
      case "notice": {
        out.push({
          kind: "notice",
          key: `notice:${event.seq}:${at}`,
          title: str(data.title) || "Notice",
          description: str(data.description) || undefined,
          severity: str(data.severity) || "info",
          createdAt: at,
        });
        break;
      }
      case "error": {
        out.push({
          kind: "error",
          key: `error:${event.seq}:${at}`,
          text: str(data.message) || "The ACP agent reported an error.",
          createdAt: at,
        });
        break;
      }
      case "done": {
        const stopReason = str(data.stopReason);
        if (stopReason && stopReason !== "end_turn" && stopReason !== "cancelled") {
          out.push({
            kind: "notice",
            key: `stop:${event.seq}:${at}`,
            title: `Turn stopped: ${stopReason.replaceAll("_", " ")}`,
            severity: stopReason === "refusal" ? "warning" : "info",
            createdAt: at,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Last known session metadata carried by an update (title/mode/usage/config). */
export function metaFromUpdate(
  update: AcpSessionUpdate,
  previous: {
    title?: string;
    currentModeId?: string;
    configOptions?: unknown;
    usage?: unknown;
    commands?: unknown;
  },
): {
  title?: string;
  currentModeId?: string;
  configOptions?: unknown;
  usage?: unknown;
  commands?: unknown;
} {
  const next = { ...previous };
  const kind = str(update.sessionUpdate);
  if (kind === "current_mode_update" && typeof update.currentModeId === "string") {
    next.currentModeId = update.currentModeId;
  }
  if (kind === "config_option_update" && Array.isArray(update.configOptions)) {
    next.configOptions = update.configOptions;
  }
  if (kind === "usage_update" && typeof update.used === "number" && typeof update.size === "number") {
    next.usage = { used: update.used, size: update.size, cost: update.cost };
  }
  if (kind === "available_commands_update" && Array.isArray(update.availableCommands)) {
    next.commands = update.availableCommands;
  }
  if (kind === "session_info_update") {
    const title = str(update.title) || str(update.titleUpdate) || str(update.title_update);
    if (title) next.title = title;
  }
  return next;
}
