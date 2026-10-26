import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyPatchTool } from "./applyPatch.js";
import { parsePatch, summarizePatch } from "./applyPatch.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

describe("apply_patch tool", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-applypatch-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = new ToolRegistry().register(applyPatchTool);
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Reset the workspace between tests so each starts clean.
    for (const entry of await fs.readdir(workspace)) {
      await fs.rm(path.join(workspace, entry), { recursive: true, force: true });
    }
  });

  /** Absolute path inside the workspace, as the model must supply. */
  function abs(name: string): string {
    return path.join(workspace, name);
  }

  async function writeFile(name: string, content: string): Promise<string> {
    const p = abs(name);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, "utf8");
    return p;
  }

  async function readFile(name: string): Promise<string> {
    return fs.readFile(abs(name), "utf8");
  }

  async function exists(name: string): Promise<boolean> {
    try {
      await fs.access(abs(name));
      return true;
    } catch {
      return false;
    }
  }

  async function run(input: string) {
    return registry.execute("apply_patch", { input }, ctx);
  }

  /* ----------------------------------------------------------------- add file */

  it("adds a new file", async () => {
    const result = await run(
      `*** Begin Patch\n*** Add File: ${abs("hello.txt")}\n+Hello world\n+Second line\n*** End Patch`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("hello.txt"), "Hello world\nSecond line\n");
    const data = result.data as Record<string, any>;
    assert.equal(data.added, 1);
    assert.equal(data.files_changed, 1);
    assert.equal(data.operations[0].type, "add");
  });

  it("creates parent directories for a new file", async () => {
    const result = await run(
      `*** Begin Patch\n*** Add File: ${abs("src/deep/nested/file.ts")}\n+export const x = 1;\n*** End Patch`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("src/deep/nested/file.ts"), "export const x = 1;\n");
  });

  it("rejects adding a file that already exists", async () => {
    await writeFile("dup.txt", "existing\n");
    const result = await run(`*** Begin Patch\n*** Add File: ${abs("dup.txt")}\n+new\n*** End Patch`);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "add_existing_file");
    assert.equal(await readFile("dup.txt"), "existing\n");
  });

  it("rejects duplicate Add operations for the same file", async () => {
    const result = await run(
      `*** Begin Patch\n*** Add File: ${abs("a.txt")}\n+one\n*** Add File: ${abs("a.txt")}\n+two\n*** End Patch`,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "duplicate_add");
    assert.equal(await exists("a.txt"), false);
  });

  it("rejects an Add File line that does not start with +", async () => {
    const result = await run(
      `*** Begin Patch\n*** Add File: ${abs("bad.txt")}\n+ok line\nnot a plus line\n*** End Patch`,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_add_line");
    assert.equal(await exists("bad.txt"), false);
  });

  /* ----------------------------------------------------------------- update file */

  it("removes a line entirely with a - hunk (no replacement)", async () => {
    await writeFile("strip.ts", "const a = 1;\nconst dead = 2;\nconst b = 3;\n");
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("strip.ts")}\n@@\n const a = 1;\n-const dead = 2;\n const b = 3;\n*** End Patch`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("strip.ts"), "const a = 1;\nconst b = 3;\n");
    const data = result.data as Record<string, any>;
    assert.equal(data.operations[0].lines_removed, 1);
    assert.equal(data.operations[0].lines_added, 0);
  });

  it("replaces a line by deleting it and adding a new one", async () => {
    await writeFile("app.py", 'name = "John"\nage = 20\nprint(name)\n');
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("app.py")}\n@@\n-name = "John"\n+name = "Alice"\n age = 20\n*** End Patch`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("app.py"), 'name = "Alice"\nage = 20\nprint(name)\n');
  });

  it("applies multiple hunks within one Update", async () => {
    await writeFile(
      "multi.js",
      "line1\nline2\nline3\nline4\nline5\nline6\nline7\n",
    );
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("multi.js")}\n` +
        `@@\n line1\n-line2\n+LINE2\n line3\n` +
        `@@\n line6\n-line7\n+LINE7\n*** End Patch`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("multi.js"), "line1\nLINE2\nline3\nline4\nline5\nline6\nLINE7\n");
  });

  it("uses an @@ header to locate the right occurrence", async () => {
    await writeFile(
      "cls.py",
      "class A:\n    def run(self):\n        return 1\n\nclass B:\n    def run(self):\n        return 1\n",
    );
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("cls.py")}\n@@ class B:\n     def run(self):\n-        return 1\n+        return 2\n*** End Patch`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(
      await readFile("cls.py"),
      "class A:\n    def run(self):\n        return 1\n\nclass B:\n    def run(self):\n        return 2\n",
    );
  });

  it("appends lines at end-of-file with the *** End of File marker", async () => {
    await writeFile("eof.txt", "first\nsecond\n");
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("eof.txt")}\n@@\n+third\n+fourth\n*** End of File\n*** End Patch`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("eof.txt"), "first\nsecond\nthird\nfourth\n");
  });

  it("tolerates trailing-whitespace drift in context lines", async () => {
    await writeFile("ws.txt", "alpha\nbeta\ngamma\n");
    // Context line "beta " has a trailing space not present in the file.
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("ws.txt")}\n@@\n alpha\n-beta\n+BETA\n gamma \n*** End Patch`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("ws.txt"), "alpha\nBETA\ngamma\n");
  });

  it("fails when the context/removed block cannot be located", async () => {
    await writeFile("nf.txt", "one\ntwo\nthree\n");
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("nf.txt")}\n@@\n-nonexistent line\n+replacement\n*** End Patch`,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "context_not_found");
    assert.equal(await readFile("nf.txt"), "one\ntwo\nthree\n");
  });

  it("fails to update a missing file", async () => {
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("ghost.txt")}\n@@\n-a\n+b\n*** End Patch`,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "update_missing_file");
  });

  it("rejects an empty Update operation", async () => {
    await writeFile("e.txt", "x\n");
    const result = await run(`*** Begin Patch\n*** Update File: ${abs("e.txt")}\n*** End Patch`);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "empty_update");
  });

  /* ----------------------------------------------------------------- move / rename */

  it("renames a file with *** Move to: and applies edits", async () => {
    await writeFile("old.py", 'print("Hi")\n');
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("old.py")}\n*** Move to: ${abs("new.py")}\n@@\n-print("Hi")\n+print("Hello")\n*** End Patch`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await exists("old.py"), false);
    assert.equal(await readFile("new.py"), 'print("Hello")\n');
    assert.equal((result.data as any).operations[0].moved_to, "new.py");
  });

  it("rejects a move whose destination already exists", async () => {
    await writeFile("src.txt", "a\n");
    await writeFile("dst.txt", "b\n");
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("src.txt")}\n*** Move to: ${abs("dst.txt")}\n@@\n-a\n+A\n*** End Patch`,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "move_target_exists");
    assert.equal(await readFile("src.txt"), "a\n");
    assert.equal(await readFile("dst.txt"), "b\n");
  });

  it("rejects two *** Move to: lines in one Update", async () => {
    await writeFile("m.txt", "a\n");
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("m.txt")}\n*** Move to: ${abs("m1.txt")}\n*** Move to: ${abs("m2.txt")}\n@@\n-a\n+b\n*** End Patch`,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_move");
  });

  /* ----------------------------------------------------------------- delete file */

  it("deletes an existing file", async () => {
    await writeFile("gone.txt", "bye\n");
    const result = await run(`*** Begin Patch\n*** Delete File: ${abs("gone.txt")}\n*** End Patch`);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await exists("gone.txt"), false);
    assert.equal((result.data as any).deleted, 1);
  });

  it("fails to delete a missing file", async () => {
    const result = await run(`*** Begin Patch\n*** Delete File: ${abs("nope.txt")}\n*** End Patch`);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "delete_missing_file");
  });

  it("rejects duplicate Delete operations", async () => {
    await writeFile("d.txt", "x\n");
    const result = await run(
      `*** Begin Patch\n*** Delete File: ${abs("d.txt")}\n*** Delete File: ${abs("d.txt")}\n*** End Patch`,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "duplicate_delete");
    // Atomic: nothing applied, the file is still there.
    assert.equal(await exists("d.txt"), true);
  });

  /* ----------------------------------------------------------------- multi-op combos */

  it("applies a combined Add + Update + Delete patch atomically", async () => {
    await writeFile("update-me.txt", "old\nkeep\n");
    await writeFile("delete-me.txt", "trash\n");
    const result = await run(
      `*** Begin Patch\n` +
        `*** Add File: ${abs("added.txt")}\n+brand new\n` +
        `*** Update File: ${abs("update-me.txt")}\n@@\n-old\n+updated\n keep\n` +
        `*** Delete File: ${abs("delete-me.txt")}\n` +
        `*** End Patch`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("added.txt"), "brand new\n");
    assert.equal(await readFile("update-me.txt"), "updated\nkeep\n");
    assert.equal(await exists("delete-me.txt"), false);
    const data = result.data as Record<string, any>;
    assert.equal(data.added, 1);
    assert.equal(data.updated, 1);
    assert.equal(data.deleted, 1);
    assert.equal(data.files_changed, 3);
  });

  it("does not touch any file when one operation in the batch fails", async () => {
    await writeFile("survivor.txt", "safe\n");
    const result = await run(
      `*** Begin Patch\n` +
        `*** Add File: ${abs("newbie.txt")}\n+created\n` +
        `*** Update File: ${abs("does-not-exist.txt")}\n@@\n-a\n+b\n` +
        `*** End Patch`,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "update_missing_file");
    // The valid Add earlier in the batch must NOT have been written.
    assert.equal(await exists("newbie.txt"), false);
    assert.equal(await readFile("survivor.txt"), "safe\n");
  });

  /* ----------------------------------------------------------------- structural validation */

  it("rejects a patch missing the Begin marker", async () => {
    const result = await run(`*** Add File: ${abs("x.txt")}\n+hi\n*** End Patch`);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "missing_begin_marker");
  });

  it("rejects a patch missing the End marker", async () => {
    const result = await run(`*** Begin Patch\n*** Add File: ${abs("x.txt")}\n+hi\n`);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "missing_end_marker");
  });

  it("rejects an unknown operation header", async () => {
    const result = await run(`*** Begin Patch\n*** Rename File: ${abs("x.txt")}\n*** End Patch`);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "unknown_operation");
  });

  it("rejects a relative path", async () => {
    const result = await run(`*** Begin Patch\n*** Add File: relative/path.txt\n+hi\n*** End Patch`);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "relative_path");
  });

  it("rejects a missing file path in a header", async () => {
    const result = await run(`*** Begin Patch\n*** Add File: \n+hi\n*** End Patch`);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "missing_file_path");
  });

  it("rejects an invalid line prefix inside a hunk", async () => {
    await writeFile("p.txt", "a\nb\n");
    const result = await run(
      `*** Begin Patch\n*** Update File: ${abs("p.txt")}\n@@\n a\n?bad prefix\n*** End Patch`,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "invalid_line_prefix");
  });

  it("rejects a hunk that appears outside an Update operation", async () => {
    const result = await run(`*** Begin Patch\n@@\n-a\n+b\n*** End Patch`);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "hunk_outside_update");
  });

  it("rejects a *** Move to: that is not attached to an Update", async () => {
    const result = await run(`*** Begin Patch\n*** Move to: ${abs("x.txt")}\n*** End Patch`);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "misplaced_move");
  });

  it("rejects content where a file header is expected", async () => {
    const result = await run(`*** Begin Patch\njust some text\n*** End Patch`);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "missing_file_header");
  });

  it("rejects an empty input", async () => {
    const result = await run("   \n  ");
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "empty_patch");
  });

  /* ----------------------------------------------------------------- misc / helpers */

  it("tolerates blank lines around the envelope", async () => {
    const result = await run(
      `\n\n*** Begin Patch\n*** Add File: ${abs("pad.txt")}\n+padded\n*** End Patch\n\n`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("pad.txt"), "padded\n");
  });

  it("normalises CRLF line endings", async () => {
    const result = await run(
      `*** Begin Patch\r\n*** Add File: ${abs("crlf.txt")}\r\n+hi\r\n*** End Patch\r\n`,
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(await readFile("crlf.txt"), "hi\n");
  });

  it("produces a helpful chip label", () => {
    assert.equal(
      applyPatchTool.label({ input: `*** Begin Patch\n*** Update File: ${abs("only.ts")}\n@@\n-a\n+b\n*** End Patch` }),
      `Patch: ${abs("only.ts")}`,
    );
    assert.equal(
      applyPatchTool.label({
        input: `*** Begin Patch\n*** Add File: ${abs("a.ts")}\n+x\n*** Delete File: ${abs("b.ts")}\n*** End Patch`,
      }),
      "Apply patch (2 files)",
    );
  });
});

/* --------------------------------------------------------------------------- unit: parser */

describe("apply_patch parser", () => {
  it("parses a full multi-operation patch", () => {
    const ops = parsePatch(
      `*** Begin Patch\n` +
        `*** Add File: /ws/hello.txt\n+Hello world\n` +
        `*** Update File: /ws/src/app.py\n*** Move to: /ws/src/main.py\n@@ def greet():\n-print("Hi")\n+print("Hello, world!")\n` +
        `*** Delete File: /ws/obsolete.txt\n` +
        `*** End Patch`,
    );
    assert.equal(ops.length, 3);
    assert.equal(ops[0]!.type, "add");
    assert.equal(ops[1]!.type, "update");
    assert.equal((ops[1] as any).movePath, "/ws/src/main.py");
    assert.equal((ops[1] as any).hunks[0].headers[0], "def greet():");
    assert.equal(ops[2]!.type, "delete");
  });

  it("summarizePatch counts operations without throwing on garbage", () => {
    const summary = summarizePatch("not a patch at all");
    assert.deepEqual(summary, { paths: [], add: 0, update: 0, delete: 0 });
  });
});
