import path from "node:path";
import { MYTHGRAM_DATA_DIR_NAME, resolveDataRoot } from "../config.js";

/** The logical namespace that always maps to the fixed application data directory. */
export const MYTHGRAM_DIR = MYTHGRAM_DATA_DIR_NAME;

/**
 * True when `input` addresses the logical ".mythgram" namespace (i.e. equals ".mythgram"
 * or starts with ".mythgram/" / ".mythgram\\"), ignoring any leading slashes/backslashes.
 */
function isMythgramLogical(input: string): boolean {
  const normalized = input.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized === MYTHGRAM_DIR || normalized.startsWith(`${MYTHGRAM_DIR}/`);
}

/** Whether `target` is `root` itself or nested inside it. */
function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a user/model supplied path and guarantee it never escapes the allowed roots.
 * Accepts:
 *   - relative paths ("src/app.ts") -> resolved inside the active workspace
 *   - absolute paths already inside the active workspace
 *   - absolute paths inside the fixed ".mythgram" data directory
 *   - logical ".mythgram/..." paths -> resolved inside the fixed data directory, so the
 *     database/artifacts/skills/checkpoints stay reachable after a workspace switch
 *   - "absolute looking" paths ("/workspace/project/x", "/foo") which are treated as
 *     relative to the workspace so the model can be sloppy without breaking things.
 *
 * Throws when the resolved path would escape the allowed roots.
 */
export function safeResolve(workspaceRoot: string, input: string): string {
  if (!input || typeof input !== "string") {
    throw new Error("A non-empty file path is required.");
  }

  const root = path.resolve(workspaceRoot);
  const dataRoot = path.resolve(resolveDataRoot(workspaceRoot));
  const normalizedInput = input.trim();

  // Absolute paths that already live inside the workspace or the data dir are taken as-is.
  if (path.isAbsolute(normalizedInput)) {
    const absolute = path.normalize(normalizedInput);
    if (isInside(root, absolute) || isInside(dataRoot, absolute)) return absolute;
  }

  // Logical ".mythgram/..." paths always resolve to the fixed data directory.
  if (isMythgramLogical(normalizedInput)) {
    const rel = normalizedInput
      .replace(/^[\\/]+/, "")
      .slice(MYTHGRAM_DIR.length)
      .replace(/^[\\/]+/, "");
    const target = path.resolve(dataRoot, rel);
    if (!isInside(dataRoot, target)) {
      throw new Error(`Path "${input}" escapes the data directory.`);
    }
    return target;
  }

  // Everything else is workspace-relative (leading slashes stripped).
  const relative = normalizedInput.replace(/^[\\/]+/, "");
  const target = path.resolve(root, relative);
  if (!isInside(root, target)) {
    throw new Error(`Path "${input}" escapes the workspace root.`);
  }

  return target;
}

/**
 * True when an absolute path lives inside the active workspace OR the fixed data dir.
 * Used by tools that require an absolute path (file_read, read_image, ...) so files in
 * the fixed ".mythgram" data dir stay reachable after a workspace switch.
 */
export function isPathAllowed(workspaceRoot: string, absolutePath: string): boolean {
  const absolute = path.resolve(absolutePath);
  if (isInside(path.resolve(workspaceRoot), absolute)) return true;
  return isInside(path.resolve(resolveDataRoot(workspaceRoot)), absolute);
}

/**
 * Convert an absolute path into a clean, logical display path:
 *   - paths inside the fixed data dir become ".mythgram/<rel>"
 *   - everything else becomes workspace-relative
 */
export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  const dataRoot = path.resolve(resolveDataRoot(workspaceRoot));
  const absolute = path.resolve(absolutePath);
  if (isInside(dataRoot, absolute)) {
    const rel = path.relative(dataRoot, absolute);
    return rel === "" ? MYTHGRAM_DIR : `${MYTHGRAM_DIR}/${rel.split(path.sep).join("/")}`;
  }
  const rel = path.relative(path.resolve(workspaceRoot), absolute);
  return rel === "" ? "." : rel;
}
