/**
 * Helpers that keep a session transcript usable after a turn is interrupted —
 * by the user (Stop) or by the system (provider failure, crash, restart) — so
 * the user can "Continue" the task from where it stopped.
 */

/** Minimal message shape shared by the chat and agent transcripts. */
interface TranscriptMessage {
  role: string;
  content?: unknown;
  tool_calls?: Array<{ id?: string | null }>;
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

/**
 * Record the partial assistant output streamed before an interruption, so a later
 * "continue" turn sees what was already written instead of starting over.
 * Incomplete tool calls are dropped (their arguments may be truncated JSON).
 */
export function pushPartialAssistant<T extends TranscriptMessage>(
  messages: T[],
  answerParts: string[],
  reasoningParts: string[],
): void {
  const content = answerParts.join("");
  const reasoning = reasoningParts.join("");
  if (content.trim().length === 0) return;
  const message = { role: "assistant", content } as unknown as T;
  if (reasoning.length > 0) message.reasoning_content = reasoning;
  messages.push(message);
}

/** Tool result substituted for a tool call that never finished. */
export const INTERRUPTED_TOOL_RESULT = JSON.stringify({
  ok: false,
  error: {
    code: "interrupted",
    message: "This tool call was interrupted before it completed. Re-run it if it is still needed.",
  },
});

/**
 * Providers reject a transcript where an assistant tool call has no matching tool
 * result. An interruption between a tool call and its result leaves exactly that,
 * so fill every unanswered call with an "interrupted" result. Returns a new array;
 * the stored transcript is left untouched.
 */
export function repairInterruptedToolCalls<T extends TranscriptMessage>(messages: T[]): T[] {
  const repaired: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    repaired.push(message);
    if (message.role !== "assistant" || !message.tool_calls?.length) continue;

    const answered = new Set<string>();
    let j = i + 1;
    while (j < messages.length && messages[j]!.role === "tool") {
      const id = messages[j]!.tool_call_id;
      if (id) answered.add(id);
      repaired.push(messages[j]!);
      j++;
    }
    for (const call of message.tool_calls) {
      if (call.id && !answered.has(call.id)) {
        repaired.push({ role: "tool", tool_call_id: call.id, content: INTERRUPTED_TOOL_RESULT } as unknown as T);
      }
    }
    i = j - 1;
  }
  return repaired;
}
