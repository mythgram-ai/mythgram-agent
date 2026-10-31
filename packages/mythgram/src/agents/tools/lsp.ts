import { z } from "zod";
import {
  LSP_OPERATIONS,
  formatLspExecution,
  getLspManager,
  isLspError,
  messageOf,
  type LspOperation,
} from "../../lsp/index.js";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

const OPERATION_VALUES = [...LSP_OPERATIONS] as [LspOperation, ...LspOperation[]];

const OPERATION_LIST = LSP_OPERATIONS.join(", ");

const schema = z
  .object({
    operation: z
      .enum(OPERATION_VALUES)
      .describe(
        "The LSP operation to perform. Supported operations: " +
          `${OPERATION_LIST}.`,
      ),
    filePath: z
      .string()
      .trim()
      .min(1, "filePath must be a non-empty path")
      .describe("The absolute or workspace-relative path to the file."),
    line: z
      .number()
      .int("line must be an integer")
      .min(1, "line must be 1 or greater")
      .describe("The line number (1-based, as shown in editors)."),
    character: z
      .number()
      .int("character must be an integer")
      .min(1, "character must be 1 or greater")
      .describe("The character offset (1-based, as shown in editors)."),
    query: z
      .string()
      .trim()
      .min(1, "query must be a non-empty string when provided")
      .optional()
      .describe(
        "Optional symbol name for workspaceSymbol. When omitted, the identifier under the " +
          "cursor (line + character) is used as the query.",
      ),
  })
  .strict();

type LspArgs = z.infer<typeof schema>;

function label(args: LspArgs): string {
  const file =
    args.filePath.length > 64 ? `…${args.filePath.slice(-63)}` : args.filePath;
  return `LSP ${args.operation}: ${file}:${args.line}:${args.character}`;
}

/**
 * Query a language server for code intelligence. The agent supplies a 1-based
 * editor position; the manager locates the right server for the file, keeps the
 * document in sync, and formats the response into locations, symbols, hover
 * text, or call-hierarchy edges.
 */
export const lspTool = defineTool({
  name: "lsp",
  description:
    "Interact with Language Server Protocol (LSP) servers to get code intelligence features.\n\n" +
    "Supported operations:\n" +
    "- goToDefinition: Find where a symbol is defined\n" +
    "- findReferences: Find all references to a symbol\n" +
    "- hover: Get hover information (documentation, type info) for a symbol\n" +
    "- documentSymbol: Get all symbols (functions, classes, variables) in a document\n" +
    "- workspaceSymbol: Search for symbols across the entire workspace\n" +
    "- goToImplementation: Find implementations of an interface or abstract method\n" +
    "- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)\n" +
    "- incomingCalls: Find all functions/methods that call the function at a position\n" +
    "- outgoingCalls: Find all functions/methods called by the function at a position\n\n" +
    "All operations require a file path plus a 1-based line and character offset (as shown " +
    "in editors). workspaceSymbol optionally accepts a `query`; when omitted the identifier " +
    "under the cursor is used.\n\n" +
    "Note: an LSP server must be installed/configured for the file type. If no server is " +
    "available, a structured error is returned explaining what is missing.",
  schema,
  label,
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const manager = getLspManager(ctx.workspaceRoot);
      const execution = await manager.execute({
        operation: args.operation,
        filePath: args.filePath,
        line: args.line,
        character: args.character,
        query: args.query,
        workspaceRoot: ctx.workspaceRoot,
        signal: ctx.signal,
      });
      const data = await formatLspExecution(execution);
      return { ok: true, data };
    } catch (error) {
      if (isLspError(error)) {
        return {
          ok: false,
          error: {
            ...(error.details ?? {}),
            code: error.code,
            message: error.message,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "lsp_error",
          message: `LSP operation failed: ${messageOf(error)}`,
        },
      };
    }
  },
});

export { LSP_OPERATIONS, OPERATION_VALUES };