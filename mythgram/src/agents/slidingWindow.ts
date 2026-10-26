import type { StoredMessage } from "../services/sessionStore.js";
import { randomId } from "../database/ids.js";

/**
 * Sliding-window context management (secondary method).
 *
 * When the LLM context window reaches 99% utilization, the oldest
 * truncatable tokens are deleted so the agent can keep working forever
 * with no stop. Each trigger frees ~`truncatePercent` of the context
 * window (default 30%, user-configurable via Settings).
 *
 * Protected (never deleted):
 *  - system prompt (lives outside `messages`, never truncated by construction)
 *  - custom system prompt when active (same path — never in `messages`)
 *  - memory / knowledge blocks when they are present in context
 *    (the `<persistent_memory>` / `<knowledge_base>` blocks prepended to the
 *    first user message; the whole first message is preserved when it carries
 *    them so those blocks survive)
 *  - latest user input (the most recent `role: "user"` message, so the model
 *    always knows the current task)
 *
 * Truncatable (oldest-first):
 *  - chat data (user/assistant text)
 *  - reasoning tokens (`reasoning_content` travels with its assistant message)
 *  - tool calls including results (`assistant.tool_calls` + `role: "tool"`)
 *
 * The loop pauses between iterations (all tool results delivered, no
 * in-flight work discarded), deletes the oldest messages, then resumes —
 * i.e. stop, truncate, restart — exactly like the summarization handoff's
 * safe pause point.
 */

/** Utilization that triggers sliding-window truncation (99% of window). */
export const SLIDING_WINDOW_TRIGGER = 0.99;

/** Default fraction of the window freed per trigger (30%). */
export const DEFAULT_SLIDING_WINDOW_TRUNCATE_PERCENT = 0.3;

/** Bounds for the user-configurable truncate percent (5%..90%). */
export const MIN_SLIDING_WINDOW_TRUNCATE_PERCENT = 0.05;
export const MAX_SLIDING_WINDOW_TRUNCATE_PERCENT = 0.9;

/** Context-management methods the user can choose between. */
export type ContextManagementMethod = "summarization" | "sliding_window";

/** Default method (Auto context summarization). */
export const DEFAULT_CONTEXT_MANAGEMENT_METHOD: ContextManagementMethod = "summarization";

/** Rough chars-per-token for estimation (no tokenizer dependency). */
const CHARS_PER_TOKEN = 4;

/** Max removed messages described in one truncation preview (bounds SSE). */
const MAX_PREVIEW_MESSAGES = 20;
/** Max chars of deleted content carried in one truncation event. */
const MAX_PREVIEW_CHARS = 8000;
/** Preview chars per removed message. */
const PREVIEW_CHARS_PER_MESSAGE = 300;

/** Normalize the user-selected context-management method. Unknown → summarization. */
export function normalizeContextManagementMethod(raw: unknown): ContextManagementMethod {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "sliding_window" || v === "sliding-window" || v === "slidingwindow" || v === "window") {
    return "sliding_window";
  }
  return "summarization";
}

/** Normalize the user-configured truncate percent (0.05..0.9, default 0.3). */
export function normalizeSlidingWindowTruncatePercent(raw: unknown): number {
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SLIDING_WINDOW_TRUNCATE_PERCENT;
  // Accept both fraction (0.3) and percent (30) spellings.
  const fraction = n > 1 ? n / 100 : n;
  if (!Number.isFinite(fraction)) return DEFAULT_SLIDING_WINDOW_TRUNCATE_PERCENT;
  return Math.min(
    MAX_SLIDING_WINDOW_TRUNCATE_PERCENT,
    Math.max(MIN_SLIDING_WINDOW_TRUNCATE_PERCENT, fraction),
  );
}

/** Utilization = prompt_tokens / context_limit (null when unknown). */
export function slidingWindowUtilizationOf(
  promptTokens: number | undefined | null,
  contextLimit: number | undefined | null,
): number | null {
  if (typeof promptTokens !== "number" || !Number.isFinite(promptTokens) || promptTokens < 0) {
    return null;
  }
  if (typeof contextLimit !== "number" || !Number.isFinite(contextLimit) || contextLimit <= 0) {
    return null;
  }
  return promptTokens / contextLimit;
}

/** True when sliding-window truncation must start (utilization ≥ 99%). */
export function shouldTriggerSlidingWindow(
  promptTokens: number | undefined | null,
  contextLimit: number | undefined | null,
): boolean {
  const utilization = slidingWindowUtilizationOf(promptTokens, contextLimit);
  if (utilization === null) return false;
  return utilization >= SLIDING_WINDOW_TRIGGER;
}

/** Estimate tokens for a plain text blob (chars/4, minimum 1 for non-empty). */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

function contentTextLength(content: StoredMessage["content"]): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") n += record.text.length;
      else if (record.type === "image_url") n += 1000; // image placeholder cost
      else n += 20;
    }
    return n;
  }
  return 0;
}

/** Estimate tokens for one stored message (content + reasoning + tool calls). */
export function estimateMessageTokens(message: StoredMessage): number {
  let chars = contentTextLength(message.content ?? "");
  if (typeof message.reasoning_content === "string") chars += message.reasoning_content.length;
  if (Array.isArray(message.tool_calls)) {
    try {
      chars += JSON.stringify(message.tool_calls).length;
    } catch {
      chars += 100;
    }
  }
  if (typeof message.tool_call_id === "string") chars += message.tool_call_id.length;
  if (typeof message.name === "string") chars += message.name.length;
  if (chars === 0) return 1;
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}

function messageContainsMemoryOrKnowledge(message: StoredMessage): boolean {
  if (message.role !== "user") return false;
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .map((p) => ((p as Record<string, unknown>).text as string) ?? "")
            .filter((t) => typeof t === "string")
            .join("\n")
        : "";
  return text.includes("<persistent_memory>") || text.includes("<knowledge_base>");
}

function describeMessageForPreview(message: StoredMessage): string {
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .map((p) => {
              const r = (p ?? {}) as Record<string, unknown>;
              if (typeof r.text === "string") return r.text;
              if (r.type === "image_url") return "[attached image]";
              return "";
            })
            .filter(Boolean)
            .join("\n")
        : "";
  const trimmed = text.trim().slice(0, PREVIEW_CHARS_PER_MESSAGE);
  let suffix = "";
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const names = message.tool_calls
      .map((c) => {
        const fn = (c as { function?: { name?: unknown } }).function;
        return typeof fn?.name === "string" ? fn.name : "";
      })
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");
    if (names) suffix = ` [tool_calls: ${names}]`;
  } else if (message.role === "tool" && message.name) {
    suffix = ` [tool_result: ${message.name}]`;
  }
  if (message.reasoning_content && message.reasoning_content.trim()) {
    suffix += ` [reasoning: ${message.reasoning_content.trim().slice(0, 120)}]`;
  }
  const body = trimmed.length > 0 ? trimmed : "(no text)";
  return `${message.role.toUpperCase()}: ${body}${suffix}`;
}

export interface SlidingWindowTruncation {
  /** Messages to keep (original order, protected + untriggered suffix). */
  kept: StoredMessage[];
  /** Messages removed (oldest-first). */
  removed: StoredMessage[];
  /** Estimated tokens freed (sum of removed estimates + orphan cleanup). */
  freedTokens: number;
  /** Target tokens we aimed to free (contextLimit * truncatePercent). */
  targetTokens: number;
  /** Compact preview lines for the UI block (bounded). */
  preview: string[];
  /** Indices removed (for observability). */
  removedIndices: number[];
}

export interface SlidingWindowTruncateInput {
  messages: StoredMessage[];
  contextLimit: number;
  truncatePercent?: number;
}

/**
 * Delete the oldest truncatable messages until ~`truncatePercent` of the
 * window is freed. Protected: the first user message when it carries
 * memory/knowledge blocks, and the latest user message. Tool-boundary
 * repair drops leading orphan `role: "tool"` messages whose assistant call
 * was removed. Never throws — worst case returns everything kept.
 */
export function executeSlidingWindowTruncation(input: SlidingWindowTruncateInput): SlidingWindowTruncation {
  const empty: SlidingWindowTruncation = {
    kept: input.messages.slice(),
    removed: [],
    freedTokens: 0,
    targetTokens: 0,
    preview: [],
    removedIndices: [],
  };
  try {
    const messages = Array.isArray(input.messages) ? input.messages : [];
    const contextLimit =
      typeof input.contextLimit === "number" && Number.isFinite(input.contextLimit) && input.contextLimit > 0
        ? Math.floor(input.contextLimit)
        : 0;
    if (messages.length === 0 || contextLimit <= 0) return empty;
    const percent = normalizeSlidingWindowTruncatePercent(input.truncatePercent);
    const targetTokens = Math.max(1, Math.floor(contextLimit * percent));

    // Protected indices: first message if it carries memory/knowledge blocks,
    // plus the latest user message (so the model keeps the current task).
    const protectedIdx = new Set<number>();
    if (messages.length > 0 && messageContainsMemoryOrKnowledge(messages[0]!)) {
      protectedIdx.add(0);
    }
    let latestUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === "user") {
        latestUserIdx = i;
        break;
      }
    }
    if (latestUserIdx >= 0) protectedIdx.add(latestUserIdx);

    const estimates = messages.map(estimateMessageTokens);
    // Oldest-first candidates (skip protected).
    const candidates: number[] = [];
    for (let i = 0; i < messages.length; i += 1) {
      if (!protectedIdx.has(i)) candidates.push(i);
    }
    if (candidates.length === 0) return { ...empty, targetTokens };

    const toRemove = new Set<number>();
    let freed = 0;
    for (const idx of candidates) {
      if (freed >= targetTokens) break;
      toRemove.add(idx);
      freed += estimates[idx] ?? 0;
    }
    if (toRemove.size === 0) return { ...empty, targetTokens };

    // Repair: if the kept suffix starts with orphan tool messages (their
    // assistant tool_calls was removed), drop those too — they would 400 the
    // next provider request. Freed tokens grow accordingly (best effort).
    const removedSorted = [...toRemove].sort((a, b) => a - b);
    const keptProbe = messages.filter((_, i) => !toRemove.has(i));
    // Find leading orphan tools in keptProbe after any protected head.
    // Only the boundary matters: walk keptProbe from the first non-protected
    // position; drop leading role=tool messages.
    let probeStart = 0;
    // Skip a protected head (index 0 protected) — orphans can only start after it.
    if (protectedIdx.has(0) && keptProbe.length > 0) {
      // keptProbe[0] is the protected first message; orphans start at 1.
      probeStart = 1;
    }
    let extra = 0;
    while (probeStart < keptProbe.length && keptProbe[probeStart]!.role === "tool") {
      // Map back to original index to mark removed.
      const msg = keptProbe[probeStart]!;
      const origIdx = messages.indexOf(msg);
      if (origIdx === -1) break;
      toRemove.add(origIdx);
      freed += estimates[origIdx] ?? 0;
      extra += 1;
      probeStart += 1;
      if (extra > 50) break; // safety bound
    }
    void removedSorted;

    const removedIndices = [...toRemove].sort((a, b) => a - b);
    const removed = removedIndices.map((i) => messages[i]!);
    const kept = messages.filter((_, i) => !toRemove.has(i));

    // Bounded preview for the UI block (oldest-first, capped).
    const preview: string[] = [];
    let previewChars = 0;
    for (const msg of removed.slice(0, MAX_PREVIEW_MESSAGES)) {
      const line = describeMessageForPreview(msg);
      if (previewChars + line.length > MAX_PREVIEW_CHARS) {
        preview.push(`… and ${removed.length - preview.length} more message(s) truncated`);
        break;
      }
      preview.push(line);
      previewChars += line.length + 1;
    }
    if (removed.length > MAX_PREVIEW_MESSAGES && preview[preview.length - 1]?.startsWith("…") !== true) {
      preview.push(`… and ${removed.length - MAX_PREVIEW_MESSAGES} more message(s) truncated`);
    }

    return { kept, removed, freedTokens: freed, targetTokens, preview, removedIndices };
  } catch {
    return empty;
  }
}

/** Stable truncation id for one pause→truncate→resume cycle. */
export function createSlidingWindowTruncationId(): string {
  return `sw_${randomId(10)}`;
}
