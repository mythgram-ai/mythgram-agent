/**
 * Marker that separates the user-visible prompt from extra context that must reach the LLM but
 * should never be shown to the user (attached workflow/role documents). The stored message keeps
 * the full text so the model retains it in history; the UI renders only the text before the marker.
 */
export const ATTACHED_CONTEXT_MARKER = "<!-- mythgram:attached-context -->";

/**
 * Append `hidden` context to a user-visible prompt behind ATTACHED_CONTEXT_MARKER. The returned
 * string is what gets sent to the model (and stored as the message content); callers render it with
 * `visiblePromptText`.
 */
export function withAttachedContext(visible: string, hidden: string): string {
  if (!hidden.trim()) return visible;
  const separator = visible.trim().length > 0 ? "\n\n" : "";
  return `${visible}${separator}${ATTACHED_CONTEXT_MARKER}\n${hidden}`;
}

/** The part of a message the user is allowed to see (everything before the hidden-context marker). */
export function visiblePromptText(content: string): string {
  const index = content.indexOf(ATTACHED_CONTEXT_MARKER);
  if (index < 0) return content;
  return content.slice(0, index).trimEnd();
}