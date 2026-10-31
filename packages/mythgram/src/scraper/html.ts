/**
 * A small, dependency-free HTML tokenizer that builds a light DOM tree. It is
 * deliberately tolerant of messy, real-world HTML (missing end tags, stray
 * angle brackets, uppercase tags, comments, and embedded scripts/styles), which
 * is exactly what web scraping has to cope with. It is not a full HTML5 spec
 * implementation -- it is designed to be good enough to render readable
 * Markdown and to extract links / images / metadata reliably.
 */

/** A text node. */
export interface HtmlTextNode {
  type: "text";
  text: string;
}

/** An element node carrying its (lowercased) tag and normalized attributes. */
export interface HtmlElementNode {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

/** The compiled root produced by parseHtml. */
export interface HtmlRoot {
  type: "element";
  tag: "#root";
  attrs: Record<string, string>;
  children: HtmlNode[];
}

export type HtmlNode = HtmlTextNode | HtmlElementNode | HtmlRoot;

/** Void elements never have a matching close tag or content. */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Raw-text elements whose inner content must never be treated as markup. */
const RAW_TEXT_TAGS = new Set(["script", "style", "template", "noscript", "iframe"]);

/** Literal text elements whose inner HTML is preserved verbatim. */
const LITERAL_TEXT_TAGS = new Set(["textarea", "title"]);

/**
 * Parse a raw HTML string into a tree of HtmlNode. Throws only on programmer
 * error; malformed input is tolerated and never crashes the caller.
 */
export function parseHtml(html: string): HtmlRoot {
  const root: HtmlRoot = { type: "element", tag: "#root", attrs: {}, children: [] };
  const stack: Array<HtmlElementNode | HtmlRoot> = [root];
  const len = html.length;
  let i = 0;

  const parent = (): HtmlElementNode | HtmlRoot => stack[stack.length - 1];
  const parentTag = (): string => parent().tag;

  const appendText = (text: string) => {
    if (!text) return;
    const par = parent();
    const last = par.children[par.children.length - 1];
    if (last && last.type === "text") last.text += text;
    else par.children.push({ type: "text", text });
  };

  const closeTo = (tag: string) => {
    // Pop the stack until we match `tag` (handles malformed nesting).
    for (let k = stack.length - 1; k > 0; k--) {
      if (stack[k].tag === tag) {
        stack.length = k; // pop the matching element too
        return;
      }
    }
  };

  const findClose = (tag: string, from: number): number =>
    html.toLowerCase().indexOf(`</${tag}>`, from);

  while (i < len) {
    const top = parentTag();

    // Skip script/style/iframe/... content wholesale.
    if (RAW_TEXT_TAGS.has(top)) {
      const close = findClose(top, i);
      if (close === -1) {
        i = len;
        break;
      }
      i = close + top.length + 3; // consume `</top>`
      stack.pop();
      continue;
    }

    // Preserve pre/textarea/title content literally.
    if (LITERAL_TEXT_TAGS.has(top)) {
      const close = findClose(top, i);
      if (close === -1) {
        if (i < len) appendText(html.slice(i));
        break;
      }
      if (close > i) appendText(html.slice(i, close));
      i = close + top.length + 3; // consume `</top>`
      stack.pop();
      continue;
    }

    const lt = html.indexOf("<", i);
    if (lt === -1) {
      appendText(html.slice(i));
      break;
    }
    if (lt > i) appendText(html.slice(i, lt));

    // Comment.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }

    // CDATA / processing instructions / doctype.
    if (/^<!\[CDATA\[/i.test(html.slice(lt))) {
      const end = html.indexOf("]]>", lt + 9);
      i = end === -1 ? len : end + 3;
      continue;
    }

    const gt = html.indexOf(">", lt);
    if (gt === -1) {
      appendText(html.slice(lt));
      break;
    }

    // Closing tag.
    if (html[lt + 1] === "/") {
      const tagName = html
        .slice(lt + 2, gt)
        .trim()
        .toLowerCase()
        .replace(/[\/\s].*$/, "");
      if (tagName) closeTo(tagName);
      i = gt + 1;
      continue;
    }

    let rawTag = html.slice(lt + 1, gt);

    // Doctype / processing instructions.
    if (/^!doctype/i.test(rawTag) || rawTag.startsWith("?") || rawTag.trim().startsWith("!")) {
      i = gt + 1;
      continue;
    }

    const selfClose = /\/\s*$/.test(rawTag);
    rawTag = rawTag.replace(/\/\s*$/, "");

    const tagMatch = rawTag.match(/^\s*([a-zA-Z][a-zA-Z0-9-]*)/);
    i = gt + 1;
    if (!tagMatch) {
      // A bare "<" that isn't a real tag -- treat as literal text.
      appendText(`<${rawTag}>`);
      continue;
    }

    const tag = tagMatch[1].toLowerCase();
    const attrs = parseAttrs(rawTag.slice(rawTag.indexOf(tag) + tag.length));
    const el: HtmlElementNode = { type: "element", tag, attrs, children: [] };
    parent().children.push(el);
    if (!VOID_TAGS.has(tag) && !selfClose) stack.push(el);
  }

  return root;
}

/** Parse an attribute string (e.g. `href="x" class='y' disabled data-z=1`) into a map. */
export function parseAttrs(str: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][a-zA-Z0-9:._-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) {
    const key = m[1].toLowerCase();
    attrs[key] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/** Depth-first walk over the tree, yielding every node. */
export function walk(root: HtmlRoot | HtmlElementNode, visit: (node: HtmlNode) => void): void {
  for (const child of root.children) {
    visit(child);
    if (child.type === "element") walk(child, visit);
  }
}

/** Collect the inline text under a node (concatenating text nodes, no separators). */
export function textContent(node: HtmlNode): string {
  if (node.type === "text") return node.text;
  return node.children.map(textContent).join("");
}

/** Find the first descendant matching (tag, optional attribute predicate). */
export function findFirst(
  root: HtmlRoot | HtmlElementNode,
  predicate: (el: HtmlElementNode) => boolean,
): HtmlElementNode | undefined {
  for (const child of root.children) {
    if (child.type === "element") {
      if (predicate(child)) return child;
      const nested = findFirst(child, predicate);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** Collect every element matching `tag` (optionally with a matching attribute). */
export function findAll(
  root: HtmlRoot | HtmlElementNode,
  tag: string,
  attrPredicate?: (attrs: Record<string, string>) => boolean,
): HtmlElementNode[] {
  const out: HtmlElementNode[] = [];
  const visit = (node: HtmlNode) => {
    if (node.type === "element") {
      if (node.tag === tag && (!attrPredicate || attrPredicate(node.attrs))) out.push(node);
    }
  };
  walk(root, visit);
  return out;
}

/** Read the first attribute value that matches any of the given keys, or "". */
export function attr(node: HtmlElementNode, ...keys: string[]): string {
  for (const key of keys) {
    const v = node.attrs[key];
    if (v) return v;
  }
  return "";
}