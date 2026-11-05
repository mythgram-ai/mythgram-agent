import fs from "node:fs/promises";
import path from "node:path";
import { JsonRpcError } from "./jsonrpc.js";
import { ACP_ERRORS } from "./types.js";

/**
 * Client-side filesystem implementation for ACP `fs/read_text_file` and
 * `fs/write_text_file`.
 *
 * Security: ACP explicitly makes the client responsible for checking paths. We
 * only allow absolute paths inside the session's root set (the configured
 * workspace and the session cwd). Everything else is rejected with a JSON-RPC
 * invalid-params error instead of silently reading/writing arbitrary files.
 */
export class AcpFileSystem {
  constructor(private readonly workspaceRoot: string) {}

  private normalizeRoots(roots: string[]): string[] {
    const out = new Set<string>();
    for (const root of [this.workspaceRoot, ...roots]) {
      if (!root) continue;
      out.add(path.resolve(root));
    }
    return [...out];
  }

  private isInside(child: string, parent: string): boolean {
    const relative = path.relative(parent, child);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  /** Resolve and validate an absolute path against the session's allowed roots. */
  assertAllowed(filePath: string, roots: string[]): string {
    if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
      throw new JsonRpcError(ACP_ERRORS.invalidParams, "ACP file paths must be absolute.");
    }
    const resolved = path.resolve(filePath);
    const allowed = this.normalizeRoots(roots);
    if (!allowed.some((root) => this.isInside(resolved, root))) {
      throw new JsonRpcError(
        ACP_ERRORS.invalidParams,
        `Access denied: "${resolved}" is outside the session's workspace roots.`,
        { path: resolved, roots: allowed },
      );
    }
    return resolved;
  }

  async readTextFile(params: {
    path?: unknown;
    line?: unknown;
    limit?: unknown;
  }, roots: string[]): Promise<{ content: string }> {
    const resolved = this.assertAllowed(typeof params.path === "string" ? params.path : "", roots);
    let content: string;
    try {
      content = await fs.readFile(resolved, "utf8");
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw new JsonRpcError(
        code === "ENOENT" ? ACP_ERRORS.resourceNotFound : ACP_ERRORS.internalError,
        code === "ENOENT" ? `File not found: ${resolved}` : `Could not read ${resolved}.`,
        { path: resolved },
      );
    }

    const line = typeof params.line === "number" && Number.isFinite(params.line) ? Math.max(1, Math.floor(params.line)) : 1;
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(0, Math.floor(params.limit))
        : null;

    if (line === 1 && (limit === null || limit === 0)) return { content };
    const lines = content.split("\n");
    const start = line - 1;
    if (start >= lines.length) return { content: "" };
    const end = limit === null || limit === 0 ? lines.length : start + limit;
    return { content: lines.slice(start, end).join("\n") };
  }

  async writeTextFile(params: {
    path?: unknown;
    content?: unknown;
  }, roots: string[]): Promise<Record<string, never>> {
    const resolved = this.assertAllowed(typeof params.path === "string" ? params.path : "", roots);
    if (typeof params.content !== "string") {
      throw new JsonRpcError(ACP_ERRORS.invalidParams, "fs/write_text_file requires string content.");
    }
    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, params.content, "utf8");
    } catch (error) {
      throw new JsonRpcError(
        ACP_ERRORS.internalError,
        `Could not write ${resolved}: ${error instanceof Error ? error.message : String(error)}`,
        { path: resolved },
      );
    }
    return {};
  }
}