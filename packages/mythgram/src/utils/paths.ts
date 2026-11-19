import path from "node:path";
import { MYTHGRAM_DATA_DIR_NAME } from "../config.js";

/** The logical namespace that always maps to the fixed application data directory. */
export const MYTHGRAM_DIR = MYTHGRAM_DATA_DIR_NAME;

/** Whether `target` is `root` itself or nested inside it. */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a model-supplied filesystem path.
 *
 * The workspace root is contextual metadata for the LLM, NOT a filesystem boundary: any absolute
 * path the operating system allows is accepted. Relative paths are rejected so a tool never
 * silently anchors a bare path to the workspace root.
 */
export function resolveAbsolutePath(input: string): string {
  if (!input || typeof input !== "string") {
    throw new Error("A non-empty absolute file path is required.");
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("A non-empty absolute file path is required.");
  }
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`An absolute path is required. Received: "${input}".`);
  }
  return path.normalize(trimmed);
}

/**
 * Backwards-compatible path resolver used throughout the codebase.
 *
 * `workspaceRoot` is intentionally ignored for access-control purposes; it is only kept in the
 * signature so callers do not need to change and so the workspace remains available as context.
 * All model/tool supplied paths must be absolute (see {@link resolveAbsolutePath}).
 */
export function safeResolve(_workspaceRoot: string, input: string): string {
  return resolveAbsolutePath(input);
}

/**
 * Resolve a path for internal/UI callers that historically supplied workspace-relative paths
 * (for example the file explorer and canvas events). This is NOT used by agent filesystem tools:
 * those use {@link safeResolve} and require absolute paths. Relative input is resolved against the
 * workspace, but the result is still allowed to point anywhere on disk.
 */
export function resolveWorkspacePath(workspaceRoot: string, input: string): string {
  if (!input || typeof input !== "string") {
    throw new Error("A non-empty file path is required.");
  }
  const trimmed = input.trim();
  if (!trimmed) throw new Error("A non-empty file path is required.");
  return path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.resolve(workspaceRoot, trimmed);
}

/**
 * True when an absolute path is valid for filesystem tools. The workspace root and the fixed data
 * directory are no longer special: every absolute path is allowed, subject to OS permissions.
 */
export function isPathAllowed(_workspaceRoot: string, absolutePath: string): boolean {
  return typeof absolutePath === "string" && path.isAbsolute(absolutePath.trim());
}

/**
 * Render a path for tool output.
 *
 * Paths inside the workspace are shown workspace-relative (e.g. "src/app.ts") to keep results
 * compact. Paths outside the workspace are shown as absolute paths so the model can pass them
 * straight back into another tool without guessing or resolving "..".
 */
export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  const absolute = path.resolve(absolutePath);
  const root = path.resolve(workspaceRoot);
  const rel = path.relative(root, absolute);
  if (rel === "") return ".";
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return absolute;
  }
  return rel;
}