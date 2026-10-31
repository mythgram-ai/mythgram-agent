/**
 * Shared types for the Language Server Protocol (LSP) integration.
 *
 * The agent talks to real language servers through their stdio JSON-RPC
 * interface. Only the subset of the protocol the `lsp` tool needs is modelled
 * here; servers may return richer objects and the formatter tolerates extra
 * fields.
 */

/** The nine code-intelligence operations exposed by the `lsp` tool. */
export const LSP_OPERATIONS = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const;

export type LspOperation = (typeof LSP_OPERATIONS)[number];

/** One executable that can serve a language (e.g. `gopls`, or `npx -y ...`). */
export interface LspServerCandidate {
  command: string;
  args: readonly string[];
}

/**
 * A language server description. `extensions` maps a lower-case file extension
 * (including the dot) to the LSP `languageId` sent on `textDocument/didOpen`.
 */
export interface LspServerDefinition {
  /** Stable id used for caching a server instance (e.g. "typescript"). */
  id: string;
  /** Human friendly name shown in tool results and the UI. */
  name: string;
  /** Extension -> LSP language identifier. */
  extensions: Readonly<Record<string, string>>;
  /** Candidate executables, tried in order until one is installed and starts. */
  candidates: readonly LspServerCandidate[];
  /** Files/directories that mark a project root; walk up until one is found. */
  rootMarkers?: readonly string[];
  /** Passed verbatim as `initializationOptions` in the `initialize` request. */
  initializationOptions?: Record<string, unknown>;
  /** Returned for `workspace/configuration` requests from the server. */
  settings?: Record<string, unknown>;
}

/** A definition + candidate chosen for a concrete file. */
export interface ResolvedLspServer {
  definition: LspServerDefinition;
  candidate: LspServerCandidate;
  languageId: string;
  root: string;
}

/** Input to a single LSP operation (positions are 1-based, editor style). */
export interface LspOperationInput {
  operation: LspOperation;
  filePath: string;
  line: number;
  character: number;
  /** Optional symbol query for `workspaceSymbol`; derived from the position otherwise. */
  query?: string;
  workspaceRoot: string;
  signal?: AbortSignal;
  /** Per-request timeout override (milliseconds). */
  timeoutMs?: number;
}

/** Raw execution envelope handed to the formatter. */
export interface LspExecution {
  operation: LspOperation;
  workspaceRoot: string;
  /** Absolute path of the file the operation ran on. */
  absolutePath: string;
  /** Workspace-relative display path (POSIX separators). */
  relativePath: string;
  /** 1-based line from the tool arguments. */
  line: number;
  /** 1-based (possibly clamped) character from the tool arguments. */
  character: number;
  query?: string;
  languageId: string;
  server: { id: string; name: string; command: string };
  /** Operation-specific raw LSP result. */
  raw: unknown;
}

/** A normalized source location returned to the model and the UI. */
export interface LspLocation {
  path: string;
  line: number;
  character: number;
  end_line: number;
  end_character: number;
  preview?: string;
}

/** A normalized symbol (document or workspace symbol). */
export interface LspSymbol {
  name: string;
  kind: string;
  detail?: string;
  path?: string;
  line: number;
  character: number;
  depth?: number;
}

/** A normalized call-hierarchy item. */
export interface LspHierarchyItem {
  name: string;
  kind: string;
  detail?: string;
  path: string;
  line: number;
  character: number;
}

/** A normalized incoming/outgoing call edge. */
export interface LspCall extends LspHierarchyItem {
  direction: "incoming" | "outgoing";
}