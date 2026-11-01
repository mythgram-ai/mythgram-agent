import path from "node:path";
import { pathToFileURL } from "node:url";
import { AcpBackendClient } from "./client.js";
import { resolveAcpBackendUrl } from "./endpoint.js";
import { AcpAgentServer } from "./server.js";

/**
 * ACP stdio entrypoint.
 *
 * This is the process an ACP client (e.g. Zed) launches as its `command`. It
 * speaks ACP over stdin/stdout and drives the running Mythgram backend over HTTP,
 * so every configured runtime — Default Agent, Custom Agents, agent teams, CEO
 * systems, both context-management methods, the memory agent, TTS and workspace —
 * is used exactly as configured in the app.
 *
 * Launch it with:
 *   npx --yes mythgram acp
 * or simply `npx --yes mythgram` when stdin is a pipe (which is how editors spawn it).
 *
 * Only stdout carries protocol messages; diagnostics go to stderr.
 */

export function runAcp(): void {
  const baseUrl = resolveAcpBackendUrl();
  process.stderr.write(`[mythgram-acp] connecting to backend ${baseUrl}\n`);
  const server = new AcpAgentServer(new AcpBackendClient(baseUrl));
  server.start();
}

/** True when this module is the process entrypoint (direct `node dist/acp/index.js`). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) runAcp();
