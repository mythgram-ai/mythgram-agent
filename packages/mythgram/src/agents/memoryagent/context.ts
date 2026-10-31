import type { StoredMessage } from "../../services/sessionStore.js";
import type { MemoryAgentBuildRequest } from "./types.js";

/**
 * Serialize the COMPLETE main-agent session context into the memory agent's single user
 * message. Nothing is truncated: every user prompt, assistant answer, assistant reasoning
 * block, tool call, and tool result is rendered in full so the memory agent can summarize
 * with total knowledge of what happened. The current memory files are appended verbatim so
 * the agent can decide what to keep, promote, or rewrite without an initial read pass.
 */
export function buildMemoryAgentUserMessage(request: MemoryAgentBuildRequest): string {
  const lines: string[] = [];

  lines.push(
    "A main-agent turn just finished. Build/update the user's memory from the complete session " +
      "context below, following your procedure. Remember: session-memory.md is the short-term " +
      "session memory you own; MEMORY.md is long-term memory; review USER.md and SOUL.md too.",
    "",
    "<session_info>",
    `chat_session_id: ${request.chatId}`,
    `turn_completed_ok: ${request.turnOk ? "yes" : "no"}`,
    `turn_aborted_by_user: ${request.aborted ? "yes" : "no"}`,
    `triggering_user_prompt: ${request.userMessage}`,
    "</session_info>",
    "",
    "<main_agent_conversation>",
  );

  request.transcript.forEach((message, index) => {
    lines.push(formatMessage(message, index));
  });

  lines.push(
    "</main_agent_conversation>",
    "",
    "<current_memory_files>",
  );

  for (const file of request.memoryFiles) {
    lines.push(
      `--- /memory/${file.path} (${file.content.length} chars) ---`,
      file.content.length > 0 ? file.content : "(empty)",
      "",
    );
  }

  lines.push("</current_memory_files>");
  return lines.join("\n");
}

/** Render one transcript message in full (role, text, reasoning, tool calls, tool results). */
function formatMessage(message: StoredMessage, index: number): string {
  const parts: string[] = [];
  const header = `[#${index + 1}] ${message.role.toUpperCase()}${message.name ? ` (${message.name})` : ""}`;
  parts.push(header);

  if (message.reasoning_content && message.reasoning_content.trim().length > 0) {
    parts.push(`(reasoning)\n${message.reasoning_content}`);
  }

  const content = contentToText(message.content);
  if (content.length > 0) parts.push(content);

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    for (const call of message.tool_calls) {
      const fn = (call as { function?: { name?: unknown; arguments?: unknown } }).function;
      const name = typeof fn?.name === "string" ? fn.name : "unknown_tool";
      const args = typeof fn?.arguments === "string" ? fn.arguments : "";
      parts.push(`(tool call) ${name}(${args})`);
    }
  }

  if (message.role === "tool" && message.tool_call_id) {
    parts.push(`(tool_call_id: ${message.tool_call_id})`);
  }

  return `${parts.join("\n")}\n`;
}

/** Flatten string or multimodal-part content into plain text (image parts become markers). */
function contentToText(content: StoredMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>;
          if (typeof record.text === "string") return record.text;
          if (record.type === "image_url") return "[attached image]";
        }
        return "";
      })
      .filter((t) => t.length > 0)
      .join("\n");
  }
  return "";
}
