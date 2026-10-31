import path from "node:path";
import { LspManager } from "./manager.js";

export {
  LSP_OPERATIONS,
  type LspCall,
  type LspExecution,
  type LspHierarchyItem,
  type LspLocation,
  type LspOperation,
  type LspOperationInput,
  type LspServerCandidate,
  type LspServerDefinition,
  type LspSymbol,
  type ResolvedLspServer,
} from "./types.js";
export { LspError, isLspError, messageOf, toLspError } from "./errors.js";
export {
  LANGUAGE_SERVERS,
  commandExists,
  fileExtension,
  findProjectRoot,
  resetCommandAvailabilityCache,
} from "./languages.js";
export { encodeMessage, MessageBuffer, type JsonRpcMessage } from "./protocol.js";
export { LspClient, type LspClientOptions, type SpawnFunction } from "./client.js";
export {
  LspManager,
  loadWorkspaceServerDefinitions,
  positionForText,
  wordAtPosition,
  type LspManagerOptions,
} from "./manager.js";
export {
  MAX_LSP_CALLS,
  MAX_LSP_LOCATIONS,
  MAX_LSP_SYMBOLS,
  displayPath,
  formatLspExecution,
  symbolKindName,
  uriToPath,
} from "./format.js";

/**
 * Process-wide cache of LSP managers, one per workspace root. Language servers
 * are long-lived, so every tool call in the same workspace reuses them.
 */
const managers = new Map<string, LspManager>();

/** Get (or lazily create) the shared LSP manager for a workspace. */
export function getLspManager(workspaceRoot: string): LspManager {
  const key = path.resolve(workspaceRoot);
  let manager = managers.get(key);
  if (!manager || manager.isDisposed) {
    manager = new LspManager({ workspaceRoot: key });
    managers.set(key, manager);
  }
  return manager;
}

/** Shut down every cached manager. Intended for graceful application shutdown. */
export async function shutdownLspManagers(): Promise<void> {
  const current = [...managers.values()];
  managers.clear();
  await Promise.allSettled(current.map((manager) => manager.dispose()));
}