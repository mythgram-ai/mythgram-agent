import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

/** Maximum number of lines the file_read tool returns when no limit is given. */
export const MAX_FILE_READ_LINES = 4000;
/** Maximum number of characters a single returned line can contain. */
export const MAX_LINE_LENGTH = 4000;

/** Chunk size used while streaming files, keeping memory bounded on large inputs. */
const CHUNK_SIZE = 64 * 1024;
/** Width of the right-aligned line number field in `cat -n` style output. */
const LINE_NUMBER_WIDTH = 6;
/** Suffix appended to lines that were truncated at MAX_LINE_LENGTH. */
const TRUNCATED_SUFFIX = "...";

/**
 * Lenient boolean accepted by the file_read schema. Native tool calling normally passes a
 * real JSON boolean, but some models emit the strings "true"/"false"; both are accepted.
 */
const returnLineNumberSchema = z
  .preprocess(
    (value) => (value === "true" ? true : value === "false" ? false : value),
    z.boolean(),
  )
  .optional()
  .describe(
    `Optional flag controlling whether the returned content is prefixed with line numbers. When true, each line is rendered in \`cat -n\` style (right-aligned line number, two spaces, then the line content, e.g. "     1  import fs"). When false or omitted, the raw file content is returned with no line numbers. Default: false`,
  );

const schema = z.object({
  file_path: z
    .string()
    .trim()
    .min(1, "file_path must be a non-empty string")
    .describe("The absolute path to the file to read."),
  limit: z
    .coerce
    .number()
    .int("limit must be an integer")
    .min(1, "limit must be 1 or greater")
    .optional()
    .describe(
      `Optional number of lines to read from the text file. Use for large files to limit output. Must be 1 or greater. If omitted, reads up to ${MAX_FILE_READ_LINES} lines by default`,
    ),
  offset: z
    .coerce
    .number()
    .int("offset must be an integer")
    .min(1, "offset must be 1 or greater")
    .optional()
    .describe(
      "Optional line number to start reading from (1-based). Use with limit to read specific sections of large files. Must be 1 or greater. If omitted, starts from line 1",
    ),
  return_line_number: returnLineNumberSchema,
});

const descriptionParameters = {
  type: "object",
  properties: {
    file_path: {
      type: "string",
      description: "The absolute path to the file to read",
    },
    limit: {
      type: "integer",
      description: `Optional number of lines to read from the text file. Use for large files to limit output. Must be 1 or greater. If omitted, reads up to ${MAX_FILE_READ_LINES} lines by default`,
    },
    offset: {
      type: "integer",
      description:
        "Optional line number to start reading from (1-based). Use with limit to read specific sections of large files. Must be 1 or greater. If omitted, starts from line 1",
    },
    return_line_number: {
      type: "boolean",
      description:
        "Optional. When true, each returned line is prefixed with its line number in `cat -n` style. When false or omitted, the raw file content is returned with no line numbers. Default: false.",
    },
  },
  required: ["file_path"],
};

const DESCRIPTION = `Reads and returns the content of a specified file from the local filesystem.

Usage:
- file_path must be an absolute path
- reads up to ${MAX_FILE_READ_LINES} lines with optional offset/limit
  - Use offset and limit parameters for large files to read specific sections
  - Lines longer than ${MAX_LINE_LENGTH} chars are truncated
  - Returns the raw file content with no line numbers by default; set return_line_number=true to have each line prefixed with its line number in \`cat -n\` style
  - The first_line/last_line metadata fields always report which lines were returned

${JSON.stringify(descriptionParameters, null, 2)}`;

/** Structured error raised by the tool with a machine readable code. */
class FileReadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FileReadError";
  }
}

/** Raised when the target file appears to be binary / not a text file. */
class BinaryFileError extends FileReadError {
  constructor(filePath: string) {
    super(
      "binary_file",
      `The file "${filePath}" appears to be binary or non-text content, which cannot be returned as text.`,
    );
    this.name = "BinaryFileError";
  }
}

interface ReadSection {
  /** Lines that were requested; raw content, or `cat -n` style with line numbers when requested. */
  lines: string[];
  /** Original line number of the first returned line, or null when nothing matched. */
  firstLine: number | null;
  /** Original line number of the last returned line, or null when nothing matched. */
  lastLine: number | null;
  /** Total number of lines in the file. */
  totalLines: number;
  /** Number of lines truncated at MAX_LINE_LENGTH. */
  truncatedLines: number;
}

/**
 * Resolve and validate a model supplied path for reading. The path must be absolute and,
 * for safety, must stay inside the workspace root.
 */
function resolveForRead(workspaceRoot: string, input: string): string {
  const trimmed = input.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new FileReadError(
      "invalid_file_path",
      `file_path must be an absolute path. Received: "${input}".`,
    );
  }
  const root = path.resolve(workspaceRoot);
  if (trimmed !== root && !trimmed.startsWith(root + path.sep)) {
    throw new FileReadError(
      "invalid_file_path",
      `Absolute path "${trimmed}" is outside the workspace root (${root}).`,
    );
  }
  return safeResolve(workspaceRoot, trimmed);
}

/**
 * Stream a file in chunks (bounded memory) and extract the requested line range, rendered
 * either as raw content or in `cat -n` style depending on `includeLineNumbers`. Always
 * scans the whole file so `totalLines` and truncation metadata are accurate; only the
 * requested lines are ever held in memory. Detects binary content by scanning raw bytes
 * for NUL characters.
 */
async function readSection(
  filePath: string,
  offset: number,
  limit: number,
  includeLineNumbers: boolean,
  signal?: AbortSignal,
): Promise<ReadSection> {
  const handle = await fs.promises.open(filePath, "r");
  const decoder = new StringDecoder("utf8");
  try {
    const buf = Buffer.alloc(CHUNK_SIZE);
    const lines: string[] = [];
    let pending = "";
    let lineNumber = 0;
    let firstLine: number | null = null;
    let lastLine: number | null = null;
    let truncatedLines = 0;
    let binary = false;
    let eof = false;

    const collectLine = (rawLine: string): void => {
      lineNumber += 1;
      if (lineNumber < offset || lines.length >= limit) return;
      let line = rawLine;
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length > MAX_LINE_LENGTH) {
        truncatedLines += 1;
        line = line.slice(0, MAX_LINE_LENGTH) + TRUNCATED_SUFFIX;
      }
      if (firstLine === null) firstLine = lineNumber;
      lastLine = lineNumber;
      lines.push(
        includeLineNumbers
          ? `${String(lineNumber).padStart(LINE_NUMBER_WIDTH)}  ${line}`
          : line,
      );
    };

    while (!eof) {
      if (signal?.aborted) throw new FileReadError("aborted", "The file read was aborted.");
      const { bytesRead } = await handle.read(buf, 0, CHUNK_SIZE, null);
      eof = bytesRead < CHUNK_SIZE;
      if (bytesRead === 0) break;
      if (buf.subarray(0, bytesRead).includes(0)) binary = true;
      pending += decoder.write(buf.subarray(0, bytesRead));

      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        const raw = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        collectLine(raw);
        newlineIndex = pending.indexOf("\n");
      }
    }

    pending += decoder.end();
    if (pending.length > 0) collectLine(pending);

    if (binary) throw new BinaryFileError(filePath);

    return { lines, firstLine, lastLine, totalLines: lineNumber, truncatedLines };
  } finally {
    await handle.close();
  }
}

export const fileReadTool = defineTool({
  name: "file_read",
  description: DESCRIPTION,
  schema,
  label: (args) => `Read: ${args.file_path}`,
  async execute(args, ctx): Promise<ToolResult> {
    const filePath = args.file_path.trim();
    const offset = args.offset ?? 1;
    const limit = args.limit ?? MAX_FILE_READ_LINES;
    const returnLineNumber = args.return_line_number ?? false;

    // Defense in depth: the schema already enforces these, but keep the tool safe standalone.
    if (filePath.length === 0) {
      return {
        ok: false,
        error: { code: "invalid_file_path", message: "file_path must be a non-empty string.", file_path: args.file_path },
      };
    }
    if (typeof returnLineNumber !== "boolean") {
      return {
        ok: false,
        error: {
          code: "invalid_return_line_number",
          message: "return_line_number must be a boolean.",
          return_line_number: args.return_line_number,
        },
      };
    }
    if (!Number.isInteger(offset) || offset < 1) {
      return {
        ok: false,
        error: { code: "invalid_offset", message: "offset must be an integer of 1 or greater.", offset: args.offset },
      };
    }
    if (!Number.isInteger(limit) || limit < 1) {
      return {
        ok: false,
        error: { code: "invalid_limit", message: "limit must be an integer of 1 or greater.", limit: args.limit },
      };
    }

    let absolute: string;
    try {
      absolute = resolveForRead(ctx.workspaceRoot, filePath);
    } catch (error) {
      if (error instanceof FileReadError) {
        return { ok: false, error: { code: error.code, message: error.message, file_path: args.file_path } };
      }
      return {
        ok: false,
        error: {
          code: "invalid_file_path",
          message: error instanceof Error ? error.message : String(error),
          file_path: args.file_path,
        },
      };
    }

    const relative = toWorkspaceRelative(ctx.workspaceRoot, absolute);

    let stat;
    try {
      stat = await fs.promises.stat(absolute);
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException)?.code;
      if (errno === "ENOENT" || errno === "ENOTDIR") {
        return {
          ok: false,
          error: { code: "file_not_found", message: `File does not exist: ${relative}`, file_path: relative },
        };
      }
      if (errno === "EACCES" || errno === "EPERM") {
        return {
          ok: false,
          error: { code: "permission_denied", message: `Permission denied while reading: ${relative}`, file_path: relative },
        };
      }
      return {
        ok: false,
        error: {
          code: "file_read_failed",
          message: `Could not stat "${relative}": ${error instanceof Error ? error.message : String(error)}`,
          file_path: relative,
        },
      };
    }

    if (stat.isDirectory()) {
      return {
        ok: false,
        error: { code: "is_directory", message: `Path is a directory, not a file: ${relative}`, file_path: relative },
      };
    }
    if (!stat.isFile()) {
      return {
        ok: false,
        error: {
          code: "unsupported_file_type",
          message: `Path is not a regular file and cannot be read as text: ${relative}`,
          file_path: relative,
        },
      };
    }

    let section: ReadSection;
    try {
      section = await readSection(absolute, offset, limit, returnLineNumber, ctx.signal);
    } catch (error) {
      if (error instanceof FileReadError) {
        return { ok: false, error: { code: error.code, message: error.message, file_path: relative } };
      }
      return {
        ok: false,
        error: {
          code: "file_read_failed",
          message: `Failed to read "${relative}": ${error instanceof Error ? error.message : String(error)}`,
          file_path: relative,
        },
      };
    }

    return {
      ok: true,
      data: {
        file_path: relative,
        content: section.lines.join("\n"),
        line_count: section.lines.length,
        total_lines: section.totalLines,
        first_line: section.firstLine,
        last_line: section.lastLine,
        offset,
        limit,
        return_line_number: returnLineNumber,
        truncated: section.lastLine !== null && section.lastLine < section.totalLines,
        truncated_lines: section.truncatedLines,
        binary: false,
      },
    };
  },
});
