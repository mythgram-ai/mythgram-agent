import { readFileSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { safeResolve, toWorkspaceRelative } from "../utils/paths.js";
import { LspClient, type SpawnFunction } from "./client.js";
import { LspError, messageOf, toLspError } from "./errors.js";
import {
  LANGUAGE_SERVERS,
  commandExists,
  fileExtension,
  findProjectRoot,
} from "./languages.js";
import type {
  LspExecution,
  LspOperation,
  LspOperationInput,
  LspServerCandidate,
  LspServerDefinition,
} from "./types.js";

export interface LspManagerOptions {
  workspaceRoot: string;
  /** Override the built-in catalog (mainly for tests / embedding). */
  definitions?: readonly LspServerDefinition[];
  requestTimeoutMs?: number;
  initializeTimeoutMs?: number;
  /** Close an idle server after this many milliseconds. 0 disables idle shutdown. */
  idleTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: SpawnFunction;
  clientName?: string;
  /** Read `.mythgram/lsp.json` for workspace-specific servers (default true). */
  loadWorkspaceConfig?: boolean;
}

interface ClientEntry {
  key: string;
  client: LspClient;
  definition: LspServerDefinition;
  candidate: LspServerCandidate;
  root: string;
  pending: number;
  idleTimer?: NodeJS.Timeout;
}

interface DispatchResult {
  raw: unknown;
  character: number;
  query?: string;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_INITIALIZE_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;

/**
 * Owns the language servers for one workspace.
 *
 * Servers are keyed by `definition + project root`, started lazily on first use,
 * reused across operations, and shut down when idle. Operations on the same
 * server are serialized because document synchronization is stateful.
 */
export class LspManager {
  private readonly workspaceRoot: string;
  private readonly definitions: readonly LspServerDefinition[];
  private readonly requestTimeoutMs: number;
  private readonly initializeTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly spawnImpl?: SpawnFunction;
  private readonly clientName?: string;

  /** key -> in-flight or ready client */
  private readonly entries = new Map<string, Promise<ClientEntry>>();
  private disposed = false;

  constructor(options: LspManagerOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    const custom =
      options.definitions ??
      (options.loadWorkspaceConfig === false
        ? []
        : loadWorkspaceServerDefinitions(this.workspaceRoot));
    this.definitions =
      options.definitions !== undefined ? custom : [...custom, ...LANGUAGE_SERVERS];
    this.requestTimeoutMs = positiveInt(
      options.requestTimeoutMs ?? envInt("MYTHGRAM_LSP_REQUEST_TIMEOUT_MS"),
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
    this.initializeTimeoutMs = positiveInt(
      options.initializeTimeoutMs ?? envInt("MYTHGRAM_LSP_INITIALIZE_TIMEOUT_MS"),
      DEFAULT_INITIALIZE_TIMEOUT_MS,
    );
    this.idleTimeoutMs = nonNegativeInt(
      options.idleTimeoutMs ?? envInt("MYTHGRAM_LSP_IDLE_TIMEOUT_MS"),
      DEFAULT_IDLE_TIMEOUT_MS,
    );
    this.env = options.env;
    this.spawnImpl = options.spawnImpl;
    this.clientName = options.clientName;
  }

  /** The workspace this manager is bound to. */
  get root(): string {
    return this.workspaceRoot;
  }

  /** True after {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Run one LSP operation for `input.filePath`. Throws {@link LspError} for
   * every expected failure (missing file, no server, invalid position, timeout,
   * server crash); callers should not have to inspect raw protocol errors.
   */
  async execute(input: LspOperationInput): Promise<LspExecution> {
    if (this.disposed) {
      throw new LspError("lsp_unavailable", "The LSP manager has been shut down.");
    }
    if (input.signal?.aborted) {
      throw new LspError("lsp_aborted", "The LSP request was aborted before it started.");
    }

    const absolutePath = this.resolveFilePath(input.filePath);
    await this.ensureFile(absolutePath, input.filePath);

    const { entry, languageId } = await this.resolveClient(absolutePath);

    try {
      const dispatched = await entry.client.runExclusive(async () => {
        if (input.signal?.aborted) {
          throw new LspError("lsp_aborted", "The LSP request was aborted.");
        }
        const text = await entry.client.syncDocument(absolutePath, languageId);
        return this.dispatch(input, entry.client, absolutePath, text);
      });

      return {
        operation: input.operation,
        workspaceRoot: this.workspaceRoot,
        absolutePath,
        relativePath: toWorkspaceRelative(this.workspaceRoot, absolutePath).split(path.sep).join("/"),
        line: input.line,
        character: dispatched.character,
        query: dispatched.query,
        languageId,
        server: {
          id: entry.definition.id,
          name: entry.definition.name,
          command: entry.candidate.command,
        },
        raw: dispatched.raw,
      };
    } finally {
      this.end(entry);
    }
  }

  /** Stop every running language server and release resources. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(
      entries.map(async (promise) => {
        try {
          const entry = await promise;
          if (entry.idleTimer) clearTimeout(entry.idleTimer);
          await entry.client.dispose();
        } catch {
          // a server that never started has nothing to clean up
        }
      }),
    );
  }

  private resolveFilePath(filePath: string): string {
    try {
      return safeResolve(this.workspaceRoot, filePath);
    } catch (error) {
      throw new LspError("lsp_invalid_path", messageOf(error), { file_path: filePath });
    }
  }

  private async ensureFile(absolutePath: string, displayPath: string): Promise<void> {
    let stat: Awaited<ReturnType<typeof fsp.stat>>;
    try {
      stat = await fsp.stat(absolutePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new LspError("lsp_file_not_found", `File not found: ${displayPath}`, {
          file_path: displayPath,
        });
      }
      throw new LspError("lsp_file_unreadable", `Could not access ${displayPath}: ${messageOf(error)}`, {
        file_path: displayPath,
      });
    }
    if (!stat.isFile()) {
      throw new LspError("lsp_not_a_file", `Not a file: ${displayPath}`, { file_path: displayPath });
    }
  }

  private async resolveClient(
    absolutePath: string,
  ): Promise<{ entry: ClientEntry; languageId: string }> {
    const extension = fileExtension(absolutePath);
    const matches = this.definitions.filter((definition) =>
      Object.prototype.hasOwnProperty.call(definition.extensions, extension),
    );

    if (matches.length === 0) {
      const installed = this.definitions
        .filter((definition) =>
          definition.candidates.some((candidate) => commandExists(candidate.command)),
        )
        .map((definition) => definition.id);
      throw new LspError(
        "lsp_server_not_found",
        `No LSP server is configured for '${extension || "(no extension)"}' files. ` +
          `Define one in .mythgram/lsp.json or install a supported language server.`,
        {
          extension,
          file_path: toWorkspaceRelative(this.workspaceRoot, absolutePath),
          installed_servers: installed,
        },
      );
    }

    const directory = path.dirname(absolutePath);
    const missing: string[] = [];
    let lastError: LspError | undefined;

    for (const definition of matches) {
      const languageId = definition.extensions[extension];
      if (!languageId) continue;

      const root = await findProjectRoot(
        directory,
        definition.rootMarkers ?? [],
        this.workspaceRoot,
      );
      const key = `${definition.id}\u0000${root}`;

      const cached = this.entries.get(key);
      if (cached) {
        try {
          const entry = await cached;
          if (!entry.client.closed) {
            this.begin(entry);
            return { entry, languageId };
          }
        } catch {
          // fall through and start a fresh server
        }
        this.entries.delete(key);
      }

      for (const candidate of definition.candidates) {
        if (!commandExists(candidate.command)) {
          missing.push(candidate.command);
          continue;
        }

        const promise = this.startClient(definition, candidate, root, key);
        this.entries.set(key, promise);
        try {
          const entry = await promise;
          this.begin(entry);
          return { entry, languageId };
        } catch (error) {
          this.entries.delete(key);
          lastError = toLspError(error, "lsp_server_start_failed");
          // Try the next executable for this language.
        }
      }
    }

    if (lastError) {
      throw new LspError(
        lastError.code,
        lastError.message,
        {
          ...lastError.details,
          tried: missing,
          file_path: toWorkspaceRelative(this.workspaceRoot, absolutePath),
        },
      );
    }

    throw new LspError(
      "lsp_server_not_found",
      `No installed LSP server can handle '${extension}' files. ` +
        `Tried: ${missing.length > 0 ? missing.join(", ") : "(no candidates)"}.`,
      {
        extension,
        tried: missing,
        file_path: toWorkspaceRelative(this.workspaceRoot, absolutePath),
      },
    );
  }

  private async startClient(
    definition: LspServerDefinition,
    candidate: LspServerCandidate,
    root: string,
    key: string,
  ): Promise<ClientEntry> {
    const client = new LspClient({
      definition,
      candidate,
      root,
      workspaceRoot: this.workspaceRoot,
      requestTimeoutMs: this.requestTimeoutMs,
      initializeTimeoutMs: this.initializeTimeoutMs,
      env: this.env,
      spawnImpl: this.spawnImpl,
      clientName: this.clientName,
    });

    try {
      await client.start();
    } catch (error) {
      void client.dispose();
      throw error;
    }

    return { key, client, definition, candidate, root, pending: 0 };
  }

  private async dispatch(
    input: LspOperationInput,
    client: LspClient,
    absolutePath: string,
    text: string,
  ): Promise<DispatchResult> {
    const timeout = input.timeoutMs ?? this.requestTimeoutMs;
    const uri = pathToFileURL(absolutePath).href;
    const textDocument = { uri };

    switch (input.operation) {
      case "goToDefinition":
      case "findReferences":
      case "hover":
      case "goToImplementation":
      case "prepareCallHierarchy": {
        const { position, effectiveCharacter } = positionForText(
          text,
          input.line,
          input.character,
        );
        return {
          raw: await client.request(
            requestMethodFor(input.operation),
            requestParamsFor(input.operation, textDocument, position),
            timeout,
          ),
          character: effectiveCharacter,
        };
      }

      case "documentSymbol":
        return {
          raw: await client.request("textDocument/documentSymbol", { textDocument }, timeout),
          character: input.character,
        };

      case "workspaceSymbol": {
        let character = input.character;
        let query = input.query?.trim() ?? "";
        if (!query) {
          const resolved = positionForText(text, input.line, input.character);
          character = resolved.effectiveCharacter;
          query = wordAtPosition(text, input.line, resolved.effectiveCharacter);
        }
        if (!query) {
          throw new LspError(
            "lsp_missing_query",
            "workspaceSymbol needs a symbol name: place the cursor on a symbol or pass `query`.",
            { file_path: toWorkspaceRelative(this.workspaceRoot, absolutePath) },
          );
        }
        return {
          raw: await client.request("workspace/symbol", { query }, timeout),
          character,
          query,
        };
      }

      case "incomingCalls":
      case "outgoingCalls": {
        const { position, effectiveCharacter } = positionForText(
          text,
          input.line,
          input.character,
        );
        const prepared = await client.request(
          "textDocument/prepareCallHierarchy",
          { textDocument, position },
          timeout,
        );
        const items = Array.isArray(prepared) ? prepared : [];
        if (items.length === 0) {
          return { raw: { prepareItems: [], calls: [] }, character: effectiveCharacter };
        }

        const method =
          input.operation === "incomingCalls"
            ? "callHierarchy/incomingCalls"
            : "callHierarchy/outgoingCalls";
        const calls: unknown[] = [];
        for (const item of items) {
          const result = await client.request(method, { item }, timeout);
          if (Array.isArray(result)) calls.push(...result);
        }
        return {
          raw: { prepareItems: items, calls },
          character: effectiveCharacter,
        };
      }

      default: {
        const exhaustive: never = input.operation;
        throw new LspError(
          "lsp_unsupported_operation",
          `Unsupported LSP operation: ${String(exhaustive)}`,
        );
      }
    }
  }

  private begin(entry: ClientEntry): void {
    entry.pending += 1;
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
  }

  private end(entry: ClientEntry): void {
    entry.pending = Math.max(0, entry.pending - 1);
    if (entry.pending > 0) return;
    this.scheduleIdleShutdown(entry);
  }

  private scheduleIdleShutdown(entry: ClientEntry): void {
    if (this.disposed || this.idleTimeoutMs <= 0) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      if (entry.pending > 0 || this.disposed) return;
      this.entries.delete(entry.key);
      void entry.client.dispose();
    }, this.idleTimeoutMs);
    entry.idleTimer.unref();
  }
}

function requestMethodFor(operation: LspOperation): string {
  switch (operation) {
    case "goToDefinition":
      return "textDocument/definition";
    case "findReferences":
      return "textDocument/references";
    case "hover":
      return "textDocument/hover";
    case "goToImplementation":
      return "textDocument/implementation";
    case "prepareCallHierarchy":
      return "textDocument/prepareCallHierarchy";
    default:
      return "textDocument/definition";
  }
}

function requestParamsFor(
  operation: LspOperation,
  textDocument: { uri: string },
  position: { line: number; character: number },
): Record<string, unknown> {
  if (operation === "findReferences") {
    return { textDocument, position, context: { includeDeclaration: true } };
  }
  return { textDocument, position };
}

/** Validate a 1-based position and convert it to an LSP (0-based) position. */
export function positionForText(
  text: string,
  line: number,
  character: number,
): {
  position: { line: number; character: number };
  effectiveCharacter: number;
  lineText: string;
} {
  const lines = splitLines(text);
  if (!Number.isInteger(line) || line < 1) {
    throw new LspError("lsp_invalid_position", `Line must be a positive integer (got ${line}).`, {
      line,
    });
  }
  if (line > lines.length) {
    throw new LspError(
      "lsp_invalid_position",
      `Line ${line} is outside the file (1-${lines.length}).`,
      { line, lines: lines.length },
    );
  }

  const lineText = lines[line - 1] ?? "";
  const maxCharacter = lineText.length + 1;
  const effectiveCharacter = Math.min(Math.max(character, 1), maxCharacter);

  return {
    position: { line: line - 1, character: effectiveCharacter - 1 },
    effectiveCharacter,
    lineText,
  };
}

/** The identifier under a 1-based editor position (used for workspaceSymbol). */
export function wordAtPosition(text: string, line: number, character: number): string {
  const lines = splitLines(text);
  const lineText = lines[line - 1] ?? "";
  if (!lineText) return "";

  const isWordChar = (value: string | undefined): boolean =>
    value !== undefined && /[A-Za-z0-9_$]/.test(value);

  let index = Math.min(Math.max(character - 1, 0), lineText.length - 1);
  if (index < 0) return "";
  if (!isWordChar(lineText[index])) {
    if (index > 0 && isWordChar(lineText[index - 1])) {
      index -= 1;
    } else {
      return "";
    }
  }

  let start = index;
  let end = index + 1;
  while (start > 0 && isWordChar(lineText[start - 1])) start -= 1;
  while (end < lineText.length && isWordChar(lineText[end])) end += 1;
  return lineText.slice(start, end);
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function nonNegativeInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/* ------------------------------------------------------------------ config */

/**
 * Read optional workspace-specific server definitions from
 * `<workspace>/.mythgram/lsp.json`. Accepted shapes:
 *
 *   { "servers": [ { "id": "...", "extensions": { ".foo": "foo" },
 *                     "command": "...", "args": ["..."],
 *                     "rootMarkers": ["..."] } ] }
 *
 * or the same array at the top level. Invalid entries are ignored so a broken
 * config never takes the whole tool down.
 */
export function loadWorkspaceServerDefinitions(
  workspaceRoot: string,
): LspServerDefinition[] {
  const configPath = path.join(workspaceRoot, ".mythgram", "lsp.json");
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { servers?: unknown }).servers)
      ? ((parsed as { servers: unknown[] }).servers)
      : [];

  const definitions: LspServerDefinition[] = [];
  for (const entry of list) {
    const definition = normalizeServerDefinition(entry);
    if (definition) definitions.push(definition);
  }
  return definitions;
}

function normalizeServerDefinition(raw: unknown): LspServerDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return null;

  const extensionSource = record.extensions;
  if (!extensionSource || typeof extensionSource !== "object" || Array.isArray(extensionSource)) {
    return null;
  }
  const extensions: Record<string, string> = {};
  for (const [rawExt, rawLanguage] of Object.entries(
    extensionSource as Record<string, unknown>,
  )) {
    if (typeof rawLanguage !== "string" || !rawLanguage.trim()) continue;
    const ext = rawExt.trim().toLowerCase();
    if (!ext) continue;
    extensions[ext.startsWith(".") ? ext : `.${ext}`] = rawLanguage.trim();
  }
  if (Object.keys(extensions).length === 0) return null;

  const candidates: LspServerCandidate[] = [];
  if (Array.isArray(record.candidates)) {
    for (const item of record.candidates) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.command !== "string" || !candidate.command.trim()) continue;
      const args = Array.isArray(candidate.args)
        ? candidate.args.filter((arg): arg is string => typeof arg === "string")
        : [];
      candidates.push({ command: candidate.command.trim(), args });
    }
  }
  if (typeof record.command === "string" && record.command.trim()) {
    const args = Array.isArray(record.args)
      ? record.args.filter((arg): arg is string => typeof arg === "string")
      : [];
    candidates.push({ command: record.command.trim(), args });
  }
  if (candidates.length === 0) return null;

  const rootMarkers = Array.isArray(record.rootMarkers)
    ? record.rootMarkers.filter((marker): marker is string => typeof marker === "string")
    : undefined;

  return {
    id,
    name:
      typeof record.name === "string" && record.name.trim() ? record.name.trim() : id,
    extensions,
    candidates,
    rootMarkers,
    initializationOptions: plainObject(record.initializationOptions),
    settings: plainObject(record.settings),
  };
}

function plainObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

