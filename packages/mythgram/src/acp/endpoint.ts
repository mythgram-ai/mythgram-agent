import fs from "node:fs";
import path from "node:path";
import { config, resolveDataRootOverride } from "../config.js";

/**
 * Tiny discovery file that lets the standalone ACP stdio bridge find the running
 * Mythgram backend without any environment variable or CLI argument.
 *
 * On boot the backend writes `<workspace>/.mythgram/.acp-endpoint.json` with the URL it is
 * listening on. The bridge (launched by the editor via `npx`) imports this module and reads
 * the same file — so ACP connections keep working even when the backend runs on a non-default
 * port, with no base URL passed as an argument.
 *
 * The path is derived from the workspace (cwd / WORKSPACE_ROOT / MYTHGRAM_DATA_DIR) rather
 * than the package install location, so the discovery file lives in the same ".mythgram"
 * folder the backend creates where the user ran `mythgram`, and the two processes always
 * agree on it.
 */

/** Absolute path of the discovery file (<workspace>/.mythgram/.acp-endpoint.json). */
export const ACP_ENDPOINT_FILE = path.join(
  resolveDataRootOverride(config.workspaceRoot),
  ".acp-endpoint.json",
);

/** Default backend URL when the discovery file is unavailable. */
export const DEFAULT_ACP_BACKEND_URL = "http://127.0.0.1:8787";

export interface AcpEndpoint {
  url: string;
  port: number;
  updatedAt: number;
}

/** Persist the backend's listening URL for ACP bridge discovery (best effort). */
export function writeAcpEndpoint(port: number): void {
  try {
    const payload: AcpEndpoint = {
      url: `http://127.0.0.1:${port}`,
      port,
      updatedAt: Date.now(),
    };
    // The ".mythgram" folder may not exist yet the first time (e.g. a fresh checkout).
    fs.mkdirSync(path.dirname(ACP_ENDPOINT_FILE), { recursive: true });
    fs.writeFileSync(ACP_ENDPOINT_FILE, JSON.stringify(payload));
  } catch {
    // Discovery is a convenience; a failure must never affect startup.
  }
}

/** Read the discovery file, or null when missing/corrupt. */
export function readAcpEndpoint(): AcpEndpoint | null {
  try {
    const raw = fs.readFileSync(ACP_ENDPOINT_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AcpEndpoint>;
    if (typeof parsed.url === "string" && parsed.url.startsWith("http")) {
      return {
        url: parsed.url.replace(/\/+$/, ""),
        port: typeof parsed.port === "number" ? parsed.port : 0,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the backend URL for the bridge: discovery file → optional MYTHGRAM_API_URL
 * fallback → the default local port.
 */
export function resolveAcpBackendUrl(): string {
  const endpoint = readAcpEndpoint();
  if (endpoint?.url) return endpoint.url;
  const envUrl = process.env.MYTHGRAM_API_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  return DEFAULT_ACP_BACKEND_URL;
}
