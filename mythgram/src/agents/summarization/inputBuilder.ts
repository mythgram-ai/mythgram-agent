import type { StoredMessage } from "../../services/sessionStore.js";
import type { HandoffIds, SummarySnapshot } from "./types.js";

/**
 * Filtered summary-input builder (explicit allowlist).
 *
 * The summary agent receives ONLY:
 *   A. Chat data (user/assistant text, original order, no reasoning)
 *   B. Tool calls and results (ordering/ids/associations preserved)
 *   C. Latest user input (explicit field, single latest message)
 *
 * Explicitly excluded before serialization:
 *   - system prompts (role "system" messages are dropped; the active prompt
 *     lives outside session.messages and is never copied here)
 *   - custom system prompts (same path — never in session.messages)
 *   - hidden reasoning (reasoning_content is never copied)
 *   - memory and knowledge content (first-message persistent-memory and
 *     knowledge-base blocks are stripped; memory and knowledge tool traffic
 *     is excluded entirely so file contents cannot leak through results)
 *   - any other non-allowlisted field or nested metadata
 */

const MEMORY_BLOCK = /<persistent_memory>[\s\S]*?<\/persistent_memory>/g;
const KNOWLEDGE_BLOCK = /<knowledge_base>[\s\S]*?<\/knowledge_base>/g;

function textOf(content: StoredMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const record = part as Record<string, unknown>;
        if (typeof record.text === "string") return record.text;
        if (record.type === "image_url") return "[attached image]";
        return "";
      })
      .filter((t) => t.length > 0)
      .join("\n");
  }
  return "";
}

function stripMemoryKnowledge(text: string): string {
  return text.replace(MEMORY_BLOCK, "").replace(KNOWLEDGE_BLOCK, "").trim();
}

function isMemoryOrKnowledgeTool(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const n = name.trim();
  return n.startsWith("memory_") || n.startsWith("knowledge_");
}

function cloneToolCalls(raw: unknown): Array<{ id: string | null; name: string; args: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string | null; name: string; args: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const fn = (record.function ?? {}) as Record<string, unknown>;
    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name || isMemoryOrKnowledgeTool(name)) continue;
    out.push({
      id: typeof record.id === "string" ? record.id : null,
      name,
      args: typeof fn.arguments === "string" ? fn.arguments : "{}",
    });
  }
  return out;
}

/**
 * Build an isolated, allowlisted snapshot. Never returns references into the
 * caller's mutable message array. Never throws on malformed input.
 */
export function buildSummarySnapshot(
  messages: StoredMessage[],
  handoff: HandoffIds,
): SummarySnapshot {
  const source = Array.isArray(messages) ? messages : [];

  // Latest user input: the actual latest role==="user" message at finalization.
  let latestUserInput = "";
  for (let i = source.length - 1; i >= 0; i -= 1) {
    const m = source[i];
    if (!m || m.role !== "user") continue;
    latestUserInput = stripMemoryKnowledge(textOf(m.content));
    break;
  }

  const chatData: StoredMessage[] = [];
  const toolById = new Map<string, StoredMessage>();

  for (const original of source) {
    if (!original || typeof original !== "object") continue;
    const role = (original as { role?: unknown }).role;
    if (role === "system") continue;
    if (role !== "user" && role !== "assistant" && role !== "tool") continue;

    if (role === "user") {
      const text = stripMemoryKnowledge(textOf(original.content));
      // Skip emptied preface-only messages (defensive; latest input kept separately).
      if (!text) continue;
      chatData.push({ role: "user", content: text });
      continue;
    }

    if (role === "assistant") {
      const text = textOf(original.content);
      const calls = cloneToolCalls((original as { tool_calls?: unknown }).tool_calls);
      // Drop pure-reasoning assistant messages with no text and no (allowed) calls.
      if (!text && calls.length === 0) continue;
      const copy: StoredMessage = {
        role: "assistant",
        content: text || null,
      };
      if (calls.length > 0) {
        copy.tool_calls = calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.args },
        }));
      }
      chatData.push(copy);
      continue;
    }

    // role === "tool"
    const name = (original as { name?: unknown }).name;
    if (isMemoryOrKnowledgeTool(name)) continue;
    const toolCallId =
      typeof (original as { tool_call_id?: unknown }).tool_call_id === "string"
        ? ((original as { tool_call_id?: string }).tool_call_id as string)
        : undefined;
    const text = textOf(original.content);
    const copy: StoredMessage = {
      role: "tool",
      content: text,
    };
    if (toolCallId) copy.tool_call_id = toolCallId;
    if (typeof name === "string" && name) copy.name = name;
    chatData.push(copy);
    if (toolCallId) toolById.set(toolCallId, copy);
  }

  // Re-derive tool traffic pairs from the filtered chat data (no duplicates).
  const toolTraffic: SummarySnapshot["toolTraffic"] = [];
  for (const msg of chatData) {
    if (msg.role !== "assistant" || !Array.isArray(msg.tool_calls)) continue;
    for (const call of msg.tool_calls) {
      const record = call as { id?: unknown };
      const id = typeof record.id === "string" ? record.id : null;
      const result = id ? (toolById.get(id) ?? null) : null;
      const callMsg: StoredMessage = {
        role: "assistant",
        content: null,
        tool_calls: [call],
      };
      toolTraffic.push({ call: callMsg, result });
    }
  }

  return { chatData, toolTraffic, latestUserInput, handoff: { ...handoff } };
}

/** Serialize a snapshot into the text appended after the request prompt. */
export function serializeSnapshot(snapshot: SummarySnapshot): string {
  const lines: string[] = [];
  lines.push("<summary_snapshot>");
  lines.push(`handoff_id: ${snapshot.handoff.handoffId}`);
  lines.push(`chat_id: ${snapshot.handoff.chatId}`);
  lines.push("");
  lines.push("<chat_data>");
  snapshot.chatData.forEach((m, i) => {
    const body = textOf(m.content);
    const calls = Array.isArray(m.tool_calls)
      ? m.tool_calls
          .map((c) => {
            const fn = (c as { function?: { name?: unknown; arguments?: unknown } }).function;
            return `tool_call ${String(fn?.name ?? "")}(${String(fn?.arguments ?? "")})`;
          })
          .join("; ")
      : "";
    lines.push(`[#${i + 1}] ${m.role.toUpperCase()}${m.name ? ` (${m.name})` : ""}`);
    if (body) lines.push(body);
    if (calls) lines.push(`(${calls})`);
    if (m.tool_call_id) lines.push(`(tool_call_id: ${m.tool_call_id})`);
    lines.push("");
  });
  lines.push("</chat_data>");
  lines.push("");
  lines.push("<latest_user_input>");
  lines.push(snapshot.latestUserInput || "(none)");
  lines.push("</latest_user_input>");
  lines.push("</summary_snapshot>");
  return lines.join("\n");
}
