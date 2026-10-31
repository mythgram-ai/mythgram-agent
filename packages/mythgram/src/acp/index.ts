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
 *   npx --yes tsx <mythgram>/src/acp/index.ts
 *
 * Only stdout carries protocol messages; diagnostics go to stderr.
 */

function main(): void {
  const baseUrl = resolveAcpBackendUrl();
  process.stderr.write(`[mythgram-acp] connecting to backend ${baseUrl}\n`);
  const server = new AcpAgentServer(new AcpBackendClient(baseUrl));
  server.start();
}

main();
