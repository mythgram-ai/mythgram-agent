/**
 * Plain-text extraction from Markdown. Used when the requested format is
 * "text", producing a compact, readable paragraph stream.
 */
import { markdownToText } from "../parsers/markdown.js";

/** Truncate text to a sane length for an LLM, with a clear truncation marker. */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated ${text.length - maxChars} chars]`;
}

/** Best-effort title: first line, trimmed, or its first ~120 chars. */
export function inferTitle(text: string): string | undefined {
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return undefined;
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 120)}…` : collapsed;
}

/**
 * Convert Markdown to plain text. Optionally collapses everything to a single
 * run of paragraphs (drop structural markers) for maximum readability.
 */
export function extractText(markdown: string): string {
  return markdownToText(markdown);
}