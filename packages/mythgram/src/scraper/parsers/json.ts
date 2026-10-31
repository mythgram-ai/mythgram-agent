/**
 * JSON parsing / pretty-printing helpers for the scraper. Handles both
 * top-level JSON documents and JSON-LD blocks that are often embedded in HTML
 * pages, turning them into compact, readable text the agent can consume.
 */
import { cleanText } from "./markdown.js";

/** Pretty-print an arbitrary value as JSON with a sensible depth limit. */
export function stringifyJson(value: unknown, maxChars = 200_000): string {
  let out: string;
  try {
    out = JSON.stringify(value, null, 2);
  } catch {
    out = String(value);
  }
  if (out.length <= maxChars) return out;
  return `${out.slice(0, maxChars)}\n... [truncated ${out.length - maxChars} chars]`;
}

/**
 * Return the first JSON object found in a block of script/JSON-LD text. A
 * tolerant regex finds the outermost balanced {...}. Returns null if none.
 */
export function extractJsonLd(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const candidate = raw.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/** Extract JSON-LD `<script type="application/ld+json">` blocks from memory (array). */
export function extractJsonLdBlocks(raw: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const parsed = extractJsonLd(m[1] ?? "");
    if (parsed !== null) blocks.push(parsed);
  }
  return blocks;
}

/** Flatten JSON-LD to a readable list of "key: value" lines, best-effort. */
export function jsonLdToText(value: unknown): string {
  const lines: string[] = [];
  const visit = (val: unknown, prefix: string): void => {
    if (val === null || val === undefined) return;
    if (typeof val === "string") {
      lines.push(`${prefix}${cleanText(val)}`);
      return;
    }
    if (typeof val === "number" || typeof val === "boolean") {
      lines.push(`${prefix}${String(val)}`);
      return;
    }
    if (Array.isArray(val)) {
      val.forEach((item, i) => visit(item, i === 0 ? prefix : `${prefix}  `));
      return;
    }
    if (typeof val === "object") {
      for (const [key, sub] of Object.entries(val as Record<string, unknown>)) {
        if (sub && typeof sub === "object") visit(sub, `${prefix}${key}: `);
        else lines.push(`${prefix}${key}: ${String(sub ?? "")}`);
      }
    }
  };
  visit(value, "");
  return lines.join("\n").trim();
}