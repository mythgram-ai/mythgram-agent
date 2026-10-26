import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";
import { safeResolve, toWorkspaceRelative } from "../../utils/paths.js";

/*
 * apply_patch — edit files by generating and applying a structured, file-oriented patch instead of
 * rewriting whole files. The model passes ONE `input` string: a self-contained patch envelope
 *
 *   *** Begin Patch
 *   [ one or more file sections ]
 *   *** End Patch
 *
 * Each file section is one operation:
 *   *** Add File: <path>       — create a new file (every following line is a "+" line).
 *   *** Delete File: <path>    — remove an existing file (nothing follows).
 *   *** Update File: <path>    — patch an existing file in place, optionally renaming it with
 *                                "*** Move to: <new path>", then one or more "@@" hunks.
 *
 * Inside an Update hunk, each line is prefixed:
 *   " " (space) — context line (kept, used only to locate the edit)
 *   "-"         — a line to REMOVE (its whole line is deleted from the file)
 *   "+"         — a line to ADD
 *
 * The tool parses AND validates the entire patch first (structure, markers, paths, operations,
 * hunk syntax), then verifies every operation can be applied against the current files, and only
 * then writes to disk. If anything is wrong, NO file is touched and a structured error is returned.
 */

/* --------------------------------------------------------------------------- markers */

const BEGIN_MARKER = "*** Begin Patch";
const END_MARKER = "*** End Patch";
const ADD_PREFIX = "*** Add File: ";
const DELETE_PREFIX = "*** Delete File: ";
const UPDATE_PREFIX = "*** Update File: ";
const MOVE_PREFIX = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const HUNK_PREFIX = "@@";

/* --------------------------------------------------------------------------- parsed model */

/** A single line inside an Update hunk. */
interface HunkLine {
  /** "keep" = context, "del" = remove the line, "add" = insert the line. */
  kind: "keep" | "del" | "add";
  /** The line text WITHOUT its one-character prefix. */
  text: string;
}

/** One "@@" hunk of an Update operation. */
interface Hunk {
  /** Optional "@@ <header>" anchors (class/function names) used to disambiguate the location. */
  headers: string[];
  lines: HunkLine[];
  /** True when the hunk carried a "*** End of File" marker (a pure append at end-of-file). */
  endOfFile: boolean;
}

interface AddOp {
  type: "add";
  path: string;
  /** Full file contents (the joined "+" lines). */
  content: string;
}

interface DeleteOp {
  type: "delete";
  path: string;
}

interface UpdateOp {
  type: "update";
  path: string;
  /** New path when the file is being renamed via "*** Move to:". */
  movePath?: string;
  hunks: Hunk[];
}

type PatchOp = AddOp | DeleteOp | UpdateOp;

/** A structured patch parse/validation error. `line` is the 1-based line of `input` when known. */
export class PatchError extends Error {
  readonly code: string;
  readonly line?: number;
  constructor(code: string, message: string, line?: number) {
    super(message);
    this.name = "PatchError";
    this.code = code;
    this.line = line;
  }
}

/* --------------------------------------------------------------------------- parser */

/**
 * A tiny cursor over the patch lines so the parser can peek/consume with 1-based line numbers for
 * error reporting.
 */
class LineCursor {
  private index = 0;
  constructor(private readonly lines: string[]) {}
  get lineNumber(): number {
    return this.index + 1;
  }
  atEnd(): boolean {
    return this.index >= this.lines.length;
  }
  peek(): string | undefined {
    return this.lines[this.index];
  }
  next(): string | undefined {
    return this.lines[this.index++];
  }
}

/** True when a raw line is a "*** ..." control header (Add/Delete/Update/Move/End of File/End Patch). */
function isControlHeader(line: string): boolean {
  return line.startsWith("*** ");
}

/** Validate a file path is absolute (never relative) and non-empty. Throws PatchError otherwise. */
function assertValidPath(rawPath: string, kind: string, lineNumber: number): string {
  const filePath = rawPath.trim();
  if (filePath.length === 0) {
    throw new PatchError(
      "missing_file_path",
      `${kind} header is missing a file path (line ${lineNumber}).`,
      lineNumber,
    );
  }
  if (!filePath.startsWith("/")) {
    throw new PatchError(
      "relative_path",
      `Relative path "${filePath}" is not allowed (line ${lineNumber}). File references MUST be absolute paths starting with "/".`,
      lineNumber,
    );
  }
  return filePath;
}

/**
 * Parse the raw patch text into a validated list of operations. Throws PatchError on any structural
 * problem (missing markers, unknown operation, relative path, invalid hunk syntax, invalid line
 * prefix, duplicate Add/Delete, empty Update, missing header, invalid Move, ...). No file I/O here.
 */
export function parsePatch(input: string): PatchOp[] {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new PatchError("empty_patch", "The patch is empty. Provide a full '*** Begin Patch' ... '*** End Patch' envelope.");
  }

  // Normalise newlines but keep the raw content of each line (whitespace matters for matching).
  const allLines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  // Locate the Begin marker — everything before it (blank lines only) is tolerated.
  let start = 0;
  while (start < allLines.length && allLines[start]!.trim().length === 0) start += 1;
  if (start >= allLines.length || allLines[start]!.trimEnd() !== BEGIN_MARKER) {
    throw new PatchError(
      "missing_begin_marker",
      `Patch must start with "${BEGIN_MARKER}".`,
      start + 1,
    );
  }

  // Slice the body between Begin and End; require the End marker to exist.
  const body: string[] = [];
  let sawEnd = false;
  let endLineNo = 0;
  for (let i = start + 1; i < allLines.length; i++) {
    if (allLines[i]!.trimEnd() === END_MARKER) {
      sawEnd = true;
      endLineNo = i + 1;
      // Only trailing blank lines may follow the End marker.
      for (let j = i + 1; j < allLines.length; j++) {
        if (allLines[j]!.trim().length !== 0) {
          throw new PatchError(
            "content_after_end",
            `Unexpected content after "${END_MARKER}" (line ${j + 1}).`,
            j + 1,
          );
        }
      }
      break;
    }
    if (allLines[i]!.trimEnd() === BEGIN_MARKER) {
      throw new PatchError("duplicate_begin_marker", `Unexpected second "${BEGIN_MARKER}" (line ${i + 1}).`, i + 1);
    }
    body.push(allLines[i]!);
  }
  if (!sawEnd) {
    throw new PatchError("missing_end_marker", `Patch is missing the closing "${END_MARKER}" marker.`);
  }
  void endLineNo;

  // The body's 1-based line numbers are offset by (start + 1) into the original input.
  const bodyOffset = start + 1;
  const cursor = new LineCursor(body);
  const ops: PatchOp[] = [];
  const addedPaths = new Set<string>();
  const deletedPaths = new Set<string>();
  const updatedPaths = new Set<string>();

  while (!cursor.atEnd()) {
    const rawLine = cursor.peek()!;
    const originalLineNo = cursor.lineNumber + bodyOffset;

    // Skip blank separator lines between operations.
    if (rawLine.trim().length === 0) {
      cursor.next();
      continue;
    }

    if (rawLine.startsWith(ADD_PREFIX)) {
      cursor.next();
      const filePath = assertValidPath(rawLine.slice(ADD_PREFIX.length), "Add File", originalLineNo);
      if (addedPaths.has(filePath)) {
        throw new PatchError(
          "duplicate_add",
          `Duplicate "Add File" operation for "${filePath}" (line ${originalLineNo}).`,
          originalLineNo,
        );
      }
      addedPaths.add(filePath);
      ops.push(parseAddOp(filePath, cursor, bodyOffset));
      continue;
    }

    if (rawLine.startsWith(DELETE_PREFIX)) {
      cursor.next();
      const filePath = assertValidPath(rawLine.slice(DELETE_PREFIX.length), "Delete File", originalLineNo);
      if (deletedPaths.has(filePath)) {
        throw new PatchError(
          "duplicate_delete",
          `Duplicate "Delete File" operation for "${filePath}" (line ${originalLineNo}).`,
          originalLineNo,
        );
      }
      deletedPaths.add(filePath);
      ops.push({ type: "delete", path: filePath });
      continue;
    }

    if (rawLine.startsWith(UPDATE_PREFIX)) {
      cursor.next();
      const filePath = assertValidPath(rawLine.slice(UPDATE_PREFIX.length), "Update File", originalLineNo);
      if (updatedPaths.has(filePath)) {
        throw new PatchError(
          "duplicate_update",
          `Duplicate "Update File" operation for "${filePath}" (line ${originalLineNo}).`,
          originalLineNo,
        );
      }
      updatedPaths.add(filePath);
      ops.push(parseUpdateOp(filePath, cursor, bodyOffset));
      continue;
    }

    if (rawLine.startsWith(MOVE_PREFIX)) {
      throw new PatchError(
        "misplaced_move",
        `"${MOVE_PREFIX.trim()}" must immediately follow an "Update File" header (line ${originalLineNo}).`,
        originalLineNo,
      );
    }

    if (rawLine.startsWith(HUNK_PREFIX)) {
      throw new PatchError(
        "hunk_outside_update",
        `Hunk "@@" appears outside of an "Update File" operation (line ${originalLineNo}).`,
        originalLineNo,
      );
    }

    if (isControlHeader(rawLine)) {
      throw new PatchError(
        "unknown_operation",
        `Unknown operation "${rawLine.trim()}" (line ${originalLineNo}). Expected "*** Add File:", "*** Update File:", or "*** Delete File:".`,
        originalLineNo,
      );
    }

    // A non-header, non-blank line where an operation header was expected.
    throw new PatchError(
      "missing_file_header",
      `Expected a file operation header ("*** Add File:", "*** Update File:", or "*** Delete File:") but found "${rawLine}" (line ${originalLineNo}).`,
      originalLineNo,
    );
  }

  if (ops.length === 0) {
    throw new PatchError("no_operations", "The patch contains no file operations.");
  }

  return ops;
}

/** Parse an Add File body: every following line until the next control header must start with "+". */
function parseAddOp(filePath: string, cursor: LineCursor, bodyOffset: number): AddOp {
  const lines: string[] = [];
  while (!cursor.atEnd()) {
    const raw = cursor.peek()!;
    if (isControlHeader(raw)) break;
    cursor.next();
    if (!raw.startsWith("+")) {
      const lineNo = cursor.lineNumber - 1 + bodyOffset;
      throw new PatchError(
        "invalid_add_line",
        `Every line of an "Add File" must start with "+". Found "${raw}" for "${filePath}" (line ${lineNo}).`,
        lineNo,
      );
    }
    lines.push(raw.slice(1));
  }
  // Newly created file content: the "+" lines joined, with a trailing newline unless empty.
  const content = lines.length === 0 ? "" : lines.join("\n") + "\n";
  return { type: "add", path: filePath, content };
}

/** Parse an Update File body: an optional "*** Move to:" then one or more hunks. */
function parseUpdateOp(filePath: string, cursor: LineCursor, bodyOffset: number): UpdateOp {
  let movePath: string | undefined;

  // Optional rename — must be the very first line after the Update header.
  if (!cursor.atEnd() && cursor.peek()!.startsWith(MOVE_PREFIX)) {
    const raw = cursor.next()!;
    const lineNo = cursor.lineNumber - 1 + bodyOffset;
    movePath = assertValidPath(raw.slice(MOVE_PREFIX.length), "Move to", lineNo);
  }
  // A second "*** Move to:" is invalid.
  if (!cursor.atEnd() && cursor.peek()!.startsWith(MOVE_PREFIX)) {
    const lineNo = cursor.lineNumber + bodyOffset;
    throw new PatchError(
      "invalid_move",
      `An "Update File" may have only one "*** Move to:" line (line ${lineNo}).`,
      lineNo,
    );
  }

  const hunks: Hunk[] = [];
  let current: Hunk | null = null;

  while (!cursor.atEnd()) {
    const raw = cursor.peek()!;

    if (raw.startsWith(EOF_MARKER)) {
      cursor.next();
      if (!current) {
        const lineNo = cursor.lineNumber - 1 + bodyOffset;
        throw new PatchError(
          "invalid_hunk",
          `"${EOF_MARKER}" must appear inside a hunk for "${filePath}" (line ${lineNo}).`,
          lineNo,
        );
      }
      current.endOfFile = true;
      continue;
    }

    // Any other control header ends this Update operation.
    if (isControlHeader(raw)) break;

    cursor.next();
    const lineNo = cursor.lineNumber - 1 + bodyOffset;

    if (raw.startsWith(HUNK_PREFIX)) {
      const header = raw.slice(HUNK_PREFIX.length).trim();
      if (current && current.lines.length === 0 && current.headers.length > 0) {
        // Allow stacked "@@" anchors ("@@ class Foo" then "@@ def bar") for the same hunk.
        current.headers.push(header);
      } else {
        current = { headers: header ? [header] : [], lines: [], endOfFile: false };
        hunks.push(current);
      }
      continue;
    }

    // A diff body line: " ", "-", "+" prefixes, or a completely empty line (blank context line).
    const hunkLine = parseHunkLine(raw, filePath, lineNo);
    if (!current) {
      // Tolerate an implicit first hunk that starts directly with diff lines (no leading "@@").
      current = { headers: [], lines: [], endOfFile: false };
      hunks.push(current);
    }
    current.lines.push(hunkLine);
  }

  const meaningfulHunks = hunks.filter((h) => h.lines.length > 0 || h.endOfFile);
  if (!movePath && meaningfulHunks.length === 0) {
    throw new PatchError(
      "empty_update",
      `"Update File" for "${filePath}" has no changes (no hunks and no "*** Move to:").`,
    );
  }
  // A hunk that only carries context lines changes nothing — reject it as invalid.
  for (const hunk of meaningfulHunks) {
    if (hunk.lines.length > 0 && !hunk.lines.some((l) => l.kind !== "keep")) {
      throw new PatchError(
        "no_op_hunk",
        `A hunk for "${filePath}" has only context lines and no "+"/"-" changes.`,
      );
    }
  }

  return { type: "update", path: filePath, movePath, hunks: meaningfulHunks };
}

/** Parse one diff body line into a HunkLine, validating its prefix. */
function parseHunkLine(raw: string, filePath: string, lineNo: number): HunkLine {
  if (raw.length === 0) {
    // A fully empty line inside a hunk is a blank context line.
    return { kind: "keep", text: "" };
  }
  const prefix = raw[0]!;
  const text = raw.slice(1);
  if (prefix === " ") return { kind: "keep", text };
  if (prefix === "-") return { kind: "del", text };
  if (prefix === "+") return { kind: "add", text };
  throw new PatchError(
    "invalid_line_prefix",
    `Invalid line prefix "${prefix}" in a hunk for "${filePath}" (line ${lineNo}). ` +
      `Each hunk line must start with " " (context), "-" (remove), or "+" (add).`,
    lineNo,
  );
}

/* --------------------------------------------------------------------------- applier */

/** Split file content into lines, remembering whether it ended with a trailing newline. */
function splitFileLines(content: string): { lines: string[]; trailingNewline: boolean } {
  if (content.length === 0) return { lines: [], trailingNewline: false };
  const trailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

/** Join lines back into file content, preserving the original trailing-newline behaviour. */
function joinFileLines(lines: string[], trailingNewline: boolean): string {
  if (lines.length === 0) return "";
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

type LineComparer = (a: string, b: string) => boolean;

const COMPARERS: LineComparer[] = [
  (a, b) => a === b,
  (a, b) => a.replace(/\s+$/, "") === b.replace(/\s+$/, ""),
  (a, b) => a.trim() === b.trim(),
];

/** True when `block` matches `lines` starting at index `i` under the given comparer. */
function matchesAt(lines: string[], block: string[], i: number, eq: LineComparer): boolean {
  if (i < 0 || i + block.length > lines.length) return false;
  for (let j = 0; j < block.length; j++) {
    if (!eq(lines[i + j]!, block[j]!)) return false;
  }
  return true;
}

/**
 * Locate `block` inside `lines`, preferring the first match at or after `from`, then falling back to
 * a global scan. Tries exact match first, then whitespace-insensitive matches, so trivial trailing-
 * whitespace drift never blocks a valid patch. Returns the start index, or -1 if not found.
 */
function locateBlock(lines: string[], block: string[], from: number): number {
  if (block.length === 0) return Math.min(Math.max(from, 0), lines.length);
  for (const eq of COMPARERS) {
    for (let i = Math.max(from, 0); i + block.length <= lines.length; i++) {
      if (matchesAt(lines, block, i, eq)) return i;
    }
  }
  for (const eq of COMPARERS) {
    for (let i = 0; i + block.length <= lines.length; i++) {
      if (matchesAt(lines, block, i, eq)) return i;
    }
  }
  return -1;
}

/** Find the first line at/after `from` whose text contains `needle` (used for "@@" anchors). */
function locateAnchor(lines: string[], needle: string, from: number): number {
  const target = needle.trim();
  if (target.length === 0) return from;
  for (let i = Math.max(from, 0); i < lines.length; i++) {
    if (lines[i]!.includes(target)) return i;
  }
  for (let i = 0; i < Math.max(from, 0); i++) {
    if (lines[i]!.includes(target)) return i;
  }
  return -1;
}

/** Result of applying an Update operation in memory. */
interface UpdateResult {
  content: string;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Apply every hunk of an Update operation to `original`, returning the new file content. Removed
 * ("-") lines are physically deleted; added ("+") lines are inserted; context (" ") lines only
 * anchor the edit. Throws PatchError when a hunk's context/removed block cannot be located.
 */
function applyUpdate(op: UpdateOp, original: string): UpdateResult {
  const { lines, trailingNewline } = splitFileLines(original);
  let pointer = 0;
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const hunk of op.hunks) {
    const oldBlock: string[] = [];
    const newBlock: string[] = [];
    for (const line of hunk.lines) {
      if (line.kind === "keep") {
        oldBlock.push(line.text);
        newBlock.push(line.text);
      } else if (line.kind === "del") {
        oldBlock.push(line.text);
        linesRemoved += 1;
      } else {
        newBlock.push(line.text);
        linesAdded += 1;
      }
    }

    // Pure append at end-of-file (only "+" lines, flagged with "*** End of File").
    if (oldBlock.length === 0) {
      if (hunk.endOfFile || hunk.lines.every((l) => l.kind === "add")) {
        lines.push(...newBlock);
        pointer = lines.length;
        continue;
      }
      throw new PatchError(
        "hunk_not_anchored",
        `A hunk for "${op.path}" has no context or removed lines to locate the edit.`,
      );
    }

    // Move the search pointer to the "@@" anchor(s) when present.
    let searchStart = pointer;
    for (const header of hunk.headers) {
      const anchor = locateAnchor(lines, header, searchStart);
      if (anchor >= 0) searchStart = anchor;
    }

    const at = locateBlock(lines, oldBlock, searchStart);
    if (at < 0) {
      const preview = oldBlock.slice(0, 3).map((l) => `  ${l}`).join("\n");
      throw new PatchError(
        "context_not_found",
        `Could not locate the context for a hunk in "${op.path}". The file does not contain:\n${preview}\n` +
          `Read the current file and copy the exact lines (including indentation) into the patch.`,
      );
    }

    // Rebuild the replacement segment. Kept ("keep") and removed ("del") lines are consumed from the
    // ORIGINAL file (so unchanged lines preserve their exact on-disk text even if the patch's context
    // drifted in whitespace); only "add" lines contribute the patch's new text. "del" lines are
    // dropped, physically removing them from the file.
    const replacement: string[] = [];
    let origIdx = at;
    for (const line of hunk.lines) {
      if (line.kind === "keep") {
        replacement.push(lines[origIdx]!);
        origIdx += 1;
      } else if (line.kind === "del") {
        origIdx += 1; // consume + drop the original line
      } else {
        replacement.push(line.text);
      }
    }

    lines.splice(at, oldBlock.length, ...replacement);
    pointer = at + replacement.length;
  }

  return {
    content: joinFileLines(lines, trailingNewline),
    linesAdded,
    linesRemoved,
  };
}

/* --------------------------------------------------------------------------- orchestration */

/** In-memory pending write (or delete) computed during the dry run, committed only if all succeed. */
interface PendingChange {
  absolutePath: string;
  relativePath: string;
  action: "write" | "delete";
  content?: string;
}

/** One operation's outcome, surfaced in the tool result for the UI and the model. */
export interface OperationOutcome {
  type: "add" | "update" | "delete";
  file_path: string;
  moved_to?: string;
  lines_added?: number;
  lines_removed?: number;
}

/** Structured error raised when an operation cannot be applied (missing file, existing target, ...). */
class ApplyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ApplyError";
    this.code = code;
  }
}

/**
 * Read a file's current content, using the in-memory overlay first (so an Update after an Add in the
 * same patch sees the freshly-added content). Returns null when the file does not exist.
 */
async function readCurrent(
  absolutePath: string,
  overlay: Map<string, string | null>,
): Promise<string | null> {
  if (overlay.has(absolutePath)) return overlay.get(absolutePath) ?? null;
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Dry-run every operation against a virtual filesystem overlay, producing the list of pending
 * writes/deletes and per-operation outcomes. Throws ApplyError on the first problem WITHOUT touching
 * disk, so the whole patch is atomic: either every change applies or none do.
 */
async function planChanges(
  ops: PatchOp[],
  workspaceRoot: string,
): Promise<{ changes: PendingChange[]; outcomes: OperationOutcome[] }> {
  // overlay: absolutePath -> content (string) or null (deleted). Undefined = untouched, read disk.
  const overlay = new Map<string, string | null>();
  const changes: PendingChange[] = [];
  const outcomes: OperationOutcome[] = [];

  const resolve = (p: string): string => safeResolve(workspaceRoot, p);

  for (const op of ops) {
    if (op.type === "add") {
      const abs = resolve(op.path);
      const existing = await readCurrent(abs, overlay);
      if (existing !== null) {
        throw new ApplyError(
          "add_existing_file",
          `Cannot "Add File" "${op.path}": it already exists. Use "*** Update File:" to modify it.`,
        );
      }
      overlay.set(abs, op.content);
      changes.push({
        absolutePath: abs,
        relativePath: toWorkspaceRelative(workspaceRoot, abs),
        action: "write",
        content: op.content,
      });
      outcomes.push({
        type: "add",
        file_path: toWorkspaceRelative(workspaceRoot, abs),
        lines_added: op.content.length === 0 ? 0 : op.content.replace(/\n$/, "").split("\n").length,
      });
      continue;
    }

    if (op.type === "delete") {
      const abs = resolve(op.path);
      const existing = await readCurrent(abs, overlay);
      if (existing === null) {
        throw new ApplyError(
          "delete_missing_file",
          `Cannot "Delete File" "${op.path}": it does not exist.`,
        );
      }
      overlay.set(abs, null);
      changes.push({
        absolutePath: abs,
        relativePath: toWorkspaceRelative(workspaceRoot, abs),
        action: "delete",
      });
      outcomes.push({ type: "delete", file_path: toWorkspaceRelative(workspaceRoot, abs) });
      continue;
    }

    // Update (optionally with a rename).
    const abs = resolve(op.path);
    const current = await readCurrent(abs, overlay);
    if (current === null) {
      throw new ApplyError(
        "update_missing_file",
        `Cannot "Update File" "${op.path}": it does not exist. Use "*** Add File:" to create it.`,
      );
    }

    let updated: UpdateResult;
    try {
      updated = applyUpdate(op, current);
    } catch (error) {
      if (error instanceof PatchError) {
        throw new ApplyError(error.code, error.message);
      }
      throw error;
    }

    if (op.movePath) {
      const target = resolve(op.movePath);
      if (target !== abs) {
        const targetExisting = await readCurrent(target, overlay);
        if (targetExisting !== null) {
          throw new ApplyError(
            "move_target_exists",
            `Cannot move "${op.path}" to "${op.movePath}": the destination already exists.`,
          );
        }
      }
      // Remove the old file, write the new one.
      overlay.set(abs, null);
      overlay.set(target, updated.content);
      changes.push({
        absolutePath: abs,
        relativePath: toWorkspaceRelative(workspaceRoot, abs),
        action: "delete",
      });
      changes.push({
        absolutePath: target,
        relativePath: toWorkspaceRelative(workspaceRoot, target),
        action: "write",
        content: updated.content,
      });
      outcomes.push({
        type: "update",
        file_path: toWorkspaceRelative(workspaceRoot, abs),
        moved_to: toWorkspaceRelative(workspaceRoot, target),
        lines_added: updated.linesAdded,
        lines_removed: updated.linesRemoved,
      });
    } else {
      overlay.set(abs, updated.content);
      changes.push({
        absolutePath: abs,
        relativePath: toWorkspaceRelative(workspaceRoot, abs),
        action: "write",
        content: updated.content,
      });
      outcomes.push({
        type: "update",
        file_path: toWorkspaceRelative(workspaceRoot, abs),
        lines_added: updated.linesAdded,
        lines_removed: updated.linesRemoved,
      });
    }
  }

  return { changes, outcomes };
}

/** Commit the planned writes/deletes to disk. Writes create parent directories automatically. */
async function commitChanges(changes: PendingChange[]): Promise<void> {
  for (const change of changes) {
    if (change.action === "write") {
      await fs.mkdir(path.dirname(change.absolutePath), { recursive: true });
      await fs.writeFile(change.absolutePath, change.content ?? "", "utf8");
    }
  }
  // Deletes last so a same-patch move (delete old + write new) never races the write.
  for (const change of changes) {
    if (change.action === "delete") {
      await fs.rm(change.absolutePath, { force: true });
    }
  }
}

/* --------------------------------------------------------------------------- label helper */

/** Best-effort, never-throwing summary of a patch for the UI chip label. */
export function summarizePatch(input: string): { paths: string[]; add: number; update: number; delete: number } {
  const paths: string[] = [];
  let add = 0;
  let update = 0;
  let del = 0;
  try {
    for (const raw of String(input ?? "").split(/\r?\n/)) {
      if (raw.startsWith(ADD_PREFIX)) {
        add += 1;
        paths.push(raw.slice(ADD_PREFIX.length).trim());
      } else if (raw.startsWith(UPDATE_PREFIX)) {
        update += 1;
        paths.push(raw.slice(UPDATE_PREFIX.length).trim());
      } else if (raw.startsWith(DELETE_PREFIX)) {
        del += 1;
        paths.push(raw.slice(DELETE_PREFIX.length).trim());
      }
    }
  } catch {
    /* ignore — label must never throw */
  }
  return { paths, add, update, delete: del };
}

/* --------------------------------------------------------------------------- schema + tool */

const schema = z
  .object({
    input: z
      .string()
      .min(1, "input must be a non-empty apply_patch command.")
      .describe(
        "The full apply_patch command to execute — a single string beginning with '*** Begin Patch' " +
          "and ending with '*** End Patch'. Inside the envelope, use '*** Add File: <path>', " +
          "'*** Update File: <path>' (optionally followed by '*** Move to: <path>' and one or more '@@' " +
          "hunks), or '*** Delete File: <path>'. In a hunk, prefix each line with ' ' (context), '-' " +
          "(remove the line) or '+' (add the line). Paths MUST be absolute (start with '/').",
      ),
  })
  .strict();

export const applyPatchTool = defineTool({
  name: "apply_patch",
  description:
    "Edit files by applying a structured, file-oriented patch instead of rewriting whole files. Pass ONE " +
    "'input' string wrapped in '*** Begin Patch' ... '*** End Patch'. Each file section is one operation: " +
    "'*** Add File: <path>' (create a new file; every following line starts with '+'), '*** Update File: " +
    "<path>' (edit in place; optional '*** Move to: <path>' to rename, then '@@' hunks whose lines start " +
    "with ' ' for context, '-' to REMOVE/delete a line, or '+' to ADD a line), or '*** Delete File: <path>'. " +
    "'-' lines are physically deleted from the file, not just replaced. Paths MUST be absolute (start with " +
    "'/'). The tool validates the whole patch and verifies every operation can be applied BEFORE writing — " +
    "on any structural or apply error NO file is changed and a precise error is returned. Prefer this for " +
    "surgical, multi-file, token-efficient edits.",
  schema,
  label: (args) => {
    const { paths, add, update, delete: del } = summarizePatch(args.input);
    const total = add + update + del;
    if (total === 0) return "Apply patch";
    if (total === 1 && paths[0]) return `Patch: ${paths[0]}`;
    return `Apply patch (${total} files)`;
  },
  async execute(args, ctx): Promise<ToolResult> {
    // Phase 1 — parse + structurally validate the patch. No file I/O.
    let ops: PatchOp[];
    try {
      ops = parsePatch(args.input);
    } catch (error) {
      if (error instanceof PatchError) {
        return {
          ok: false,
          error: {
            code: error.code,
            message: `Invalid patch: ${error.message} No files were changed.`,
            ...(error.line !== undefined ? { line: error.line } : {}),
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "patch_parse_failed",
          message: `Failed to parse patch: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }

    // Phase 2 — dry-run every operation against a virtual overlay. Fails without touching disk.
    let plan: { changes: PendingChange[]; outcomes: OperationOutcome[] };
    try {
      plan = await planChanges(ops, ctx.workspaceRoot);
    } catch (error) {
      if (error instanceof ApplyError || error instanceof PatchError) {
        return {
          ok: false,
          error: {
            code: error.code,
            message: `Cannot apply patch: ${error.message} No files were changed.`,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "patch_apply_failed",
          message: `Failed to apply patch: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }

    // Phase 3 — commit. Only reached when the entire patch is valid and applicable.
    try {
      await commitChanges(plan.changes);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "patch_write_failed",
          message: `Failed to write patched files: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }

    const added = plan.outcomes.filter((o) => o.type === "add").length;
    const updated = plan.outcomes.filter((o) => o.type === "update").length;
    const removed = plan.outcomes.filter((o) => o.type === "delete").length;
    const summaryParts: string[] = [];
    if (added) summaryParts.push(`added ${added}`);
    if (updated) summaryParts.push(`updated ${updated}`);
    if (removed) summaryParts.push(`deleted ${removed}`);

    return {
      ok: true,
      data: {
        operations: plan.outcomes,
        files_changed: plan.outcomes.length,
        added,
        updated,
        deleted: removed,
        summary: `Patch applied: ${summaryParts.join(", ")} file(s).`,
      },
    };
  },
});
