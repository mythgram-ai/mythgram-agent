import type { KnowledgeFile } from "@/types";

/**
 * The knowledge base is a browser-local file-tree of durable reference material the user curates.
 * Unlike memory it has NO pre-added files and NO character limits — it starts empty and only exists
 * once the user adds files (manual creation, file/folder upload, or URL fetch). This module holds the
 * pure helpers the store and UI share for path normalization, de-duplication, and tree rendering.
 */

/** Virtual root every knowledge file lives under (used only for display). */
export const KNOWLEDGE_ROOT = "knowledge/";

/**
 * Normalize a user/agent-supplied knowledge path into a clean relative path under the knowledge root.
 * Strips a leading "knowledge/" prefix and slashes, collapses repeats, and trims. Returns "" when the
 * path is empty or otherwise unusable (the caller reports the error).
 */
export function normalizeKnowledgePath(path: string): string {
  let p = String(path ?? "").trim().replace(/\\/g, "/");
  if (!p) return "";
  p = p.replace(/^\.\//, "").replace(/^\/+/, "");
  if (/^knowledge\//i.test(p)) p = p.slice("knowledge/".length);
  p = p.replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/+$/, "");
  return p;
}

/** True when a path contains a "." or ".." traversal segment (rejected everywhere). */
export function hasUnsafeSegment(path: string): boolean {
  return path.split("/").some((seg) => seg === "." || seg === "..");
}

/**
 * Sanitize an arbitrary knowledge-file array (e.g. from persisted storage or an SSE event) into a
 * clean, de-duplicated list: invalid/traversing/empty paths are dropped and later duplicates of the
 * same path (case-insensitive) are ignored. There are no defaults to merge in. Never throws.
 */
export function sanitizeKnowledge(files: unknown): KnowledgeFile[] {
  if (!Array.isArray(files)) return [];
  const seen = new Set<string>();
  const out: KnowledgeFile[] = [];
  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    const rawPath = typeof (file as KnowledgeFile).path === "string" ? (file as KnowledgeFile).path : "";
    const path = normalizeKnowledgePath(rawPath);
    if (!path || hasUnsafeSegment(path)) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const content = typeof (file as KnowledgeFile).content === "string" ? (file as KnowledgeFile).content : "";
    out.push({ path, content });
  }
  // Keep a stable, path-sorted order so the tree/list render deterministically.
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Build a compact ASCII tree of the knowledge folder from a flat list of relative paths. */
export function buildKnowledgeTree(paths: string[]): string {
  interface Node {
    children: Map<string, Node>;
    isFile: boolean;
  }
  const root: Node = { children: new Map(), isFile: false };

  for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
    const segments = path.split("/");
    let node = root;
    segments.forEach((seg, i) => {
      let child = node.children.get(seg);
      if (!child) {
        child = { children: new Map(), isFile: false };
        node.children.set(seg, child);
      }
      if (i === segments.length - 1) child.isFile = true;
      node = child;
    });
  }

  const lines: string[] = ["knowledge/"];
  const walk = (node: Node, prefix: string): void => {
    const entries = [...node.children.entries()].sort((a, b) => {
      const aDir = a[1].children.size > 0;
      const bDir = b[1].children.size > 0;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a[0].localeCompare(b[0]);
    });
    entries.forEach(([name, child], i) => {
      const last = i === entries.length - 1;
      const isDir = child.children.size > 0;
      lines.push(`${prefix}${last ? "└── " : "├── "}${name}${isDir ? "/" : ""}`);
      if (isDir) walk(child, `${prefix}${last ? "    " : "│   "}`);
    });
  };
  walk(root, "");
  return lines.join("\n");
}

/** Best-effort mapping of a file name to a knowledge-friendly extension label for display. */
export function knowledgeFileLabel(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name;
}
