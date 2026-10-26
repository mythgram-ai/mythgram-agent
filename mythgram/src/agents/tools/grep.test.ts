import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { grepTool, MAX_GREP_MATCHES, includeToRegExp } from "./grep.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext } from "./types.js";

describe("grep tool", () => {
  let workspace: string;
  let ctx: ToolContext;
  let registry: ToolRegistry;

  before(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mythgram-grep-"));
    ctx = { workspaceRoot: workspace, shellTimeoutMs: 10_000 };
    registry = new ToolRegistry().register(grepTool);
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
    return registry.execute("grep", args, ctx);
  }

  it("finds exact text matches with file, line number, and content", async () => {
    await writeFile("a.txt", "hello world\nfoo bar\nhello again\n");
    const result = await run({ pattern: "hello" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as Array<{ path: string; line_number: number; content: string }>;
    assert.equal(matches.length, 2);
    assert.equal(matches[0]?.path, "a.txt");
    assert.equal(matches[0]?.line_number, 1);
    assert.ok(String(matches[0]?.content).includes("hello world"));
    assert.equal(matches[1]?.line_number, 3);
    assert.equal(data.match_count, 2);
    assert.equal(data.truncated, false);
  });

  it("supports full regex syntax", async () => {
    await writeFile("b.txt", "logError here\nlog123Error there\nnothing\n");
    const result = await run({ pattern: "log.*Error" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as unknown[];
    assert.equal(matches.length, 2);
  });

  it("filters by include glob", async () => {
    await writeFile("c.js", "needle in js\n");
    await writeFile("c.ts", "needle in ts\n");
    const result = await run({ pattern: "needle", include: "*.js" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as Array<{ path: string }>;
    assert.ok(matches.length >= 1);
    for (const m of matches) assert.ok(m.path.endsWith(".js"), `expected .js file, got ${m.path}`);
  });

  it("searches within a subdirectory when path is given", async () => {
    await writeFile("sub/d.txt", "uniquepattern123 inside sub\n");
    await writeFile("top.txt", "nothing relevant here\n");
    const subAbs = path.join(workspace, "sub");
    const result = await run({ pattern: "uniquepattern123", path: subAbs });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as Array<{ path: string }>;
    assert.equal(matches.length, 1);
    assert.ok(matches[0]?.path.includes("sub"));
  });

  it("ignores node_modules, dist, and .build directories", async () => {
    await writeFile("node_modules/skip.txt", "ignoreme12345\n");
    await writeFile("dist/skip.txt", "ignoreme12345\n");
    await writeFile(".build/skip.txt", "ignoreme12345\n");
    await writeFile("src/keep.txt", "ignoreme12345\n");
    const result = await run({ pattern: "ignoreme12345" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as Array<{ path: string }>;
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.path, "src/keep.txt");
  });

  it("caps results at 50 matches", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => `captest line ${i}`).join("\n") + "\n";
    await writeFile("many.txt", lines);
    const result = await run({ pattern: "captest" });
    assert.equal(result.ok, true);
    const data = result.data as Record<string, unknown>;
    const matches = data.matches as unknown[];
    assert.equal(matches.length, MAX_GREP_MATCHES);
    assert.equal(data.truncated, true);
  });

  it("rejects empty and invalid regex patterns", async () => {
    const empty = await run({ pattern: "   " });
    assert.equal(empty.ok, false);
    const invalid = await run({ pattern: "([invalid" });
    assert.equal(invalid.ok, false);
    assert.equal((invalid.error as { code?: string })?.code, "invalid_pattern");
  });

  it("rejects paths outside the workspace", async () => {
    const result = await run({ pattern: "x", path: "/etc" });
    assert.equal(result.ok, false);
  });

  it("includeToRegExp handles brace expansion", () => {
    const re = includeToRegExp("*.{ts,tsx}");
    assert.ok(re instanceof RegExp);
    assert.ok(re.test("a.ts"));
    assert.ok(re.test("dir/b.tsx"));
    assert.ok(!re.test("a.js"));
  });
});
