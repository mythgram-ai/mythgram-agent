/**
 * HTML -> Markdown renderer. Walks the light DOM tree produced by
 * `scraper/html.ts` and emits reasonably clean GitHub-flavoured-ish Markdown:
 * headings, paragraphs, emphasis, code blocks, lists, blockquotes, tables and
 * links. It is deliberately pragmatic -- the goal is readable, model-friendly
 * text, not pixel-perfect round-tripping.
 */
import type { HtmlElementNode, HtmlNode, HtmlRoot } from "../html.js";
import { textContent } from "../html.js";

interface Ctx {
  /** Guarantee the next emission starts on its own line. */
  blankLine(): void;
  line(start: string): void;
  content(): string;
}

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "main",
  "aside",
  "address",
  "figure",
  "figcaption",
  "fieldset",
]);

/** Elements whose content we never render into markdown. */
const SKIP_TAGS = new Set(["script", "style", "template", "noscript", "iframe", "form", "svg"]);

/** Elements rendered as blank separators with optional heading text. */
const HEADING_LEVEL: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8230;/g, "…")
    .replace(/&#\d+;/g, (m) => {
      try {
        return String.fromCodePoint(Number(m.slice(2, -1)));
      } catch {
        return "";
      }
    })
    .replace(/&#x[0-9a-f]+;/gi, (m) => {
      try {
        return String.fromCodePoint(parseInt(m.slice(2, -1), 16));
      } catch {
        return "";
      }
    });
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Serialize inline content (emphasis, code, links, plain text). */
function inline(node: HtmlNode, out: Ctx): void {
  if (node.type === "text") {
    out.line(decodeEntities(node.text).replace(/\s+/g, " "));
    return;
  }
  const el = node as HtmlElementNode;
  const tag = el.tag;

  if (SKIP_TAGS.has(tag)) return;

  switch (tag) {
    case "a": {
      const href = el.attrs.href ?? "";
      const label = collapseWhitespace(inlineText(el));
      if (!label) return;
      if (!href || /^(javascript|mailto|tel):/i.test(href)) {
        out.line(label);
        return;
      }
      out.line(`[${label}](${href})`);
      return;
    }
    case "br":
      out.line("\n");
      return;
    case "strong":
    case "b":
      out.line(`**${collapseWhitespace(inlineText(el))}**`);
      return;
    case "em":
    case "i":
      out.line(`*${collapseWhitespace(inlineText(el))}*`);
      return;
    case "code":
      out.line(`\`${inlineText(el)}\``);
      return;
    case "mark":
    case "u":
      out.line(inlineText(el));
      return;
    case "img":
      out.line(`![${el.attrs.alt ?? ""}](${el.attrs.src ?? ""})`);
      return;
    case "span":
    case "label":
    case "small":
    case "abbr":
    case "cite":
    case "time":
    case "del":
    case "sub":
    case "sup":
    case "q":
    case "button":
    case "summary":
    case "map":
    case "area":
      inlineTextBlock(el, out);
      return;
    default:
      // Unknown inline-ish tag: recurse into children, but add a space boundary
      // around block-level items like divs embedded inside anchors etc.
      inlineTextBlock(el, out);
  }
}

/** Inline text of an element (used for link labels / emphasis). */
function inlineText(el: HtmlElementNode): string {
  return textContent(el).replace(/\s+/g, " ").trim();
}

/** Emit the inline children of a possibly-block ancestor on the current line. */
function inlineTextBlock(el: HtmlElementNode, out: Ctx): void {
  for (const child of el.children) {
    if (child.type === "text") out.line(decodeEntities(child.text).replace(/\s+/g, " "));
    else inline(child, out);
  }
}

/**
 * Render a block-level subtree. `listCtx` tracks ordered/unordered list state
 * so nested lists are indented properly.
 */
function block(node: HtmlNode, out: Ctx, indent = ""): void {
  if (node.type === "text") {
    const t = decodeEntities(node.text).replace(/\s+/g, " ").trim();
    if (t) out.line(t);
    return;
  }

  const el = node as HtmlElementNode;
  const tag = el.tag;

  if (SKIP_TAGS.has(tag)) return;

  if (HEADING_LEVEL[tag]) {
    const level = HEADING_LEVEL[tag];
    const text = collapseWhitespace(inlineText(el));
    if (!text) return;
    out.blankLine();
    out.line(`${"#".repeat(level)} ${text}`);
    out.blankLine();
    return;
  }

  if (tag === "p") {
    out.blankLine();
    inlineTextBlock(el, out);
    out.blankLine();
    return;
  }

  if (tag === "br") {
    out.line("\n");
    return;
  }

  if (tag === "img") {
    const src = el.attrs.src;
    if (src) out.line(`![${el.attrs.alt ?? ""}](${src})`);
    return;
  }

  if (tag === "hr") {
    out.blankLine();
    out.line("---");
    out.blankLine();
    return;
  }

  if (tag === "blockquote") {
    out.blankLine();
    const inner = new Cursor();
    for (const child of el.children) block(child, inner);
    const lines = inner.toString().split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) out.line(`> ${line.trim()}`);
    out.blankLine();
    return;
  }

  if (tag === "pre") {
    out.blankLine();
    const code = decodeEntities(textContent(el)).replace(/\s+$/g, "").replace(/^\n/, "");
    out.line("```");
    out.line(code);
    out.line("```");
    out.blankLine();
    return;
  }

  if (tag === "code" && el.attrs.class?.includes("language")) {
    // Inline or verbose code handled above; nothing special.
  }

  if (tag === "ul" || tag === "ol") {
    out.blankLine();
    const ordered = tag === "ol";
    let liIndex = 1;
    let first = true;
    for (const child of el.children) {
      if (child.type !== "element" || child.tag === "script" || child.tag === "template") continue;
      if (!first) out.line("\n");
      if (child.tag === "li") {
        const marker = ordered ? `${liIndex}.` : "-";
        liIndex += 1;
        renderListItem(child, marker, out, indent);
      } else {
        block(child, out, indent);
      }
      first = false;
    }
    out.blankLine();
    return;
  }

  if (tag === "li") {
    renderListItem(el, indent ? "-" : "-", out, indent);
    return;
  }

  if (tag === "table") {
    renderTable(el, out);
    return;
  }

  if (tag === "tr" || tag === "td" || tag === "th" || tag === "thead" || tag === "tbody") {
    renderTableParts(el, out, indent);
    return;
  }

  if (BLOCK_TAGS.has(tag)) {
    out.blankLine();
    inlineTextBlock(el, out);
    out.blankLine();
    return;
  }

  // Default: recurse into children as blocks.
  for (const child of el.children) block(child, out, indent);
}

function renderListItem(
  li: HtmlElementNode,
  marker: string,
  out: Ctx,
  indent: string,
): void {
  const firstContent: HtmlNode[] = [];
  const rest: HtmlNode[] = [];
  // Split: leading inline content stays on the list line; nested blocks follow.
  let capturing = true;
  for (const child of li.children) {
    const isBlockish = child.type === "element" && isBlockElement(child);
    if (capturing && isBlockish) capturing = false;
    if (child.type === "element" && (child.tag === "ul" || child.tag === "ol")) {
      rest.push(child);
    } else if (capturing) {
      firstContent.push(child);
    } else {
      rest.push(child);
    }
  }

  const label = new Cursor();
  for (const child of firstContent) {
    if (child.type === "text") label.line(decodeEntities(child.text).replace(/\s+/g, " "));
    else inline(child, label);
  }
  const labelText = collapseWhitespace(label.toString()) || "•";
  const childIndent = indent + "    ";

  if (rest.length === 0) {
    out.line(`${indent}${marker} ${labelText}`);
    return;
  }

  // Multi-line list item: wrap the first content on the marker line, then the rest.
  const head = new Cursor();
  head.line(`${indent}${marker} ${labelText}`);
  out.line(head.toString());
  for (const child of rest) block(child, out, childIndent);
}

function isBlockElement(el: HtmlElementNode): boolean {
  if (HEADING_LEVEL[el.tag] || BLOCK_TAGS.has(el.tag)) return true;
  return ["ul", "ol", "li", "blockquote", "pre", "table", "hr", "figure"].includes(el.tag);
}

/** Render tables as simple pipe-delimited rows. */
function renderTable(table: HtmlElementNode, out: Ctx): void {
  const rows: HtmlElementNode[][] = [];
  for (const tr of findRows(table)) rows.push(tr);
  const maxCols = Math.max(...rows.map((r) => r.length), 0);
  if (maxCols === 0) return;

  out.blankLine();
  rows.forEach((cells, index) => {
    if (index > 0) out.line("\n");
    const slots = cells.map((c) => escapeTableCell(collapseWhitespace(inlineText(c))));
    while (slots.length < maxCols) slots.push("");
    out.line(`| ${slots.join(" | ")} |`);
    if (index === 0) {
      out.line(`| ${Array(maxCols).fill("---").join(" | ")} |`);
    }
  });
  out.blankLine();
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function findRows(table: HtmlElementNode): HtmlElementNode[][] {
  const rows: HtmlElementNode[][] = [];
  const visit = (node: HtmlNode) => {
    if (node.type === "element") {
      if (node.tag === "tr") {
        rows.push(node.children.filter((c): c is HtmlElementNode => c.type === "element" && (c.tag === "td" || c.tag === "th")));
      } else {
        for (const child of node.children) visit(child);
      }
    } else {
      void 0;
    }
  };
  for (const child of table.children) visit(child);
  return rows;
}

function renderTableParts(el: HtmlElementNode, out: Ctx, indent = ""): void {
  // Table fragments encountered outside a wrapping <table> (rare). Render rows.
  if (el.tag === "table") {
    renderTable(el, out);
    return;
  }
  if (el.tag === "tr") {
    const cells = el.children.filter((c): c is HtmlElementNode => c.type === "element");
    out.line(indent + `| ${cells.map((c) => collapseWhitespace(inlineText(c))).join(" | ")} |`);
    return;
  }
  for (const child of el.children) block(child, out, indent);
}

/** A simple line cursor used as the render output sink. */
class Cursor implements Ctx {
  private parts: string[] = [];

  toString(): string {
    return this.parts.join("").replace(/[ \t]+\n/g, "\n");
  }

  line(text: string): void {
    this.parts.push(text);
  }

  blankLine(): void {
    // Normalize runs of blank lines to at most one empty line.
    const joined = this.parts.join("");
    if (joined.endsWith("\n\n")) return;
    if (joined.endsWith("\n")) this.parts.push("\n");
    else if (this.parts.length > 0) this.parts.push("\n\n");
  }

  content(): string {
    return this.toString();
  }
}

/** Convert a parsed HTML root into Markdown text. */
export function htmlToMarkdown(root: HtmlRoot): string {
  const out = new Cursor();
  for (const child of root.children) {
    if (child.type === "element" && (child.tag === "html" || child.tag === "body")) {
      for (const grand of child.children) block(grand, out);
    } else {
      block(child, out);
    }
  }
  return out.content().replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}