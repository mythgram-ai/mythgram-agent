import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "./registry.js";
import { createToolRegistry } from "./index.js";
import { lspTool, LSP_OPERATIONS } from "./lsp.js";
import { SUB_AGENT_RESTRICTED_TOOLS } from "./subAgentRestrictedTools.js";
import { allowedCeoAgentTools, allowedTeamAgentTools } from "./teamTools.js";
import { CUSTOM_AGENT_EXCLUDED_TOOLS } from "../customagent/configuration.js";
import type { ToolContext, ToolResult } from "./types.js";
import { LspClient } from "../../lsp/client.js";
import { LspError } from "../../lsp/errors.js";
import { symbolKindName, uriToPath } from "../../lsp/format.js";
import {
  commandExists,
  fileExtension,
  findProjectRoot,
} from "../../lsp/languages.js";
import {
  LspManager,
  loadWorkspaceServerDefinitions,
  positionForText,
  wordAtPosition,
} from "../../lsp/manager.js";
import { MessageBuffer, encodeMessage } from "../../lsp/protocol.js";
import { shutdownLspManagers } from "../../lsp/index.js";
import type { LspServerDefinition } from "../../lsp/types.js";

/* ------------------------------------------------------------------ helpers */

const FAKE_SERVER_SOURCE = `
const bufferState = { buffer: Buffer.alloc(0) };
const documents = new Map();
let lastUri = "";
let configTimer;

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(
    "Content-Length: " + Buffer.byteLength(body, "utf8") + "\\r\\n\\r\\n" + body,
  );
}
function respond(id, result) {
  send({ jsonrpc: "2.0", id: id, result: result });
}
function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id: id, error: { code: code, message: message } });
}
function item(name, kind, line) {
  const range = {
    start: { line: line, character: 0 },
    end: { line: line, character: 5 },
  };
  return { name: name, kind: kind, uri: lastUri, range: range, selectionRange: range };
}

function handle(message) {
  const id = message.id;
  const method = message.method;
  const params = message.params || {};

  if (method === "initialize") {
    respond(id, {
      capabilities: {
        definitionProvider: true,
        referencesProvider: true,
        hoverProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        implementationProvider: true,
        callHierarchyProvider: true,
      },
    });
    return;
  }

  if (method === "initialized") {
    // Ask the client for configuration. The client must answer or the test server exits.
    send({
      jsonrpc: "2.0",
      id: 9001,
      method: "workspace/configuration",
      params: { items: [{ section: "fake" }] },
    });
    configTimer = setTimeout(function () {
      process.stderr.write("client did not answer workspace/configuration\\n");
      process.exit(3);
    }, 1500);
    return;
  }

  if (method === "workspace/configuration" && id === 9001) {
    clearTimeout(configTimer);
    respond(id, [null]);
    return;
  }

  if (method === "textDocument/didOpen") {
    lastUri = params.textDocument.uri;
    documents.set(lastUri, params.textDocument.text);
    return;
  }

  if (method === "textDocument/didChange") {
    const changes = params.contentChanges || [];
    if (changes.length > 0 && typeof changes[0].text === "string") {
      documents.set(params.textDocument.uri, changes[0].text);
    }
    return;
  }

  if (method === "textDocument/definition") {
    respond(id, [
      {
        uri: params.textDocument.uri,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
      },
    ]);
    return;
  }

  if (method === "textDocument/references") {
    respond(id, [
      {
        uri: params.textDocument.uri,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
      },
      {
        uri: params.textDocument.uri,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 7 },
        },
      },
    ]);
    return;
  }

  if (method === "textDocument/hover") {
    const text = documents.get(params.textDocument.uri) || "";
    const lines = text.split(/\\r\\n|\\r|\\n/);
    respond(id, {
      contents: { kind: "markdown", value: "**hover** " + (lines[params.position.line] || "") },
      range: { start: params.position, end: params.position },
    });
    return;
  }

  if (method === "textDocument/documentSymbol") {
    respond(id, [
      {
        name: "outer",
        kind: 12,
        detail: "function",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 2, character: 0 },
        },
        selectionRange: {
          start: { line: 0, character: 9 },
          end: { line: 0, character: 14 },
        },
        children: [
          {
            name: "inner",
            kind: 13,
            range: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 7 },
            },
            selectionRange: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 7 },
            },
          },
        ],
      },
    ]);
    return;
  }

  if (method === "workspace/symbol") {
    if (!params.query || typeof params.query !== "string") {
      respondError(id, -32602, "query is required");
      return;
    }
    respond(id, [
      {
        name: params.query,
        kind: 12,
        location: {
          uri: lastUri,
          range: {
            start: { line: 2, character: 6 },
            end: { line: 2, character: 11 },
          },
        },
      },
    ]);
    return;
  }

  if (method === "textDocument/implementation") {
    respond(id, [
      {
        uri: params.textDocument.uri,
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 5 },
        },
      },
    ]);
    return;
  }

  if (method === "textDocument/prepareCallHierarchy") {
    respond(id, [item("target", 12, 0)]);
    return;
  }

  if (method === "callHierarchy/incomingCalls") {
    respond(id, [{ from: item("caller", 12, 1), fromRanges: [] }]);
    return;
  }

  if (method === "callHierarchy/outgoingCalls") {
    respond(id, [{ to: item("callee", 12, 2), fromRanges: [] }]);
    return;
  }

  if (method === "shutdown") {
    respond(id, null);
    return;
  }

  if (method === "exit") {
    setTimeout(function () {
      process.exit(0);
    }, 10);
    return;
  }

  // Deliberately never answer, used to verify request timeouts.
  if (method === "fake/never") return;

  if (id !== undefined) {
    respondError(id, -32601, "Method not found: " + method);
  }
}

process.stdin.on("data", function (chunk) {
  bufferState.buffer = Buffer.concat([bufferState.buffer, chunk]);
  while (true) {
    const headerEnd = bufferState.buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd === -1) break;
    const header = bufferState.buffer.subarray(0, headerEnd).toString("ascii");
    const match = /content-length:\\s*(\\d+)/i.exec(header);
    if (!match) {
      bufferState.buffer = bufferState.buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number.parseInt(match[1], 10);
    const start = headerEnd + 4;
    if (bufferState.buffer.length < start + length) break;
    const body = bufferState.buffer.subarray(start, start + length).toString("utf8");
    bufferState.buffer = bufferState.buffer.subarray(start + length);
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      continue;
    }
    handle(message);
  }
});
`;

function dataOf(result: ToolResult): Record<string, any> {
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.data as Record<string, any>;
}

function errorCodeOf(result: ToolResult): string | undefined {
  assert.equal(result.ok, false, "expected the tool call to fail");
  return (result.error as { code?: string } | undefined)?.code;
}

async function writeFakeWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-lsp-"));
  const serverPath = path.join(workspace, "fake-lsp.cjs");
  await fs.writeFile(serverPath, FAKE_SERVER_SOURCE, "utf8");
  await fs.mkdir(path.join(workspace, ".mythgram"), { recursive: true });
  const config = {
    servers: [
      {
        id: "fake",
        name: "Fake LSP",
        extensions: { ".fake": "fake" },
        command: process.execPath,
        args: [serverPath],
        rootMarkers: [],
      },
    ],
  };
  await fs.writeFile(
    path.join(workspace, ".mythgram", "lsp.json"),
    JSON.stringify(config),
    "utf8",
  );
  return workspace;
}

/* ------------------------------------------------------------------ registration */

describe("lsp tool registration", () => {
  it("is registered and exposed to the LLM as a native function tool", () => {
    const registry = createToolRegistry();
    assert.equal(registry.has("lsp"), true);
    const schema = registry.schemas.find((entry) => entry.function.name === "lsp");
    assert.ok(schema);
    assert.match(schema.function.description, /goToDefinition/);
    const parameters = schema.function.parameters as Record<string, any>;
    assert.deepEqual(parameters.required, ["operation", "filePath", "line", "character"]);
    const operation = (parameters.properties as Record<string, any>).operation;
    assert.deepEqual(operation.enum, [...LSP_OPERATIONS]);
    assert.equal(parameters.additionalProperties, false);
  });

  it("is restricted from sub-agents", () => {
    assert.ok(SUB_AGENT_RESTRICTED_TOOLS.includes("lsp"));
  });

  it("is available to custom agents, team members/leaders, and CEO agents", () => {
    const names = createToolRegistry().names();
    assert.ok(!CUSTOM_AGENT_EXCLUDED_TOOLS.includes("lsp"));
    for (const role of ["leader", "member"] as const) {
      assert.ok(allowedTeamAgentTools(names, role, false).includes("lsp"));
      assert.ok(allowedCeoAgentTools(names, role, false).includes("lsp"));
    }
    assert.ok(allowedCeoAgentTools(names, "ceo", false).includes("lsp"));
  });

  it("produces a readable UI label", () => {
    const label = lspTool.label({
      operation: "goToDefinition",
      filePath: "src/app.ts",
      line: 12,
      character: 5,
    });
    assert.equal(label, "LSP goToDefinition: src/app.ts:12:5");
  });
});

/* ------------------------------------------------------------------ primitives */

describe("lsp primitives", () => {
  it("exposes exactly the nine documented operations", () => {
    assert.deepEqual([...LSP_OPERATIONS], [
      "goToDefinition",
      "findReferences",
      "hover",
      "documentSymbol",
      "workspaceSymbol",
      "goToImplementation",
      "prepareCallHierarchy",
      "incomingCalls",
      "outgoingCalls",
    ]);
  });

  it("parses fragmented and back-to-back LSP frames", () => {
    const first = encodeMessage({ jsonrpc: "2.0", id: 1, result: "one" });
    const second = encodeMessage({ jsonrpc: "2.0", method: "note", params: { a: 1 } });
    const reader = new MessageBuffer();

    assert.deepEqual(reader.push(first.subarray(0, 7)), []);
    const parsed = reader.push(Buffer.concat([first.subarray(7), second]));
    assert.deepEqual(parsed, [
      { jsonrpc: "2.0", id: 1, result: "one" },
      { jsonrpc: "2.0", method: "note", params: { a: 1 } },
    ]);
    assert.equal(reader.pendingBytes, 0);
  });

  it("rejects malformed frames", () => {
    const reader = new MessageBuffer();
    assert.throws(
      () => reader.push(Buffer.from("Content-Length: nope\r\n\r\n{}", "ascii")),
      /Content-Length/,
    );
  });

  it("converts 1-based editor positions and clamps characters", () => {
    const text = ["alpha beta", "  gamma delta", "const value = 1;"].join("\n");
    const position = positionForText(text, 2, 4);
    assert.equal(position.position.line, 1);
    assert.equal(position.position.character, 3);
    assert.equal(position.effectiveCharacter, 4);

    const clamped = positionForText(text, 1, 999);
    assert.equal(clamped.position.character, "alpha beta".length);
    assert.equal(clamped.effectiveCharacter, "alpha beta".length + 1);

    assert.throws(() => positionForText(text, 99, 1), /outside the file/);
    assert.throws(() => positionForText(text, 0, 1), /positive integer/);
  });

  it("extracts the identifier under the cursor", () => {
    const text = ["alpha beta", "  gamma delta", "const value = 1;"].join("\n");
    assert.equal(wordAtPosition(text, 1, 1), "alpha");
    assert.equal(wordAtPosition(text, 1, 7), "beta");
    assert.equal(wordAtPosition(text, 2, 4), "gamma");
    assert.equal(wordAtPosition(text, 3, 8), "value");
    assert.equal(wordAtPosition(text, 2, 1), "");
  });

  it("maps file extensions, symbol kinds, and URIs", () => {
    assert.equal(fileExtension("src/App.TSX"), ".tsx");
    assert.equal(fileExtension("Makefile"), "");
    assert.equal(symbolKindName(12), "Function");
    assert.equal(symbolKindName(13), "Variable");
    assert.equal(symbolKindName("Custom"), "Custom");
    assert.equal(uriToPath("https://example.com/a.ts"), null);
    const parsed = uriToPath("file:///tmp/a%20b.ts");
    assert.ok(parsed === "/tmp/a b.ts" || parsed?.endsWith("a b.ts"));
  });

  it("detects installed commands and project roots", async () => {
    assert.equal(commandExists(process.execPath), true);
    assert.equal(commandExists("definitely-not-a-real-command-xyz"), false);

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-lsp-root-"));
    try {
      await fs.mkdir(path.join(workspace, "pkg", "src"), { recursive: true });
      await fs.writeFile(path.join(workspace, "pkg", "package.json"), "{}", "utf8");
      const root = await findProjectRoot(
        path.join(workspace, "pkg", "src"),
        ["package.json"],
        workspace,
      );
      assert.equal(root, path.join(workspace, "pkg"));

      const fallback = await findProjectRoot(
        path.join(workspace, "pkg", "src"),
        ["no-such-marker"],
        workspace,
      );
      assert.equal(fallback, workspace);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("reads and validates workspace LSP configuration", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-lsp-config-"));
    try {
      assert.deepEqual(loadWorkspaceServerDefinitions(workspace), []);

      const configDir = path.join(workspace, ".mythgram");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(path.join(configDir, "lsp.json"), "{not json", "utf8");
      assert.deepEqual(loadWorkspaceServerDefinitions(workspace), []);

      await fs.writeFile(
        path.join(configDir, "lsp.json"),
        JSON.stringify([
          { id: "bad" },
          {
            id: "custom",
            extensions: { foo: "foo", ".BAR": "bar" },
            command: "my-server",
            args: ["--stdio", 42],
            rootMarkers: ["marker", 7],
          },
        ]),
        "utf8",
      );
      const definitions = loadWorkspaceServerDefinitions(workspace);
      assert.equal(definitions.length, 1);
      const definition = definitions[0];
      assert.equal(definition.id, "custom");
      assert.deepEqual(definition.extensions, { ".foo": "foo", ".bar": "bar" });
      assert.deepEqual(definition.candidates, [{ command: "my-server", args: ["--stdio"] }]);
      assert.deepEqual(definition.rootMarkers, ["marker"]);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it("reports manager-level file, position, and server errors", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-lsp-errors-"));
    const manager = new LspManager({
      workspaceRoot: workspace,
      definitions: [],
      idleTimeoutMs: 0,
    });
    try {
      await fs.writeFile(path.join(workspace, "notes.unknown"), "hello\n", "utf8");

      await assert.rejects(
        () =>
          manager.execute({
            operation: "hover",
            filePath: "missing.unknown",
            line: 1,
            character: 1,
            workspaceRoot: workspace,
          }),
        (error: unknown) => error instanceof LspError && error.code === "lsp_file_not_found",
      );

      await assert.rejects(
        () =>
          manager.execute({
            operation: "hover",
            filePath: "notes.unknown",
            line: 1,
            character: 1,
            workspaceRoot: workspace,
          }),
        (error: unknown) => error instanceof LspError && error.code === "lsp_server_not_found",
      );

      await assert.rejects(
        () =>
          manager.execute({
            operation: "hover",
            filePath: "../escape.unknown",
            line: 1,
            character: 1,
            workspaceRoot: workspace,
          }),
        (error: unknown) => error instanceof LspError && error.code === "lsp_invalid_path",
      );
    } finally {
      await manager.dispose();
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ end to end */

describe("lsp tool end to end", () => {
  let workspace: string;
  let serverPath: string;
  let filePath: string;
  let registry: ToolRegistry;
  let ctx: ToolContext;

  before(async () => {
    workspace = await writeFakeWorkspace();
    serverPath = path.join(workspace, "fake-lsp.cjs");
    filePath = path.join(workspace, "sample.fake");
    await fs.writeFile(
      filePath,
      ["alpha beta", "  gamma delta", "const value = 1;", ""].join("\n"),
      "utf8",
    );
    registry = new ToolRegistry().register(lspTool);
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 5_000 };
  });

  after(async () => {
    await shutdownLspManagers();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  function run(args: Record<string, unknown>, overrides: Partial<ToolContext> = {}) {
    return registry.execute("lsp", args, { ...ctx, ...overrides });
  }

  it("runs goToDefinition", async () => {
    const result = await run({
      operation: "goToDefinition",
      filePath: "sample.fake",
      line: 1,
      character: 1,
    });
    const data = dataOf(result);
    assert.equal(data.operation, "goToDefinition");
    assert.equal(data.file_path, "sample.fake");
    assert.equal(data.server.id, "fake");
    assert.equal(data.count, 1);
    const locations = data.locations as Array<Record<string, any>>;
    assert.equal(locations[0].path, "sample.fake");
    assert.equal(locations[0].line, 1);
    assert.equal(locations[0].character, 1);
    assert.equal(locations[0].preview, "alpha beta");
    assert.match(String(data.formatted), /LSP goToDefinition/);
  });

  it("runs findReferences", async () => {
    const data = dataOf(
      await run({
        operation: "findReferences",
        filePath: "sample.fake",
        line: 1,
        character: 1,
      }),
    );
    assert.equal(data.count, 2);
    const locations = data.locations as Array<Record<string, any>>;
    assert.equal(locations[1].line, 2);
    assert.equal(locations[1].character, 3);
  });

  it("runs hover and re-syncs changed documents", async () => {
    const first = dataOf(
      await run({ operation: "hover", filePath: "sample.fake", line: 1, character: 1 }),
    );
    assert.match(String(first.contents), /hover/);
    assert.match(String(first.contents), /alpha beta/);

    await fs.writeFile(
      filePath,
      ["omega beta", "  gamma delta", "const value = 1;", ""].join("\n"),
      "utf8",
    );

    const second = dataOf(
      await run({ operation: "hover", filePath: "sample.fake", line: 1, character: 1 }),
    );
    assert.match(String(second.contents), /omega beta/);
    assert.doesNotMatch(String(second.contents), /alpha beta/);
  });

  it("runs documentSymbol with hierarchical children", async () => {
    const data = dataOf(
      await run({
        operation: "documentSymbol",
        filePath: "sample.fake",
        line: 1,
        character: 1,
      }),
    );
    const symbols = data.symbols as Array<Record<string, any>>;
    assert.equal(symbols.length, 2);
    assert.equal(symbols[0].name, "outer");
    assert.equal(symbols[0].kind, "Function");
    assert.equal(symbols[0].line, 1);
    assert.equal(symbols[1].name, "inner");
    assert.equal(symbols[1].kind, "Variable");
    assert.equal(symbols[1].depth, 1);
    assert.equal(symbols[1].path, "sample.fake");
  });

  it("runs workspaceSymbol with an explicit query", async () => {
    const data = dataOf(
      await run({
        operation: "workspaceSymbol",
        filePath: "sample.fake",
        line: 1,
        character: 1,
        query: "MySymbol",
      }),
    );
    assert.equal(data.query, "MySymbol");
    const symbols = data.symbols as Array<Record<string, any>>;
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "MySymbol");
    assert.equal(symbols[0].path, "sample.fake");
  });

  it("derives the workspaceSymbol query from the cursor", async () => {
    const data = dataOf(
      await run({
        operation: "workspaceSymbol",
        filePath: "sample.fake",
        line: 1,
        character: 1,
      }),
    );
    assert.equal(data.query, "omega");
  });

  it("rejects workspaceSymbol when the cursor is not on a symbol", async () => {
    const result = await run({
      operation: "workspaceSymbol",
      filePath: "sample.fake",
      line: 2,
      character: 1,
    });
    assert.equal(errorCodeOf(result), "lsp_missing_query");
  });

  it("runs goToImplementation", async () => {
    const data = dataOf(
      await run({
        operation: "goToImplementation",
        filePath: "sample.fake",
        line: 1,
        character: 1,
      }),
    );
    assert.equal(data.count, 1);
    const locations = data.locations as Array<Record<string, any>>;
    assert.equal(locations[0].line, 3);
  });

  it("runs prepareCallHierarchy, incomingCalls, and outgoingCalls", async () => {
    const prepared = dataOf(
      await run({
        operation: "prepareCallHierarchy",
        filePath: "sample.fake",
        line: 1,
        character: 1,
      }),
    );
    const hierarchy = prepared.hierarchy as Array<Record<string, any>>;
    assert.equal(hierarchy.length, 1);
    assert.equal(hierarchy[0].name, "target");

    const incoming = dataOf(
      await run({
        operation: "incomingCalls",
        filePath: "sample.fake",
        line: 1,
        character: 1,
      }),
    );
    const incomingCalls = incoming.calls as Array<Record<string, any>>;
    assert.equal(incomingCalls.length, 1);
    assert.equal(incomingCalls[0].name, "caller");
    assert.equal(incomingCalls[0].direction, "incoming");

    const outgoing = dataOf(
      await run({
        operation: "outgoingCalls",
        filePath: "sample.fake",
        line: 1,
        character: 1,
      }),
    );
    const outgoingCalls = outgoing.calls as Array<Record<string, any>>;
    assert.equal(outgoingCalls.length, 1);
    assert.equal(outgoingCalls[0].name, "callee");
    assert.equal(outgoingCalls[0].direction, "outgoing");
  });

  it("returns structured errors for invalid arguments, missing files, positions, and aborts", async () => {
    assert.equal(
      errorCodeOf(
        await run({ operation: "notAnOperation", filePath: "sample.fake", line: 1, character: 1 }),
      ),
      "invalid_arguments",
    );

    assert.equal(
      errorCodeOf(
        await run({ operation: "hover", filePath: "nope.fake", line: 1, character: 1 }),
      ),
      "lsp_file_not_found",
    );

    assert.equal(
      errorCodeOf(
        await run({ operation: "hover", filePath: "sample.fake", line: 999, character: 1 }),
      ),
      "lsp_invalid_position",
    );

    assert.equal(
      errorCodeOf(
        await run(
          { operation: "hover", filePath: "sample.fake", line: 1, character: 1 },
          { signal: AbortSignal.abort() },
        ),
      ),
      "lsp_aborted",
    );

    await fs.writeFile(path.join(workspace, "notes.unknown"), "hello\n", "utf8");
    assert.equal(
      errorCodeOf(
        await run({ operation: "hover", filePath: "notes.unknown", line: 1, character: 1 }),
      ),
      "lsp_server_not_found",
    );
  });

  it("reports unsupported server methods and request timeouts", async () => {
    const definition: LspServerDefinition = {
      id: "fake-direct",
      name: "Fake LSP Direct",
      extensions: { ".fake": "fake" },
      candidates: [{ command: process.execPath, args: [serverPath] }],
      rootMarkers: [],
    };
    const client = new LspClient({
      definition,
      candidate: definition.candidates[0],
      root: workspace,
      workspaceRoot: workspace,
      requestTimeoutMs: 200,
      initializeTimeoutMs: 5_000,
    });

    try {
      await client.start();
      await assert.rejects(
        () => client.request("custom/unknown", null, 500),
        (error: unknown) =>
          error instanceof LspError && error.code === "lsp_method_not_supported",
      );
      await assert.rejects(
        () => client.request("fake/never", null, 100),
        (error: unknown) => error instanceof LspError && error.code === "lsp_request_timeout",
      );
    } finally {
      await client.dispose();
    }
  });
});