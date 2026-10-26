import path from "node:path";

/**
 * Resolve a user/model supplied path against the workspace root and guarantee it
 * never escapes the workspace. Accepts:
 *   - relative paths ("src/app.ts")
 *   - absolute paths already inside the workspace
 *   - "absolute looking" paths ("/workspace/project/x", "/foo") which are treated
 *     as relative to the workspace so the model can be sloppy without breaking things.
 *
 * Throws when the resolved path would escape the workspace root.
 */
export function safeResolve(workspaceRoot: string, input: string): string {
  if (!input || typeof input !== "string") {
    throw new Error("A non-empty file path is required.");
  }

  const root = path.resolve(workspaceRoot);
  const normalizedInput = input.trim();

  let target: string;
  if (
    path.isAbsolute(normalizedInput) &&
    (normalizedInput === root || normalizedInput.startsWith(root + path.sep))
  ) {
    target = path.normalize(normalizedInput);
  } else {
    // Strip any leading slashes/backslashes and treat as workspace-relative.
    const relative = normalizedInput.replace(/^[\\/]+/, "");
    target = path.resolve(root, relative);
  }

  const relCheck = path.relative(root, target);
  if (relCheck === ".." || relCheck.startsWith(".." + path.sep) || path.isAbsolute(relCheck)) {
    throw new Error(`Path "${input}" escapes the workspace root.`);
  }

  return target;
}

/** Convert an absolute workspace path into a clean workspace-relative display path. */
export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  const rel = path.relative(path.resolve(workspaceRoot), absolutePath);
  return rel === "" ? "." : rel;
}
