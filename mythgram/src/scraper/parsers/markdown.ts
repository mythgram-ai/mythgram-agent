/**
 * Markdown normalization helpers. Web-scraped Markdown (and the Markdown we
 * generate from HTML) is often noisy; these small utilities make it tidy and
 * compact for an LLM or for syntactic plain-text extraction.
 */

/** Collapse runs of blank lines to a single blank line and trim the edges. */
export function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Convert Markdown to roughly plain text (used by the "text" extraction). */
export function markdownToText(markdown: string): string {
  const normalized = normalizeMarkdown(markdown);
  return collapseInline(normalized)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove emphasis markers, links, inline code, and images from Markdown. */
export function collapseInline(markdown: string): string {
  return markdown
    .replace(/^\s*#+\s+/gm, "") // headings -> text
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "$1") // images -> alt text
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1") // links -> link text
    .replace(/`{3}[\s\S]*?`{3}/g, (block) => {
      // Fenced code -> strip the fences, keep the body.
      return block.replace(/^`{3}[^\n]*\n/, "").replace(/`{3}$/, "");
    })
    .replace(/^\s*>+\s?/gm, "") // blockquote markers
    .replace(/^\s*[-*+]\s+/gm, "- ") // consolidate list bullets (keep one marker)
    .replace(/^\s*\d+\.\s+/gm, "") // ordered list markers
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\|/g, " | ") // soften table pipes
    .replace(/[ \t]+/g, " ") // collapse whitespace runs
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n\n");
}

/** Clean a text fragment: collapse whitespace, trim. */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}