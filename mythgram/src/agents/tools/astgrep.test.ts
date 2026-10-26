import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  astgrepTool,
  compileAstPattern,
  detectLanguage,
  normalizeLanguage,
  MAX_ASTGREP_MATCHES,
} from "./astgrep.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

describe("astgrep tool", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-astgrep-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = new ToolRegistry().register(astgrepTool);
  });

  after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: string): Promise<string> {
    const abs = path.join(workspace, name);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return abs;
  }

  async function run(args: Record<string, unknown>) {
    return registry.execute("astgrep", args, ctx);
  }

  it("finds function definitions structurally with captures", async () => {
    await writeFile(
      "src/a.js",
      "function greet(name) { return name; }\nfunction farewell(name) { return name; }\n",
    );
    const result = await run({ pattern: "function $NAME($ARGS) { $BODY }" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as Array<{
      path: string;
      line_number: number;
      content: string;
      captures: Record<string, string>;
    }>;
    assert.equal(matches.length, 2);
    assert.equal(matches[0]?.path, "src/a.js");
    assert.equal(matches[0]?.line_number, 1);
    assert.equal(matches[0]?.captures.NAME, "greet");
    assert.equal(matches[1]?.captures.NAME, "farewell");
    assert.equal(data.match_count, 2);
    assert.equal(data.truncated, false);
  });

  it("matches imports structurally", async () => {
    await writeFile("src/b.ts", 'import React from "react";\nimport { z } from "zod";\n');
    const result = await run({ pattern: 'import $MODULE from "$PATH"' });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as Array<{ captures: Record<string, string> }>;
    assert.ok(matches.length >= 1);
    assert.ok(
      matches.some((m) => m.captures.MODULE === "React" || m.captures.MODULE === "{ z }"),
    );
  });

  it("filters by include glob", async () => {
    await writeFile("c.js", "function needleOne() { return 1; }\n");
    await writeFile("c.ts", "function needleTwo() { return 2; }\n");
    const result = await run({ pattern: "function $NAME() { $BODY }", include: "*.js" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as Array<{ path: string }>;
    assert.ok(matches.length >= 1);
    for (const m of matches) assert.ok(m.path.endsWith(".js"), `expected .js file, got ${m.path}`);
  });

  it("filters by language", async () => {
    await writeFile("lang/app.py", "def hello():\n    return 1\n");
    await writeFile("lang/app.js", "function hello() { return 1; }\n");
    const result = await run({ pattern: "function $NAME() { $BODY }", language: "javascript" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as Array<{ path: string }>;
    assert.ok(matches.length >= 1);
    for (const m of matches) assert.ok(m.path.endsWith(".js"), `expected .js file, got ${m.path}`);
  });

  it("auto-detects language per file", async () => {
    await writeFile("auto/d.py", "def autohello():\n    return 1\n");
    const result = await run({ pattern: "def $NAME(): $BODY" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as Array<{ path: string; language: string }>;
    const hit = matches.find((m) => m.path.endsWith("d.py"));
    assert.ok(hit, "expected a match in d.py");
    assert.equal(hit?.language, "python");
  });

  it("searches within a subdirectory when path is given", async () => {
    await writeFile("sub/uniq.js", "function uniquepattern999() { return 1; }\n");
    await writeFile("top.js", "const nothing = 1;\n");
    const subAbs = path.join(workspace, "sub");
    const result = await run({ pattern: "function $NAME() { $BODY }", path: subAbs });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as Array<{ path: string }>;
    assert.ok(matches.some((m) => m.path.includes("sub")));
    assert.ok(matches.every((m) => m.path.includes("sub")));
  });

  it("ignores node_modules, dist, and .build directories", async () => {
    await writeFile("node_modules/skip.js", "function ignoreme777() { return 1; }\n");
    await writeFile("dist/skip.js", "function ignoreme777() { return 1; }\n");
    await writeFile(".build/skip.js", "function ignoreme777() { return 1; }\n");
    await writeFile("src/keep.js", "function ignoreme777() { return 1; }\n");
    const result = await run({ pattern: "function $NAME() { $BODY }" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as Array<{ path: string; content: string }>;
    const hits = matches.filter((m) => m.content.includes("ignoreme777"));
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.path, "src/keep.js");
  });

  it("caps results at 50 matches", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => `function capfn${i}() { return ${i}; }`).join("\n") + "\n";
    await writeFile("many.js", lines);
    const result = await run({ pattern: "function $NAME() { $BODY }" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as unknown[];
    assert.ok(matches.length <= MAX_ASTGREP_MATCHES);
    if (matches.length === MAX_ASTGREP_MATCHES) assert.equal(data.truncated, true);
  });

  it("rejects empty patterns and patterns without wildcards", async () => {
    const empty = await run({ pattern: "   " });
    assert.equal(empty.ok, false);
    const plain = await run({ pattern: "function hello() {}" });
    assert.equal(plain.ok, false);
    assert.equal((plain.error as { code?: string })?.code, "invalid_pattern");
  });

  it("rejects unknown languages and paths outside the workspace", async () => {
    const badLang = await run({ pattern: "function $NAME() {}", language: "klingon" });
    assert.equal(badLang.ok, false);
    assert.equal((badLang.error as { code?: string })?.code, "invalid_language");
    const badPath = await run({ pattern: "function $NAME() {}", path: "/etc" });
    assert.equal(badPath.ok, false);
  });

  it("compileAstPattern captures wildcards and tolerates whitespace", () => {
    const compiled = compileAstPattern("function $NAME($ARGS) { $BODY }");
    assert.deepEqual(compiled.varNames, ["NAME", "ARGS", "BODY"]);
    const m = compiled.regex.exec("function  greet(name) {\n  return name;\n}");
    assert.ok(m?.groups?.NAME === "greet");
  });

  it("normalizeLanguage and detectLanguage behave", () => {
    assert.equal(normalizeLanguage("js"), "javascript");
    assert.equal(normalizeLanguage("Python"), "python");
    assert.equal(normalizeLanguage("klingon"), null);
    assert.equal(detectLanguage("a.ts"), "typescript");
    assert.equal(detectLanguage("b.py"), "python");
    assert.equal(detectLanguage("c.unknownxyz"), null);
  });
});
